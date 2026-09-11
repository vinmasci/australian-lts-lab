import { NextRequest, NextResponse } from 'next/server';
import { firestoreConfigured, recentCommunitySegments } from '@/lib/lts-firestore';
import { projectApprovedLts, publishedLtsContributions } from '@/lib/lts-voting';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
  if (cursor && !/^[a-f0-9]{40}$/.test(cursor)) return NextResponse.json({ error: 'Invalid page.' }, { status: 400 });
  try {
    if (!firestoreConfigured()) {
      return NextResponse.json(await publicActivity(cursor), { headers: { 'Cache-Control': 'no-store' } });
    }
    const { items, nextCursor } = await recentCommunitySegments(cursor);
    const activity = items.filter(item => item.record.moderationStatus !== 'rejected').map(({ documentId, record, approval, votes }) => {
      const published = record.moderationStatus === 'approved' && Boolean(approval)
        && approval?.status !== 'needs_review' && approval?.status !== 'orphaned';
      const geometry = record.current.geometry;
      const points: number[][] = geometry.type === 'LineString' ? geometry.coordinates
        : geometry.type === 'Point' ? [geometry.coordinates]
        : geometry.type === 'MultiLineString' ? geometry.coordinates.flat() : [];
      const point = points[Math.floor(points.length / 2)];
      return {
        id: documentId,
        dataset: record.dataset,
        name: record.current.name || 'Unnamed road/path',
        updatedAt: record.lastContributionAt,
        status: published ? 'published' : 'pending',
        baseLts: published ? approval!.baseLts : null,
        lts: published ? projectApprovedLts(approval!.baseLts, approval!.targetLts, record.current.maxspeed) : null,
        publishedAt: published ? approval!.approvedAt : null,
        contributions: publishedLtsContributions(votes, published),
        center: point?.length >= 2 ? point.slice(0, 2) : null,
      };
    });
    return NextResponse.json({ activity, nextCursor }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Community activity is temporarily unavailable. Please try again.' }, { status: 503 });
  }
}

// The standalone preview has no production credentials. Read only the already
// public voting API, not the empty in-memory development store.
async function publicActivity(cursor?: string) {
  const datasets = ['victoria', 'nsw', 'queensland', 'western_australia', 'south_australia', 'act', 'tasmania', 'northern_territory'];
  const read = async (params: URLSearchParams) => {
    const response = await fetch(`https://ausbug.app/ltsmap/api/lts-votes?${params}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Public activity unavailable');
    return response.json();
  };
  const groups = await Promise.all(datasets.map(async dataset => {
    const data = await read(new URLSearchParams({ dataset, approved: '1' })) as { features: Array<{ properties: { segment_id: string; approved_at: string } }> };
    return data.features.map(feature => ({ dataset, segmentId: feature.properties.segment_id, at: feature.properties.approved_at,
      id: createHash('sha256').update(`${dataset}\0${feature.properties.segment_id}`).digest('hex').slice(0, 40) }));
  }));
  const all = groups.flat().sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const start = cursor ? all.findIndex(item => item.id === cursor) + 1 : 0;
  const page = all.slice(start, start + 20);
  const activity = await Promise.all(page.map(async item => {
    const summary = await read(new URLSearchParams({ dataset: item.dataset, segmentId: item.segmentId })) as import('@/lib/lts-voting').SegmentVoteSummary;
    const approval = summary.approval;
    if (!approval) return null;
    const geometry = approval.segment.geometry;
    const points = geometry.type === 'LineString' ? geometry.coordinates : geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates.flat() : [];
    const point = points[Math.floor(points.length / 2)];
    const published = summary.moderationStatus === 'approved' && approval.status !== 'needs_review' && approval.status !== 'orphaned';
    return { id: item.id, dataset: item.dataset, name: approval.segment.name || 'Unnamed road/path',
      updatedAt: approval.approvedAt, status: published ? 'published' : 'pending',
      baseLts: published ? approval.baseLts : null,
      lts: published ? projectApprovedLts(approval.baseLts, approval.targetLts, approval.segment.maxspeed) : null, publishedAt: published ? approval.approvedAt : null,
      contributions: published ? summary.publicContributions : [], center: point ? point.slice(0, 2) : null };
  }));
  return { activity: activity.filter(Boolean), nextCursor: start + 20 < all.length ? page[page.length - 1].id : null };
}
