import { publishedCommunityApprovals } from './lts-community-store';
import { tileApprovals } from './lts-community-tiles';
import type { LtsVoteLevel } from './lts-voting';

const snapshots = new Map<string, { ratings: Map<string, LtsVoteLevel>; expires: number }>();
const pending = new Map<string, Promise<Map<string, LtsVoteLevel>>>();

/** One read per state per warm instance / five minutes, not one per map tile. */
export async function communityTileRatings(dataset: string): Promise<Map<string, LtsVoteLevel>> {
  const cached = snapshots.get(dataset);
  if (cached && cached.expires > Date.now()) return cached.ratings;
  let read = pending.get(dataset);
  if (!read) {
    read = publishedCommunityApprovals(dataset).then(records => {
      const ratings = tileApprovals(dataset, records);
      // A successful empty result removes withdrawn approvals.
      snapshots.set(dataset, { ratings, expires: Date.now() + 300_000 });
      return ratings;
    }).catch(error => {
      console.error('[LTS tile approvals] using last known ratings', dataset, error);
      const ratings = snapshots.get(dataset)?.ratings ?? new Map<string, LtsVoteLevel>();
      snapshots.set(dataset, { ratings, expires: Date.now() + 30_000 });
      return ratings;
    }).finally(() => pending.delete(dataset));
    pending.set(dataset, read);
  }
  // A slow/unavailable vote database must not take the map down.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<Map<string, LtsVoteLevel>>(resolve => {
      timeout = setTimeout(() => resolve(cached?.ratings ?? new Map()), 1500);
    })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
