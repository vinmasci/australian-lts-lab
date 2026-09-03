import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  emptyVoteCounts,
  emptyRideabilityCounts,
  isLtsVoteLevel,
  isRideabilityIssue,
  isRideabilityLevel,
  leadingVote,
  medianRideability,
  projectApprovedLts,
  type LtsApproval,
  type LtsVoteLevel,
  type RideabilityIssue,
  type RideabilityLevel,
  type SegmentVoteSummary,
  type StoredLtsVote,
  type VoteSegment,
} from '@/lib/lts-voting';
import { listVoteRecords, readVoteRecord, writeVoteRecord } from '@/lib/lts-vote-store';

export const dynamic = 'force-dynamic';

const DATASETS = new Set([
  'victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory',
]);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function segmentKey(dataset: string, segmentId: string): string {
  return digest(`${dataset}\0${segmentId}`).slice(0, 32);
}

function votePath(dataset: string, segmentId: string, voterId: string): string {
  return `votes/${dataset}/${segmentKey(dataset, segmentId)}/${digest(voterId)}-${Date.now()}.json`;
}

function approvalPath(dataset: string, segmentId: string): string {
  return `approvals/${dataset}/${segmentKey(dataset, segmentId)}.json`;
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
    && (segment.maxspeed === undefined || (Number.isFinite(segment.maxspeed) && segment.maxspeed >= 0 && segment.maxspeed <= 150))
    && (segment.trafficAadt === undefined || (Number.isFinite(segment.trafficAadt) && segment.trafficAadt >= 0 && segment.trafficAadt <= 1_000_000));
}

async function summary(dataset: string, segmentId: string, voterId?: string): Promise<SegmentVoteSummary> {
  const storedVotes = (await listVoteRecords<StoredLtsVote>(`votes/${dataset}/${segmentKey(dataset, segmentId)}/`, 1000))
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
  const baseLts = votes.at(-1)?.currentLts;
  const approval = await readVoteRecord<LtsApproval>(approvalPath(dataset, segmentId));
  const voterKey = voterId ? digest(voterId) : null;
  const yourRecord = votes.find((vote) => vote.voterKey === voterKey);
  const ltsTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const rideabilityTotal = Object.values(rideabilityCounts).reduce((sum, count) => sum + count, 0);
  return {
    counts,
    total: ltsTotal,
    leadingTarget,
    projectedLts: leadingTarget !== null && baseLts ? projectApprovedLts(baseLts, leadingTarget) : null,
    yourVote: isLtsVoteLevel(yourRecord?.targetLts) ? yourRecord.targetLts : null,
    yourLtsReason: typeof yourRecord?.ltsReason === 'string' ? yourRecord.ltsReason : '',
    rideabilityCounts,
    rideabilityTotal,
    communityRideability: medianRideability(rideabilityCounts),
    yourRideability: isRideabilityLevel(yourRecord?.rideability) ? yourRecord.rideability : null,
    yourRideabilityIssues: (yourRecord?.rideabilityIssues || []).filter(isRideabilityIssue),
    yourObservation: typeof yourRecord?.note === 'string' ? yourRecord.note : '',
    approval,
  };
}

export async function GET(request: NextRequest) {
  try {
    const dataset = request.nextUrl.searchParams.get('dataset') || '';
    if (!DATASETS.has(dataset)) return NextResponse.json({ error: 'Unknown dataset.' }, { status: 400 });

    if (request.nextUrl.searchParams.get('approved') === '1') {
      const approvals = await listVoteRecords<LtsApproval>(`approvals/${dataset}/`, 1000);
      return NextResponse.json({
        type: 'FeatureCollection',
        features: approvals
          .filter((approval) => approval.dataset === dataset && isLtsVoteLevel(approval.approvedLts))
          .map((approval) => ({
            type: 'Feature',
            id: approval.segmentId,
            properties: {
              segment_id: approval.segmentId,
              lts: approval.approvedLts,
              rideability: approval.approvedRideability ?? null,
              target_lts: approval.targetLts,
              approved_at: approval.approvedAt,
            },
            geometry: approval.segment.geometry,
          })),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const segmentId = request.nextUrl.searchParams.get('segmentId') || '';
    const voterId = request.nextUrl.searchParams.get('voterId') || undefined;
    if (!validIdentifier(segmentId, 160)) return NextResponse.json({ error: 'Invalid segment.' }, { status: 400 });
    if (voterId && !validIdentifier(voterId, 100)) return NextResponse.json({ error: 'Invalid voter key.' }, { status: 400 });
    return NextResponse.json(await summary(dataset, segmentId, voterId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[LTS votes GET]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Votes are temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      segment?: unknown;
      voterId?: unknown;
      targetLts?: unknown;
      rideability?: unknown;
      rideabilityIssues?: unknown;
      ltsReason?: unknown;
      note?: unknown;
    };
    if (!validSegment(body.segment)) return NextResponse.json({ error: 'Invalid segment data.' }, { status: 400 });
    if (!validIdentifier(body.voterId, 100)) return NextResponse.json({ error: 'Invalid voter key.' }, { status: 400 });
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

    const vote: StoredLtsVote = {
      dataset: body.segment.dataset,
      segmentId: body.segment.segmentId,
      voterKey: digest(body.voterId),
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
    await writeVoteRecord(votePath(vote.dataset, vote.segmentId, body.voterId), vote);
    return NextResponse.json(await summary(vote.dataset, vote.segmentId, body.voterId));
  } catch (error) {
    console.error('[LTS votes POST]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Vote could not be saved.' }, { status: 503 });
  }
}
