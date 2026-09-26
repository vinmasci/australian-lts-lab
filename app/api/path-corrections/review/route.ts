import { NextRequest, NextResponse } from 'next/server';
import { authenticatedReviewer } from '@/lib/lts-review-auth';
import { getPathCorrection, listPathCorrections, decidePathCorrection } from '@/lib/path-correction-store';
import { currentPath } from '@/lib/path-correction-osm';
import { isPathType, pathApprovalError, validPathSegment, type PathCorrection, type PublishedPathCorrection } from '@/lib/path-corrections';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  if (!await authenticatedReviewer(request)) return NextResponse.json({ error: 'Reviewer sign-in required.' }, { status: 401 });
  try {
    const status = request.nextUrl.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected'].includes(status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    const dataset = request.nextUrl.searchParams.get('dataset');
    return NextResponse.json({ items: (await listPathCorrections(status as PathCorrection['status'])).filter(r => !dataset || r.segment.dataset === dataset) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Path correction review is unavailable.' }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const reviewer = await authenticatedReviewer(request);
  if (!reviewer) return NextResponse.json({ error: 'Reviewer sign-in required.' }, { status: 401 });
  try {
    const body = await request.json();
    if (!['approve', 'reject'].includes(body.action) || typeof body.id !== 'string' || !/^[a-f0-9]{64}$/.test(body.id)
      || !isPathType(body.pathType) || typeof body.reviewNote !== 'string' || !body.reviewNote.trim() || body.reviewNote.length > 500) {
      return NextResponse.json({ error: 'Choose the path type and explain the review decision.' }, { status: 400 });
    }
    const report = await getPathCorrection(body.id);
    if (!report) return NextResponse.json({ error: 'Correction not found.' }, { status: 404 });
    if (report.updatedAt !== body.updatedAt) return NextResponse.json({ error: 'This correction changed. Refresh before reviewing.' }, { status: 409 });
    let published: PublishedPathCorrection | null = null;
    if (body.action === 'approve' && body.pathType !== 'unsure') {
      if (!validPathSegment(report.segment)) return NextResponse.json({ error: 'This correction is not for an eligible pink path.' }, { status: 400 });
      const evidence = await currentPath(report.segment.osmId!);
      const invalid = pathApprovalError(evidence.tags, body.pathType);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 409 });
      published = { segment: { ...report.segment, geometry: evidence.geometry }, pathType: body.pathType, osmVersion: evidence.version, approvedAt: new Date().toISOString() };
    }
    await decidePathCorrection({ ...report, pathType: body.pathType }, body.action, reviewer, body.reviewNote.trim(), published);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Review could not be saved.' }, { status: 503 }); }
}
