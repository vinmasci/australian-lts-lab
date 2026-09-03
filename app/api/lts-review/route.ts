import { NextRequest, NextResponse } from 'next/server';
import {
  emptyRideabilityCounts,
  emptyVoteCounts,
  isLtsVoteLevel,
  isRideabilityLevel,
  leadingVote,
  medianRideability,
  projectApprovedLts,
  type LtsApproval,
  type ModerationStatus,
  type ReviewQueueItem,
  type RideabilityLevel,
  type StoredLtsVote,
} from '@/lib/lts-voting';
import { communityReviewItems, communityVotes, rejectCommunitySegment, saveCommunityApproval } from '@/lib/lts-community-store';
import { reviewerAuthorised } from '@/lib/lts-review-auth';

export const dynamic = 'force-dynamic';

const DATASETS = new Set([
  'victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory',
]);

function validIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[a-zA-Z0-9:._-]+$/.test(value);
}

function validReviewerName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 60 && !/[\u0000-\u001f\u007f]/.test(value.trim());
}

function latestVotes(votes: StoredLtsVote[]): StoredLtsVote[] {
  const byVoter = new Map<string, StoredLtsVote>();
  for (const vote of votes) {
    const previous = byVoter.get(vote.voterKey);
    if (!previous || previous.updatedAt < vote.updatedAt) byVoter.set(vote.voterKey, vote);
  }
  return [...byVoter.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function reviewItem(item: Awaited<ReturnType<typeof communityReviewItems>>[number]): ReviewQueueItem {
  const votes = latestVotes(item.votes);
  const counts = emptyVoteCounts();
  const rideabilityCounts = emptyRideabilityCounts();
  for (const vote of votes) {
    if (isLtsVoteLevel(vote.targetLts)) counts[String(vote.targetLts)] += 1;
    if (isRideabilityLevel(vote.rideability)) rideabilityCounts[String(vote.rideability)] += 1;
  }
  const leadingTarget = leadingVote(counts);
  return {
    dataset: item.record.dataset,
    segmentId: item.record.currentSegmentId,
    segment: item.record.current,
    moderationStatus: item.record.moderationStatus || 'pending',
    lastContributionAt: item.record.lastContributionAt || item.record.lastSeenAt,
    lastReviewedAt: item.record.lastReviewedAt,
    reviewNote: item.record.reviewNote,
    votes: votes.map((vote) => ({
      contributorName: vote.contributorName || 'Unnamed pilot contributor',
      targetLts: isLtsVoteLevel(vote.targetLts) ? vote.targetLts : null,
      rideability: isRideabilityLevel(vote.rideability) ? vote.rideability : null,
      rideabilityIssues: vote.rideabilityIssues || [],
      ltsReason: vote.ltsReason || '',
      note: vote.note || '',
      updatedAt: vote.updatedAt,
    })),
    counts,
    rideabilityCounts,
    leadingTarget,
    projectedLts: leadingTarget === null ? null : projectApprovedLts(item.record.current.currentLts, leadingTarget),
    communityRideability: medianRideability(rideabilityCounts),
    approval: item.approval,
  };
}

export async function GET(request: NextRequest) {
  if (!reviewerAuthorised(request)) return NextResponse.json({ error: 'Reviewer authorisation required.' }, { status: 401 });
  try {
    const requestedStatus = request.nextUrl.searchParams.get('status') || 'pending';
    const status: ModerationStatus = requestedStatus === 'approved' || requestedStatus === 'rejected' ? requestedStatus : 'pending';
    const dataset = request.nextUrl.searchParams.get('dataset');
    if (dataset && !DATASETS.has(dataset)) return NextResponse.json({ error: 'Unknown dataset.' }, { status: 400 });
    const items = (await communityReviewItems(status))
      .filter((item) => !dataset || item.record.dataset === dataset)
      .map(reviewItem);
    return NextResponse.json({ status, items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[LTS review queue]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Review queue is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!reviewerAuthorised(request)) return NextResponse.json({ error: 'Reviewer authorisation required.' }, { status: 401 });
  try {
    const body = await request.json() as {
      action?: unknown;
      dataset?: unknown;
      segmentId?: unknown;
      targetLts?: unknown;
      rideability?: unknown;
      reviewerName?: unknown;
      reviewNote?: unknown;
    };
    if ((body.action !== 'approve' && body.action !== 'reject')
      || typeof body.dataset !== 'string' || !DATASETS.has(body.dataset)
      || !validIdentifier(body.segmentId, 160)
      || !validReviewerName(body.reviewerName)
      || (body.reviewNote !== undefined && (typeof body.reviewNote !== 'string' || body.reviewNote.length > 500))) {
      return NextResponse.json({ error: 'Valid review details are required.' }, { status: 400 });
    }
    const reviewer = { name: body.reviewerName.trim(), note: typeof body.reviewNote === 'string' ? body.reviewNote.trim() : '' };
    if (body.action === 'reject') {
      await rejectCommunitySegment(body.dataset, body.segmentId, reviewer);
      return NextResponse.json({ ok: true, status: 'rejected' });
    }
    if (!isLtsVoteLevel(body.targetLts)) return NextResponse.json({ error: 'Choose the approved LTS.' }, { status: 400 });
    if (body.rideability !== null && body.rideability !== undefined && !isRideabilityLevel(body.rideability)) {
      return NextResponse.json({ error: 'Rideability must be R1 to R4.' }, { status: 400 });
    }
    const votes = latestVotes((await communityVotes(body.dataset, body.segmentId))
      .filter((vote) => vote.dataset === body.dataset && vote.segmentId === body.segmentId));
    if (!votes.length) return NextResponse.json({ error: 'No votes exist for this segment.' }, { status: 404 });
    const representative = votes[0];
    const approval: LtsApproval = {
      dataset: body.dataset,
      segmentId: body.segmentId,
      targetLts: body.targetLts,
      approvedLts: projectApprovedLts(representative.currentLts, body.targetLts),
      approvedRideability: isRideabilityLevel(body.rideability) ? body.rideability as RideabilityLevel : null,
      baseLts: representative.currentLts,
      segment: representative.segment,
      approvedAt: new Date().toISOString(),
      voteCountAtApproval: votes.length,
      status: 'current',
      approvedAgainstVersion: representative.segment.datasetVersion,
      currentDatasetVersion: representative.segment.datasetVersion,
      reviewedBy: reviewer.name,
      reviewNote: reviewer.note,
    };
    await saveCommunityApproval(approval, reviewer);
    return NextResponse.json({ ok: true, status: 'approved', approval });
  } catch (error) {
    console.error('[LTS review decision]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Review could not be saved.' }, { status: 503 });
  }
}
