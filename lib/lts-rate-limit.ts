import 'server-only';

import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { communityFirestore, firestoreConfigured } from '@/lib/lts-firestore';

interface LimitRecord {
  dailyCount: number;
  windowCount: number;
  windowStartedAt: number;
  updatedAt: string;
}

interface DevelopmentLimits {
  records: Map<string, LimitRecord>;
}

declare global {
  var __ausbugLtsRateLimits: DevelopmentLimits | undefined;
}

export class RateLimitError extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super('Too many contributions were submitted from this browser or connection. Please try again shortly.');
    this.retryAfter = retryAfter;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestNetworkKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('x-real-ip') || 'unknown';
  const salt = process.env.LTS_VOTE_HASH_SALT?.trim() || process.env.LTS_VOTE_ADMIN_TOKEN?.trim() || 'local-development-only';
  return digest(`${salt}\0${address}`);
}

async function enforceOne(key: string, burst: number, daily: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const documentId = digest(`${date}\0${key}`);
  if (!firestoreConfigured()) {
    globalThis.__ausbugLtsRateLimits ??= { records: new Map() };
    const current = globalThis.__ausbugLtsRateLimits.records.get(documentId);
    const record: LimitRecord = current || { dailyCount: 0, windowCount: 0, windowStartedAt: now, updatedAt: new Date(now).toISOString() };
    if (now - record.windowStartedAt >= windowMs) {
      record.windowStartedAt = now;
      record.windowCount = 0;
    }
    if (record.windowCount >= burst || record.dailyCount >= daily) throw new RateLimitError(Math.max(1, Math.ceil((record.windowStartedAt + windowMs - now) / 1000)));
    record.windowCount += 1;
    record.dailyCount += 1;
    record.updatedAt = new Date(now).toISOString();
    globalThis.__ausbugLtsRateLimits.records.set(documentId, record);
    return;
  }

  const reference = communityFirestore().collection('ltsRateLimits').doc(documentId);
  await communityFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists ? snapshot.data() as LimitRecord : null;
    const windowStartedAt = current && now - current.windowStartedAt < windowMs ? current.windowStartedAt : now;
    const windowCount = current && windowStartedAt === current.windowStartedAt ? current.windowCount : 0;
    const dailyCount = current?.dailyCount || 0;
    if (windowCount >= burst || dailyCount >= daily) throw new RateLimitError(Math.max(1, Math.ceil((windowStartedAt + windowMs - now) / 1000)));
    transaction.set(reference, {
      dailyCount: dailyCount + 1,
      windowCount: windowCount + 1,
      windowStartedAt,
      updatedAt: new Date(now).toISOString(),
    });
  });
}

export async function enforceVoteRateLimit(request: NextRequest, voterId: string): Promise<void> {
  await enforceOne(`network:${requestNetworkKey(request)}`, 30, 200, 10 * 60 * 1000);
  await enforceOne(`browser:${digest(voterId)}`, 40, 250, 10 * 60 * 1000);
}

export async function enforceReviewerLoginRateLimit(request: NextRequest): Promise<void> {
  await enforceOne(`review-login:${requestNetworkKey(request)}`, 10, 50, 15 * 60 * 1000);
}
