import 'server-only';

import { createHash } from 'node:crypto';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { createLtsContributionEvent } from '@/lib/lts-contribution-audit';
import { bestSegmentMatch, segmentMatch } from '@/lib/lts-reconciliation';
import type { LtsApproval, ModerationStatus, ReconciliationStatus, ReviewerAudit, StoredLtsVote, VoteSegment } from '@/lib/lts-voting';

const COLLECTIONS = {
  datasets: 'ltsDatasets',
  segments: 'ltsSegments',
  approvals: 'ltsApprovals',
  published: 'ltsPublishedSegments',
  aliases: 'ltsSegmentAliases',
  decisions: 'ltsReviewDecisions',
  contributionEvents: 'ltsContributionEvents',
} as const;

interface SegmentRecord {
  dataset: string;
  canonicalSegmentId: string;
  currentSegmentId: string;
  current: VoteSegment;
  status: ReconciliationStatus;
  statusReason: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastReconciledAt: string;
  moderationStatus?: ModerationStatus;
  lastContributionAt?: string;
  lastReviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface StoredReviewItem {
  documentId: string;
  record: SegmentRecord;
  votes: StoredLtsVote[];
  approval: LtsApproval | null;
}

export interface ReconciliationResult {
  current: number;
  carriedForward: number;
  needsReview: number;
  orphaned: number;
  aliasesCreated: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function segmentDocumentId(dataset: string, segmentId: string): string {
  return digest(`${dataset}\0${segmentId}`).slice(0, 40);
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function encodeSegment(segment: VoteSegment): DocumentData {
  const { geometry, ...properties } = segment;
  return clean({ ...properties, geometryJson: JSON.stringify(geometry) });
}

function decodeSegment(value: DocumentData): VoteSegment {
  const { geometryJson, ...properties } = value;
  return clean({
    ...properties,
    geometry: typeof geometryJson === 'string' ? JSON.parse(geometryJson) as GeoJSON.Geometry : value.geometry,
  }) as VoteSegment;
}

function encodeSegmentRecord(record: SegmentRecord): DocumentData {
  return clean({ ...record, current: encodeSegment(record.current) });
}

function decodeSegmentRecord(value: DocumentData): SegmentRecord {
  return clean({ ...value, current: decodeSegment(value.current) }) as SegmentRecord;
}

function encodeVote(vote: StoredLtsVote): DocumentData {
  return clean({ ...vote, segment: encodeSegment(vote.segment) });
}

function decodeVote(value: DocumentData): StoredLtsVote {
  return clean({ ...value, segment: decodeSegment(value.segment) }) as StoredLtsVote;
}

function encodeApproval(approval: LtsApproval): DocumentData {
  return clean({ ...approval, segment: encodeSegment(approval.segment) });
}

function decodeApproval(value: DocumentData): LtsApproval {
  return clean({ ...value, segment: decodeSegment(value.segment) }) as LtsApproval;
}

export function firestoreConfigured(): boolean {
  return Boolean(process.env.LTS_FIREBASE_SERVICE_ACCOUNT_BASE64 || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export function communityFirebaseApp(): App {
  const existing = getApps().find((app) => app.name === 'ausbug-lts-community');
  if (existing) return existing;
  const projectId = (process.env.LTS_FIREBASE_PROJECT_ID || 'cyaroutes').trim();
  const encoded = process.env.LTS_FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (encoded) {
    const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Parameters<typeof cert>[0];
    return initializeApp({ credential: cert(serviceAccount), projectId }, 'ausbug-lts-community');
  }
  return initializeApp({ projectId }, 'ausbug-lts-community');
}

export function communityFirestore(): Firestore {
  if (!firestoreConfigured()) throw new Error('Firestore community storage is not configured.');
  return getFirestore(communityFirebaseApp());
}

async function canonicalDocumentId(db: Firestore, dataset: string, segmentId: string): Promise<string> {
  const direct = segmentDocumentId(dataset, segmentId);
  const alias = await db.collection(COLLECTIONS.aliases).doc(direct).get();
  return alias.exists && typeof alias.data()?.canonicalDocumentId === 'string' ? alias.data()!.canonicalDocumentId : direct;
}

async function publishApproval(db: Firestore, documentId: string, approval: LtsApproval, segment: VoteSegment, status: ReconciliationStatus, reason: string): Promise<void> {
  const reference = db.collection(COLLECTIONS.published).doc(documentId);
  if (status === 'needs_review' || status === 'orphaned') {
    await reference.delete();
    return;
  }
  await reference.set(clean({
    dataset: approval.dataset,
    segmentId: segment.segmentId,
    osmId: segment.osmId || null,
    approvedLts: approval.approvedLts,
    approvedRideability: approval.approvedRideability ?? null,
    targetLts: approval.targetLts,
    geometryJson: JSON.stringify(segment.geometry),
    status,
    statusReason: reason,
    approvedAt: approval.approvedAt,
    approvedAgainstVersion: approval.approvedAgainstVersion || null,
    currentDatasetVersion: segment.datasetVersion || null,
    lastReconciledAt: new Date().toISOString(),
  }));
}

export async function observeSegment(segment: VoteSegment): Promise<{ documentId: string; record: SegmentRecord }> {
  const db = communityFirestore();
  const documentId = await canonicalDocumentId(db, segment.dataset, segment.segmentId);
  const reference = db.collection(COLLECTIONS.segments).doc(documentId);
  const snapshot = await reference.get();
  const now = new Date().toISOString();
  const previousRecord = snapshot.exists ? decodeSegmentRecord(snapshot.data()!) : null;
  let status: ReconciliationStatus = 'current';
  let statusReason = 'Current segment observed in the active dataset.';
  let firstSeenAt = now;

  if (previousRecord) {
    const previous = previousRecord;
    firstSeenAt = previous.firstSeenAt || now;
    const match = segmentMatch(previous.current, segment);
    status = match.status;
    statusReason = match.reason;
    const approvalReference = db.collection(COLLECTIONS.approvals).doc(documentId);
    const approvalSnapshot = await approvalReference.get();
    if (approvalSnapshot.exists) {
      const approval = decodeApproval(approvalSnapshot.data()!);
      const updatedApproval = clean({
        ...approval,
        segment,
        status,
        statusReason,
        currentDatasetVersion: segment.datasetVersion,
        lastReconciledAt: now,
      });
      await approvalReference.set(encodeApproval(updatedApproval));
      await publishApproval(db, documentId, updatedApproval, segment, status, statusReason);
    }
  }

  const record: SegmentRecord = clean({
    dataset: segment.dataset,
    canonicalSegmentId: snapshot.exists ? decodeSegmentRecord(snapshot.data()!).canonicalSegmentId : segment.segmentId,
    currentSegmentId: segment.segmentId,
    current: segment,
    status,
    statusReason,
    firstSeenAt,
    lastSeenAt: now,
    lastReconciledAt: now,
    moderationStatus: status === 'needs_review' || status === 'orphaned'
      ? 'pending'
      : previousRecord?.moderationStatus,
    lastContributionAt: previousRecord?.lastContributionAt,
    lastReviewedAt: previousRecord?.lastReviewedAt,
    reviewedBy: previousRecord?.reviewedBy,
    reviewNote: previousRecord?.reviewNote,
  });
  await reference.set(encodeSegmentRecord(record));
  await db.collection(COLLECTIONS.aliases).doc(segmentDocumentId(segment.dataset, segment.segmentId)).set(clean({
    dataset: segment.dataset,
    segmentId: segment.segmentId,
    canonicalDocumentId: documentId,
    updatedAt: now,
  }));
  if (segment.datasetVersion) {
    await db.collection(COLLECTIONS.datasets).doc(segment.dataset).set(clean({
      dataset: segment.dataset,
      currentVersion: segment.datasetVersion,
      classifierVersion: segment.classifierVersion || null,
      osmSnapshotDate: segment.osmSnapshotDate || null,
      lastObservedAt: now,
    }), { merge: true });
  }
  return { documentId, record };
}

export async function writeFirestoreVote(vote: StoredLtsVote): Promise<void> {
  const { documentId } = await observeSegment(vote.segment);
  const db = communityFirestore();
  const segmentReference = db.collection(COLLECTIONS.segments).doc(documentId);
  const voteReference = segmentReference.collection('votes').doc(vote.voterKey);
  const eventReference = db.collection(COLLECTIONS.contributionEvents).doc();
  await db.runTransaction(async (transaction) => {
    const previousSnapshot = await transaction.get(voteReference);
    const previousVote = previousSnapshot.exists ? decodeVote(previousSnapshot.data()!) : null;
    const event = createLtsContributionEvent(vote, previousVote, documentId);
    transaction.set(voteReference, encodeVote(vote));
    transaction.set(segmentReference, {
      moderationStatus: 'pending',
      lastContributionAt: vote.updatedAt,
      reviewNote: null,
    }, { merge: true });
    transaction.set(eventReference, clean(event));
  });
}

export async function readFirestoreVotes(dataset: string, segmentId: string): Promise<StoredLtsVote[]> {
  const db = communityFirestore();
  const documentId = await canonicalDocumentId(db, dataset, segmentId);
  const snapshot = await db.collection(COLLECTIONS.segments).doc(documentId).collection('votes').get();
  return snapshot.docs.map((document) => decodeVote(document.data()));
}

export async function readFirestoreApproval(dataset: string, segmentId: string): Promise<LtsApproval | null> {
  const db = communityFirestore();
  const documentId = await canonicalDocumentId(db, dataset, segmentId);
  const snapshot = await db.collection(COLLECTIONS.approvals).doc(documentId).get();
  return snapshot.exists ? decodeApproval(snapshot.data()!) : null;
}

export async function readFirestoreModerationStatus(dataset: string, segmentId: string): Promise<ModerationStatus | null> {
  const db = communityFirestore();
  const documentId = await canonicalDocumentId(db, dataset, segmentId);
  const snapshot = await db.collection(COLLECTIONS.segments).doc(documentId).get();
  const value = snapshot.data()?.moderationStatus;
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : null;
}

export async function writeFirestoreApproval(approval: LtsApproval, reviewer?: ReviewerAudit): Promise<void> {
  const { documentId, record } = await observeSegment(approval.segment);
  const now = new Date().toISOString();
  const stored = clean({
    ...approval,
    segment: record.current,
    status: record.status,
    statusReason: record.statusReason,
    approvedAgainstVersion: approval.approvedAgainstVersion || record.current.datasetVersion,
    currentDatasetVersion: record.current.datasetVersion,
    lastReconciledAt: now,
  });
  const db = communityFirestore();
  await db.collection(COLLECTIONS.approvals).doc(documentId).set(encodeApproval(stored));
  await db.collection(COLLECTIONS.segments).doc(documentId).set({
    moderationStatus: 'approved',
    lastReviewedAt: now,
    reviewedBy: reviewer?.name || approval.reviewedBy || 'AusBUG reviewer',
    reviewerUid: reviewer?.uid || null,
    reviewerEmail: reviewer?.email || null,
    reviewNote: reviewer?.note || approval.reviewNote || '',
  }, { merge: true });
  await db.collection(COLLECTIONS.decisions).add(clean({
    dataset: approval.dataset,
    segmentId: approval.segmentId,
    action: 'approved',
    approvedLts: approval.approvedLts,
    approvedRideability: approval.approvedRideability ?? null,
    reviewedBy: reviewer?.name || approval.reviewedBy || 'AusBUG reviewer',
    reviewerUid: reviewer?.uid || null,
    reviewerEmail: reviewer?.email || null,
    reviewNote: reviewer?.note || approval.reviewNote || '',
    reviewedAt: now,
  }));
  await publishApproval(db, documentId, stored, record.current, record.status, record.statusReason);
}

export async function rejectFirestoreSegment(dataset: string, segmentId: string, reviewer: ReviewerAudit): Promise<void> {
  const db = communityFirestore();
  const documentId = await canonicalDocumentId(db, dataset, segmentId);
  const reference = db.collection(COLLECTIONS.segments).doc(documentId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error('Segment does not exist.');
  const now = new Date().toISOString();
  const approvalReference = db.collection(COLLECTIONS.approvals).doc(documentId);
  const publishedReference = db.collection(COLLECTIONS.published).doc(documentId);
  const approvalSnapshot = await approvalReference.get();
  const previousApproval = approvalSnapshot.exists ? decodeApproval(approvalSnapshot.data()!) : null;
  const batch = db.batch();
  batch.set(reference, {
    moderationStatus: 'rejected',
    lastReviewedAt: now,
    reviewedBy: reviewer.name,
    reviewerUid: reviewer.uid,
    reviewerEmail: reviewer.email,
    reviewNote: reviewer.note,
  }, { merge: true });
  batch.delete(approvalReference);
  batch.delete(publishedReference);
  await batch.commit();
  await db.collection(COLLECTIONS.decisions).add(clean({
    dataset,
    segmentId,
    action: 'rejected',
    previousApprovedLts: previousApproval?.approvedLts ?? null,
    previousApprovedRideability: previousApproval?.approvedRideability ?? null,
    reviewedBy: reviewer.name,
    reviewerUid: reviewer.uid,
    reviewerEmail: reviewer.email,
    reviewNote: reviewer.note,
    reviewedAt: now,
  }));
}

export async function listFirestoreReviewItems(status: ModerationStatus = 'pending', maximum = 200): Promise<StoredReviewItem[]> {
  const db = communityFirestore();
  const snapshot = await db.collection(COLLECTIONS.segments).where('moderationStatus', '==', status).limit(maximum).get();
  const items = await Promise.all(snapshot.docs.map(async (document) => {
    const [votesSnapshot, approvalSnapshot] = await Promise.all([
      document.ref.collection('votes').get(),
      db.collection(COLLECTIONS.approvals).doc(document.id).get(),
    ]);
    return {
      documentId: document.id,
      record: decodeSegmentRecord(document.data()),
      votes: votesSnapshot.docs.map((vote) => decodeVote(vote.data())),
      approval: approvalSnapshot.exists ? decodeApproval(approvalSnapshot.data()!) : null,
    };
  }));
  return items.sort((left, right) => (right.record.lastContributionAt || '').localeCompare(left.record.lastContributionAt || ''));
}

export async function listPublishedApprovals(dataset: string, maximum = 5000): Promise<DocumentData[]> {
  const snapshot = await communityFirestore().collection(COLLECTIONS.published)
    .where('dataset', '==', dataset).limit(maximum).get();
  return snapshot.docs.map((document) => {
    const value = document.data();
    const { geometryJson, ...properties } = value;
    return clean({ ...properties, geometry: typeof geometryJson === 'string' ? JSON.parse(geometryJson) : value.geometry });
  });
}

export async function registerDataset(dataset: string, values: Record<string, unknown>): Promise<void> {
  await communityFirestore().collection(COLLECTIONS.datasets).doc(dataset).set(clean({
    ...values,
    dataset,
    updatedAt: new Date().toISOString(),
  }), { merge: true });
}

export async function reconcileDataset(dataset: string, candidates: VoteSegment[], complete: boolean): Promise<ReconciliationResult> {
  const db = communityFirestore();
  const existingSnapshot = await db.collection(COLLECTIONS.segments).where('dataset', '==', dataset).get();
  const result: ReconciliationResult = { current: 0, carriedForward: 0, needsReview: 0, orphaned: 0, aliasesCreated: 0 };
  const now = new Date().toISOString();

  for (const document of existingSnapshot.docs) {
    const previous = decodeSegmentRecord(document.data());
    const exact = candidates.find((candidate) => candidate.segmentId === previous.currentSegmentId);
    const likelyPool = candidates.filter((candidate) =>
      (previous.current.osmId && candidate.osmId === previous.current.osmId)
      || candidate.name === previous.current.name);
    const best = exact
      ? { segment: exact, match: segmentMatch(previous.current, exact), ambiguous: false }
      : bestSegmentMatch(previous.current, likelyPool.length ? likelyPool : candidates);
    let status: ReconciliationStatus;
    let reason: string;
    let current = previous.current;
    if (!best) {
      if (!complete) continue;
      status = 'orphaned';
      reason = 'No matching segment exists in the complete refreshed contribution manifest.';
    } else {
      current = best.segment;
      status = best.ambiguous ? 'needs_review' : best.match.status;
      reason = best.ambiguous ? 'Two or more refreshed segments are similarly plausible matches.' : best.match.reason;
      if (current.segmentId !== previous.currentSegmentId && status !== 'orphaned') {
        await db.collection(COLLECTIONS.aliases).doc(segmentDocumentId(dataset, current.segmentId)).set(clean({
          dataset,
          segmentId: current.segmentId,
          previousSegmentId: previous.currentSegmentId,
          canonicalDocumentId: document.id,
          matchScore: best.match.score,
          updatedAt: now,
        }));
        result.aliasesCreated += 1;
      }
    }
    if (status === 'current') result.current += 1;
    if (status === 'carried_forward') result.carriedForward += 1;
    if (status === 'needs_review') result.needsReview += 1;
    if (status === 'orphaned') result.orphaned += 1;
    await document.ref.set(encodeSegmentRecord(clean({
      ...previous,
      currentSegmentId: current.segmentId,
      current,
      status,
      statusReason: reason,
      moderationStatus: status === 'needs_review' || status === 'orphaned' ? 'pending' : previous.moderationStatus,
      lastReconciledAt: now,
      lastSeenAt: now,
    })));
    const approvalReference = db.collection(COLLECTIONS.approvals).doc(document.id);
    const approvalSnapshot = await approvalReference.get();
    if (approvalSnapshot.exists) {
      const approval = clean({ ...decodeApproval(approvalSnapshot.data()!), segment: current, status, statusReason: reason, currentDatasetVersion: current.datasetVersion, lastReconciledAt: now }) as LtsApproval;
      await approvalReference.set(encodeApproval(approval));
      await publishApproval(db, document.id, approval, current, status, reason);
    }
  }
  return result;
}
