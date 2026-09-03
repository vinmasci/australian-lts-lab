import { NextRequest, NextResponse } from 'next/server';
import { reconcileCommunityDataset, registerCommunityDataset } from '@/lib/lts-community-store';
import type { VoteSegment } from '@/lib/lts-voting';
import { reconciliationAuthorised } from '@/lib/lts-review-auth';

export const dynamic = 'force-dynamic';

const DATASETS = new Set([
  'victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory',
]);

function validSegment(value: unknown, dataset: string): value is VoteSegment {
  if (!value || typeof value !== 'object') return false;
  const segment = value as VoteSegment;
  return segment.dataset === dataset
    && typeof segment.segmentId === 'string' && segment.segmentId.length > 0 && segment.segmentId.length <= 160
    && typeof segment.name === 'string' && segment.name.length <= 160
    && Number.isInteger(segment.currentLts) && segment.currentLts >= 1 && segment.currentLts <= 4
    && Boolean(segment.geometry && ['Point', 'LineString', 'MultiLineString'].includes(segment.geometry.type));
}

export async function POST(request: NextRequest) {
  if (!await reconciliationAuthorised(request)) return NextResponse.json({ error: 'Reviewer or reconciliation authorisation required.' }, { status: 401 });
  try {
    const body = await request.json() as {
      dataset?: unknown;
      segments?: unknown;
      complete?: unknown;
      datasetVersion?: unknown;
      classifierVersion?: unknown;
      osmSnapshotDate?: unknown;
    };
    if (typeof body.dataset !== 'string' || !DATASETS.has(body.dataset)) {
      return NextResponse.json({ error: 'A valid dataset is required.' }, { status: 400 });
    }
    if (!Array.isArray(body.segments) || body.segments.length > 10_000 || body.segments.some((segment) => !validSegment(segment, body.dataset as string))) {
      return NextResponse.json({ error: 'Supply no more than 10,000 valid current contribution segments.' }, { status: 400 });
    }
    const complete = body.complete === true;
    const result = await reconcileCommunityDataset(body.dataset, body.segments, complete);
    await registerCommunityDataset(body.dataset, {
      currentVersion: typeof body.datasetVersion === 'string' ? body.datasetVersion : null,
      classifierVersion: typeof body.classifierVersion === 'string' ? body.classifierVersion : null,
      osmSnapshotDate: typeof body.osmSnapshotDate === 'string' ? body.osmSnapshotDate : null,
      lastFullReconciliationAt: complete ? new Date().toISOString() : null,
      lastReconciliationComplete: complete,
      lastReconciliationResult: result,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[LTS dataset reconciliation]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dataset reconciliation failed.' }, { status: 503 });
  }
}
