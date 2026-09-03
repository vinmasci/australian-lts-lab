import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { isLtsVoteLevel, isRideabilityLevel, projectApprovedLts, type LtsApproval, type StoredLtsVote } from '@/lib/lts-voting';
import { listVoteRecords, writeVoteRecord } from '@/lib/lts-vote-store';

export const dynamic = 'force-dynamic';

const DATASETS = new Set([
  'victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory',
]);

function authorised(request: NextRequest): boolean {
  const configured = process.env.LTS_VOTE_ADMIN_TOKEN;
  if (!configured) return process.env.NODE_ENV !== 'production' && request.headers.get('x-local-review') === 'true';
  return request.headers.get('authorization') === `Bearer ${configured}`;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: 'Reviewer authorisation required.' }, { status: 401 });
  try {
    const body = await request.json() as { dataset?: unknown; segmentId?: unknown; targetLts?: unknown; rideability?: unknown };
    if (typeof body.dataset !== 'string' || !DATASETS.has(body.dataset)
      || typeof body.segmentId !== 'string' || body.segmentId.length > 160 || !/^[a-zA-Z0-9:._-]+$/.test(body.segmentId)
      || !isLtsVoteLevel(body.targetLts)) {
      return NextResponse.json({ error: 'Dataset, segment and target LTS are required.' }, { status: 400 });
    }
    if (body.rideability !== null && body.rideability !== undefined && !isRideabilityLevel(body.rideability)) {
      return NextResponse.json({ error: 'Rideability must be R1 to R4.' }, { status: 400 });
    }
    const segmentHash = createHash('sha256').update(`${body.dataset}\0${body.segmentId}`).digest('hex').slice(0, 32);
    const storedVotes = (await listVoteRecords<StoredLtsVote>(`votes/${body.dataset}/${segmentHash}/`, 1000))
      .filter((vote) => vote.dataset === body.dataset && vote.segmentId === body.segmentId);
    const latestByVoter = new Map<string, StoredLtsVote>();
    for (const vote of storedVotes) {
      const previous = latestByVoter.get(vote.voterKey);
      if (!previous || previous.updatedAt < vote.updatedAt) latestByVoter.set(vote.voterKey, vote);
    }
    const votes = [...latestByVoter.values()].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    if (!votes.length) return NextResponse.json({ error: 'No votes exist for this segment.' }, { status: 404 });
    const representative = votes.at(-1)!;
    const approval: LtsApproval = {
      dataset: body.dataset,
      segmentId: body.segmentId,
      targetLts: body.targetLts,
      approvedLts: projectApprovedLts(representative.currentLts, body.targetLts),
      approvedRideability: isRideabilityLevel(body.rideability) ? body.rideability : null,
      baseLts: representative.currentLts,
      segment: representative.segment,
      approvedAt: new Date().toISOString(),
      voteCountAtApproval: votes.length,
    };
    await writeVoteRecord(`approvals/${body.dataset}/${segmentHash}.json`, approval);
    return NextResponse.json(approval);
  } catch (error) {
    console.error('[LTS vote approval]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Approval could not be saved.' }, { status: 503 });
  }
}
