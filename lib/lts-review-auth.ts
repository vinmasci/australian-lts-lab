import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

export const REVIEW_SESSION_COOKIE = 'ausbug_lts_review';
const SESSION_SECONDS = 8 * 60 * 60;

function reviewerSecret(): string | null {
  return process.env.LTS_VOTE_ADMIN_TOKEN?.trim() || null;
}

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function validReviewerKey(value: unknown): boolean {
  const secret = reviewerSecret();
  return Boolean(secret && typeof value === 'string' && equal(value.trim(), secret));
}

export function createReviewerSession(): { token: string; maxAge: number } {
  const secret = reviewerSecret();
  if (!secret) throw new Error('Reviewer access is not configured.');
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + SESSION_SECONDS * 1000, nonce: randomBytes(12).toString('hex') })).toString('base64url');
  return { token: `${payload}.${signature(payload, secret)}`, maxAge: SESSION_SECONDS };
}

function validSession(token: string | undefined): boolean {
  const secret = reviewerSecret();
  if (!secret || !token) return false;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra || !equal(suppliedSignature, signature(payload, secret))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { expiresAt?: unknown };
    return typeof decoded.expiresAt === 'number' && decoded.expiresAt > Date.now();
  } catch {
    return false;
  }
}


export function reviewerAuthorised(request: NextRequest): boolean {
  const secret = reviewerSecret();
  const bearer = request.headers.get('authorization');
  if (secret && bearer?.startsWith('Bearer ') && equal(bearer.slice(7).trim(), secret)) return true;
  if (validSession(request.cookies.get(REVIEW_SESSION_COOKIE)?.value)) return true;
  return !secret && process.env.NODE_ENV !== 'production' && request.headers.get('x-local-review') === 'true';
}
