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

export interface ContributorIdentity extends ReviewerIdentity {
  emailVerified: boolean;
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

async function firebaseIdentity(request: NextRequest): Promise<ContributorIdentity | null> {
  const token = bearerToken(request);
  if (!token) return null;
  try {
    const decoded = await getAuth(communityFirebaseApp()).verifyIdToken(token);
    const email = decoded.email?.trim().toLowerCase();
    if (!email) return null;
    return {
      uid: decoded.uid,
      email,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' && decoded.name.trim()
        ? decoded.name.trim()
        : email.split('@')[0],
    };
  } catch {
    return null;
  }
}

export async function authenticatedContributor(request: NextRequest): Promise<ContributorIdentity | null> {
  if (!firestoreConfigured()) {
    return process.env.NODE_ENV !== 'production' && request.headers.get('x-local-contributor') === 'true'
      ? { uid: 'local-contributor', email: 'contributor@localhost', name: 'Local contributor', emailVerified: true }
      : null;
  }
  return firebaseIdentity(request);
}

export async function authenticatedReviewer(request: NextRequest): Promise<ReviewerIdentity | null> {
  if (!firestoreConfigured()) {
    return process.env.NODE_ENV !== 'production' && request.headers.get('x-local-review') === 'true'
      ? { uid: 'local-reviewer', email: 'local@localhost', name: 'Local reviewer' }
      : null;
  }
  const identity = await firebaseIdentity(request);
  if (!identity) return null;
  try {
    const reviewers = communityFirestore().collection('ltsReviewers');
    const [uidAccess, verifiedEmailAccess] = await Promise.all([
      reviewers.doc(identity.uid).get(),
      identity.emailVerified ? reviewers.doc(digest(identity.email)).get() : Promise.resolve(null),
    ]);
    const access = uidAccess.exists ? uidAccess : verifiedEmailAccess;
    if (!access || !access.exists || access.data()?.active !== true) return null;
    return {
      uid: identity.uid,
      email: identity.email,
      name: typeof access.data()?.displayName === 'string' && access.data()!.displayName.trim()
        ? access.data()!.displayName.trim()
        : identity.name,
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
