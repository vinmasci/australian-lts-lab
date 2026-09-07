import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  applyHardSpeedRuleFloor,
  emptyVoteCounts,
  emptyRideabilityCounts,
  isLtsVoteLevel,
  isRideabilityIssue,
  isRideabilityLevel,
  leadingVote,
  medianRideability,
  projectApprovedLts,
  publishedLtsContributions,
  type LtsApproval,
  type LtsVoteLevel,
  type RideabilityIssue,
  type RideabilityLevel,
  type SegmentVoteSummary,
  type StoredLtsVote,
  type VoteSegment,
} from '@/lib/lts-voting';
import {
  communityApproval,
  communityModerationStatus,
  communityVotes,
  observeCommunitySegment,
  publishedCommunityApprovals,
  saveCommunityApproval,
  saveCommunityVote,
} from '@/lib/lts-community-store';
import { enforceVoteRateLimit, RateLimitError } from '@/lib/lts-rate-limit';
import { authenticatedContributor } from '@/lib/lts-review-auth';

export const dynamic = 'force-dynamic';

const DATASETS = new Set([
  'victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory',
]);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[a-zA-Z0-9:._-]+$/.test(value);
}

function validGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as GeoJSON.Geometry;
  if (!['Point', 'LineString', 'MultiLineString'].includes(geometry.type)) return false;
  const encoded = JSON.stringify(geometry);
  if (encoded.length > 100_000) return false;
  const numbers = encoded.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!numbers.length || numbers.some((number) => !Number.isFinite(number))) return false;
  return true;
}

function validSegment(value: unknown): value is VoteSegment {
  if (!value || typeof value !== 'object') return false;
  const segment = value as VoteSegment;
  return DATASETS.has(segment.dataset)
    && validIdentifier(segment.segmentId, 160)
    && typeof segment.name === 'string' && segment.name.length <= 160
    && typeof segment.featureKind === 'string' && segment.featureKind.length <= 40
    && Number.isInteger(segment.currentLts) && segment.currentLts >= 1 && segment.currentLts <= 4
    && validGeometry(segment.geometry)
    && (segment.osmId === undefined || validIdentifier(segment.osmId, 40))
    && (segment.direction === undefined || validIdentifier(segment.direction, 30))
    && (segment.maxspeed === undefined || (Number.isFinite(segment.maxspeed) && segment.maxspeed >= 0 && segment.maxspeed <= 150))
    && (segment.trafficAadt === undefined || (Number.isFinite(segment.trafficAadt) && segment.trafficAadt >= 0 && segment.trafficAadt <= 1_000_000))
    && (segment.datasetVersion === undefined || validIdentifier(segment.datasetVersion, 160))
    && (segment.classifierVersion === undefined || validIdentifier(segment.classifierVersion, 100))
    && (segment.osmSnapshotDate === undefined || (typeof segment.osmSnapshotDate === 'string' && segment.osmSnapshotDate.length <= 40));
}

