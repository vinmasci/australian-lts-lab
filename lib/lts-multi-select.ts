import type { VoteSegment } from './lts-voting';

export const MAX_SELECTED_SEGMENTS = 20;
export const segmentKey = (segment: VoteSegment) => `${segment.dataset}/${segment.segmentId}`;

export function toggleSegment<T extends { segment: VoteSegment }>(current: T[], item: T): T[] {
  const key = segmentKey(item.segment);
  if (current.some((entry) => segmentKey(entry.segment) === key)) {
    // Multiple tile fragments can represent one road. Re-clicking another
    // fragment must not remove the road or replace its selected geometry.
    return current;
  }
  return current.length < MAX_SELECTED_SEGMENTS ? [...current, item] : current;
}

// Retain completed IDs so a retry does not re-submit successful contributions.
export async function submitSelectedSegments(
  segments: VoteSegment[],
  completed: Set<string>,
  submit: (segment: VoteSegment) => Promise<void>,
) {
  for (const segment of segments) {
    const key = segmentKey(segment);
    if (completed.has(key)) continue;
    await submit(segment);
    completed.add(key);
  }
}
