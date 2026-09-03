import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import type { NextRequest } from 'next/server';
import { communityFirebaseApp, communityFirestore, firestoreConfigured } from '@/lib/lts-firestore';

export interface ReviewerIdentity {
  uid: string;
  email: string;
  name: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(request: NextRequest): string | null {
  const value = request.headers.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

export async function authenticatedReviewer(request: NextRequest): Promise<ReviewerIdentity | null> {
  if (!firestoreConfigured()) {
    return process.env.NODE_ENV !== 'production' && request.headers.get('x-local-review') === 'true'
      ? { uid: 'local-reviewer', email: 'local@localhost', name: 'Local reviewer' }
      : null;
  }
  const token = bearerToken(request);
  if (!token) return null;
  try {
    const decoded = await getAuth(communityFirebaseApp()).verifyIdToken(token);
    const email = decoded.email?.trim().toLowerCase();
    if (!email || decoded.email_verified !== true) return null;
    const access = await communityFirestore().collection('ltsReviewers').doc(digest(email)).get();
    if (!access.exists || access.data()?.active !== true) return null;
    return {
      uid: decoded.uid,
      email,
      name: typeof access.data()?.displayName === 'string' && access.data()!.displayName.trim()
        ? access.data()!.displayName.trim()
        : typeof decoded.name === 'string' && decoded.name.trim()
          ? decoded.name.trim()
          : email.split('@')[0],
    };
  } catch {
    return null;
  }
}

export async function reviewerAuthorised(request: NextRequest): Promise<boolean> {
  return Boolean(await authenticatedReviewer(request));
}

export async function reconciliationAuthorised(request: NextRequest): Promise<boolean> {
  if (await reviewerAuthorised(request)) return true;
  const secret = process.env.LTS_RECONCILE_TOKEN?.trim();
  const token = bearerToken(request);
  return Boolean(secret && token && equal(secret, token));
}
