import { NextRequest, NextResponse } from 'next/server';
import { createReviewerSession, REVIEW_SESSION_COOKIE, reviewerAuthorised, validReviewerKey } from '@/lib/lts-review-auth';
import { enforceReviewerLoginRateLimit, RateLimitError } from '@/lib/lts-rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: reviewerAuthorised(request) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  try {
    await enforceReviewerLoginRateLimit(request);
    const body = await request.json() as { accessKey?: unknown };
    if (!validReviewerKey(body.accessKey)) return NextResponse.json({ error: 'The reviewer access key is incorrect.' }, { status: 401 });
    const session = createReviewerSession();
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(REVIEW_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: session.maxAge,
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': String(error.retryAfter) } });
    }
    return NextResponse.json({ error: 'Reviewer session could not be started.' }, { status: 503 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(REVIEW_SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
