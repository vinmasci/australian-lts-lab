import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  isDismountObservation,
  summariseDismountReports,
  type DismountReportSegment,
  type StoredDismountReport,
} from '@/lib/dismount-reporting';
import { readDismountReports, saveDismountReport } from '@/lib/dismount-report-store';
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
  if (!['LineString', 'MultiLineString'].includes(geometry.type)) return false;
  const encoded = JSON.stringify(geometry);
  if (encoded.length > 100_000) return false;
  const numbers = encoded.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  return numbers.length > 0 && numbers.every(Number.isFinite);
}

function validSegment(value: unknown): value is DismountReportSegment {
  if (!value || typeof value !== 'object') return false;
  const segment = value as DismountReportSegment;
  return DATASETS.has(segment.dataset)
    && validIdentifier(segment.segmentId, 160)
    && typeof segment.name === 'string' && segment.name.length <= 160
    && segment.featureKind === 'dismount'
    && validGeometry(segment.geometry)
    && (segment.osmId === undefined || validIdentifier(segment.osmId, 40))
    && (segment.datasetVersion === undefined || validIdentifier(segment.datasetVersion, 160))
    && (segment.classifierVersion === undefined || validIdentifier(segment.classifierVersion, 100))
    && (segment.osmSnapshotDate === undefined || (typeof segment.osmSnapshotDate === 'string' && segment.osmSnapshotDate.length <= 40));
}

async function reportSummary(dataset: string, segmentId: string, contributorUid?: string) {
  return summariseDismountReports(
    await readDismountReports(dataset, segmentId),
    contributorUid ? digest(contributorUid) : undefined,
  );
}

export async function GET(request: NextRequest) {
  try {
    const dataset = request.nextUrl.searchParams.get('dataset') || '';
    const segmentId = request.nextUrl.searchParams.get('segmentId') || '';
    if (!DATASETS.has(dataset)) return NextResponse.json({ error: 'Unknown dataset.' }, { status: 400 });
    if (!validIdentifier(segmentId, 160)) return NextResponse.json({ error: 'Invalid segment.' }, { status: 400 });
    const contributor = await authenticatedContributor(request);
    return NextResponse.json(await reportSummary(dataset, segmentId, contributor?.uid), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[Dismount reports GET]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reports are temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const contributor = await authenticatedContributor(request);
  if (!contributor) return NextResponse.json({ error: 'Sign in with an AusBUG account to report signage.' }, { status: 401 });
  try {
    const body = await request.json() as {
      segment?: unknown;
      observation?: unknown;
      note?: unknown;
      website?: unknown;
    };
    if (!validSegment(body.segment)) return NextResponse.json({ error: 'Invalid dismount segment.' }, { status: 400 });
    if (!isDismountObservation(body.observation)) return NextResponse.json({ error: 'Choose what you observed.' }, { status: 400 });
    if (typeof body.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'Submission could not be accepted.' }, { status: 400 });
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) {
      return NextResponse.json({ error: 'Observation must be 500 characters or fewer.' }, { status: 400 });
    }

    await enforceVoteRateLimit(request, contributor.uid);
    const report: StoredDismountReport = {
      dataset: body.segment.dataset,
      segmentId: body.segment.segmentId,
      reporterKey: digest(contributor.uid),
      contributorUid: contributor.uid,
      contributorEmail: contributor.email,
      contributorName: contributor.name,
      observation: body.observation,
      note: typeof body.note === 'string' ? body.note.trim() : '',
      segment: body.segment,
      updatedAt: new Date().toISOString(),
    };
    await saveDismountReport(report);
    return NextResponse.json(await reportSummary(report.dataset, report.segmentId, contributor.uid));
  } catch (error) {
    console.error('[Dismount reports POST]', error);
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': String(error.retryAfter) } });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Report could not be saved.' }, { status: 503 });
  }
}
