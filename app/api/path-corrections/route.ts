import { NextRequest, NextResponse } from 'next/server';
import { authenticatedContributor } from '@/lib/lts-review-auth';
import { currentPath } from '@/lib/path-correction-osm';
import { enforceVoteRateLimit, RateLimitError } from '@/lib/lts-rate-limit';
import { isPathType, validPathSegment, pathApprovalError, type PathCorrection, type PublishedPathCorrection } from '@/lib/path-corrections';
import { publishPathCorrection, getPathCorrection, pathCorrectionId } from '@/lib/path-correction-store';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const identity = await authenticatedContributor(request);
  if (!identity) return NextResponse.json({ error: 'Sign in to view your path correction.' }, { status: 401 });
  try {
    const id = pathCorrectionId(request.nextUrl.searchParams.get('dataset') || '', request.nextUrl.searchParams.get('segmentId') || '', identity.uid);
    const report = await getPathCorrection(id);
    return NextResponse.json({ report: report ? { pathType: report.pathType, note: report.note, status: report.status } : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Path corrections are unavailable.' }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const identity = await authenticatedContributor(request);
  if (!identity) return NextResponse.json({ error: 'Sign in with an AusBUG account first.' }, { status: 401 });
  try {
    const body = await request.json();
    if (!validPathSegment(body.segment) || !isPathType(body.pathType) || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500 || body.website) {
      return NextResponse.json({ error: 'Select one pink, unverified path and describe what you observed.' }, { status: 400 });
    }
    await enforceVoteRateLimit(request, identity.uid);
    const report: PathCorrection = {
      id: pathCorrectionId(body.segment.dataset, body.segment.segmentId, identity.uid), segment: body.segment,
      pathType: body.pathType, note: body.note.trim(), contributorUid: identity.uid,
      contributorEmail: identity.email, contributorName: identity.name, updatedAt: new Date().toISOString(), status: 'pending',
    };
    let published: PublishedPathCorrection | null = null;
    if (report.pathType !== 'unsure') {
      const evidence = await currentPath(report.segment.osmId!);
      const invalid = pathApprovalError(evidence.tags, report.pathType);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 409 });
      published = { segment: { ...report.segment, geometry: evidence.geometry }, pathType: report.pathType,
        osmVersion: evidence.version, approvedAt: report.updatedAt };
    }
    const saved = await publishPathCorrection(report, published, identity);
    return NextResponse.json({ report: { pathType: saved.pathType, note: saved.note, status: saved.status } });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': String(error.retryAfter) } });
    return NextResponse.json({ error: 'Your correction could not be saved. Please retry.' }, { status: 503 });
  }
}
