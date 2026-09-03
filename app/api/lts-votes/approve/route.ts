import { NextRequest, NextResponse } from 'next/server';
import { isLtsVoteLevel, isRideabilityLevel, projectApprovedLts, type LtsApproval, type StoredLtsVote } from '@/lib/lts-voting';
import { communityVotes, saveCommunityApproval } from '@/lib/lts-community-store';
import { authenticatedReviewer } from '@/lib/lts-review-auth';

export const dynamic = 'force-dynamic';

const DATASETS = new Set([
  'victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory',
]);

export async function POST(request: NextRequest) {
  const reviewer = await authenticatedReviewer(request);
  if (!reviewer) return NextResponse.json({ error: 'Reviewer sign-in required.' }, { status: 401 });
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
    const storedVotes = (await communityVotes(body.dataset, body.segmentId))
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
      status: 'current',
      approvedAgainstVersion: representative.segment.datasetVersion,
      currentDatasetVersion: representative.segment.datasetVersion,
    };
    await saveCommunityApproval(approval, { ...reviewer, note: '' });
    return NextResponse.json(approval);
  } catch (error) {
    console.error('[LTS vote approval]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Approval could not be saved.' }, { status: 503 });
  }
}