async function summary(dataset: string, segmentId: string, contributorUid?: string): Promise<SegmentVoteSummary> {
  const storedVotes = (await communityVotes(dataset, segmentId))
    .filter((vote) => vote.dataset === dataset && vote.segmentId === segmentId
      && (isLtsVoteLevel(vote.targetLts) || isRideabilityLevel(vote.rideability)));
  const latestByVoter = new Map<string, StoredLtsVote>();
  for (const vote of storedVotes) {
    const previous = latestByVoter.get(vote.voterKey);
    if (!previous || previous.updatedAt < vote.updatedAt) latestByVoter.set(vote.voterKey, vote);
  }
  const votes = [...latestByVoter.values()];
  const counts = emptyVoteCounts();
  const rideabilityCounts = emptyRideabilityCounts();
  for (const vote of votes) {
    if (isLtsVoteLevel(vote.targetLts)) counts[String(vote.targetLts)] += 1;
  }
  for (const vote of votes) {
    if (isRideabilityLevel(vote.rideability)) rideabilityCounts[String(vote.rideability)] += 1;
  }
  const leadingTarget = leadingVote(counts);
  const representative = [...votes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const baseLts = representative?.currentLts;
  const [approval, moderationStatus] = await Promise.all([
    communityApproval(dataset, segmentId),
    communityModerationStatus(dataset, segmentId),
  ]);
  const voterKey = contributorUid ? digest(contributorUid) : null;
  const yourRecord = votes.find((vote) => vote.voterKey === voterKey);
  const ltsTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const rideabilityTotal = Object.values(rideabilityCounts).reduce((sum, count) => sum + count, 0);
  const publicApproval = approval ? {
    ...approval,
    approvedLts: applyHardSpeedRuleFloor(
      approval.baseLts,
      approval.approvedLts,
      approval.segment?.maxspeed,
    ),
    reviewedBy: undefined,
    reviewNote: undefined,
  } : null;
  const contributionsArePublished = moderationStatus === 'approved'
    && Boolean(approval)
    && approval?.status !== 'needs_review'
    && approval?.status !== 'orphaned';
  return {
    counts,
    total: ltsTotal,
    leadingTarget,
    projectedLts: leadingTarget !== null && baseLts
      ? projectApprovedLts(baseLts, leadingTarget, representative?.segment.maxspeed)
      : null,
    yourVote: isLtsVoteLevel(yourRecord?.targetLts) ? yourRecord.targetLts : null,
    yourContributorName: typeof yourRecord?.contributorName === 'string' ? yourRecord.contributorName : '',
    yourLtsReason: typeof yourRecord?.ltsReason === 'string' ? yourRecord.ltsReason : '',
    rideabilityCounts,
    rideabilityTotal,
    communityRideability: medianRideability(rideabilityCounts),
    yourRideability: isRideabilityLevel(yourRecord?.rideability) ? yourRecord.rideability : null,
    yourRideabilityIssues: (yourRecord?.rideabilityIssues || []).filter(isRideabilityIssue),
    yourObservation: typeof yourRecord?.note === 'string' ? yourRecord.note : '',
    publicContributions: publishedLtsContributions(votes, contributionsArePublished),
    moderationStatus,
    approval: publicApproval,
  };
}

export async function GET(request: NextRequest) {
  try {
    const dataset = request.nextUrl.searchParams.get('dataset') || '';
    if (!DATASETS.has(dataset)) return NextResponse.json({ error: 'Unknown dataset.' }, { status: 400 });

    if (request.nextUrl.searchParams.get('approved') === '1') {
      const approvals = await publishedCommunityApprovals(dataset);
      return NextResponse.json({
        type: 'FeatureCollection',
        features: approvals
          .filter((approval) => approval.dataset === dataset && isLtsVoteLevel(approval.approvedLts))
          .map((approval) => {
            const segment = approval.segment as VoteSegment | undefined;
            const baseLts = Number(approval.baseLts ?? segment?.currentLts);
            const publishedLts = applyHardSpeedRuleFloor(
              Number.isFinite(baseLts) ? baseLts : Number(approval.approvedLts),
              approval.approvedLts as LtsVoteLevel,
              segment?.maxspeed,
            );
            return ({
            type: 'Feature',
            id: String(approval.segmentId),
            properties: {
              segment_id: approval.segmentId,
              lts: publishedLts,
              rideability: approval.approvedRideability ?? null,
              target_lts: approval.targetLts,
              approved_at: approval.approvedAt,
              reconciliation_status: approval.status || 'current',
            },
            geometry: approval.geometry || segment?.geometry,
          });
          }),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const segmentId = request.nextUrl.searchParams.get('segmentId') || '';
    if (!validIdentifier(segmentId, 160)) return NextResponse.json({ error: 'Invalid segment.' }, { status: 400 });
    const contributor = await authenticatedContributor(request);
    return NextResponse.json(await summary(dataset, segmentId, contributor?.uid), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[LTS votes GET]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Votes are temporarily unavailable.' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { segment?: unknown };
    if (!validSegment(body.segment)) return NextResponse.json({ error: 'Invalid segment data.' }, { status: 400 });
    await observeCommunitySegment(body.segment);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[LTS segment observation]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Segment could not be registered.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const contributor = await authenticatedContributor(request);
  if (!contributor) return NextResponse.json({ error: 'Sign in with an AusBUG account to contribute.' }, { status: 401 });
  try {
    const body = await request.json() as {
      segment?: unknown;
      targetLts?: unknown;
      rideability?: unknown;
      rideabilityIssues?: unknown;
      ltsReason?: unknown;
      note?: unknown;
      website?: unknown;
    };
    if (!validSegment(body.segment)) return NextResponse.json({ error: 'Invalid segment data.' }, { status: 400 });
    if (typeof body.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'Submission could not be accepted.' }, { status: 400 });
    if (body.targetLts !== null && body.targetLts !== undefined && !isLtsVoteLevel(body.targetLts)) {
      return NextResponse.json({ error: 'Choose a valid LTS.' }, { status: 400 });
    }
    if (body.rideability !== null && body.rideability !== undefined && !isRideabilityLevel(body.rideability)) {
      return NextResponse.json({ error: 'Choose a valid rideability rating.' }, { status: 400 });
    }
    if (body.rideabilityIssues !== undefined && (!Array.isArray(body.rideabilityIssues)
      || body.rideabilityIssues.length > 5
      || body.rideabilityIssues.some((issue) => !isRideabilityIssue(issue)))) {
      return NextResponse.json({ error: 'Choose valid surface conditions.' }, { status: 400 });
    }
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) {
      return NextResponse.json({ error: 'Observation must be 500 characters or fewer.' }, { status: 400 });
    }
    if (body.ltsReason !== undefined && (typeof body.ltsReason !== 'string' || body.ltsReason.length > 500)) {
      return NextResponse.json({ error: 'LTS reasoning must be 500 characters or fewer.' }, { status: 400 });
    }
    if (!isLtsVoteLevel(body.targetLts) && !isRideabilityLevel(body.rideability)) {
      return NextResponse.json({ error: 'Choose an LTS rating, a rideability rating, or both.' }, { status: 400 });
    }

    await enforceVoteRateLimit(request, contributor.uid);

    const vote: StoredLtsVote = {
      dataset: body.segment.dataset,
      segmentId: body.segment.segmentId,
      voterKey: digest(contributor.uid),
      contributorName: contributor.name.toLowerCase() === contributor.email.split('@')[0]
        ? 'AusBUG rider'
        : contributor.name,
      contributorUid: contributor.uid,
      contributorEmail: contributor.email,
      targetLts: isLtsVoteLevel(body.targetLts) ? body.targetLts as LtsVoteLevel : null,
      rideability: isRideabilityLevel(body.rideability) ? body.rideability as RideabilityLevel : null,
      rideabilityIssues: isRideabilityLevel(body.rideability)
        ? [...new Set((body.rideabilityIssues as RideabilityIssue[] | undefined) || [])]
        : [],
      currentLts: body.segment.currentLts,
      ltsReason: isLtsVoteLevel(body.targetLts) && typeof body.ltsReason === 'string' ? body.ltsReason.trim() : '',
      note: typeof body.note === 'string' ? body.note.trim() : '',
      segment: body.segment,
      updatedAt: new Date().toISOString(),
    };
    await saveCommunityVote(vote);
    const result = await summary(vote.dataset, vote.segmentId, contributor.uid);
    const targetLts = result.leadingTarget ?? (vote.segment.currentLts as LtsVoteLevel);
    const voteCountAtApproval = new Set((await communityVotes(vote.dataset, vote.segmentId)).map((item) => item.voterKey)).size;
    const approval: LtsApproval = {
      dataset: vote.dataset,
      segmentId: vote.segmentId,
      targetLts,
      approvedLts: projectApprovedLts(vote.currentLts, targetLts, vote.segment.maxspeed),
      approvedRideability: result.communityRideability,
      baseLts: vote.currentLts,
      segment: vote.segment,
      approvedAt: vote.updatedAt,
      voteCountAtApproval,
      status: 'current',
      approvedAgainstVersion: vote.segment.datasetVersion,
      currentDatasetVersion: vote.segment.datasetVersion,
    };
    await saveCommunityApproval(approval, {
      uid: contributor.uid,
      email: contributor.email,
      name: contributor.name,
      note: 'Published automatically from a signed-in AusBUG contribution.',
    });
    return NextResponse.json(await summary(vote.dataset, vote.segmentId, contributor.uid));
  } catch (error) {
    console.error('[LTS votes POST]', error);
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': String(error.retryAfter) } });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Vote could not be saved.' }, { status: 503 });
  }
}
