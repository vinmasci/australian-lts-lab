import { NextRequest, NextResponse } from 'next/server';
import { authenticatedReviewer } from '@/lib/lts-review-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const reviewer = await authenticatedReviewer(request);
  if (!reviewer) {
    return NextResponse.json({ authenticated: false, error: 'This account is not an approved LTS reviewer.' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.json({ authenticated: true, reviewer }, { headers: { 'Cache-Control': 'no-store' } });
}
