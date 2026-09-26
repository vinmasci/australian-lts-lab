import 'server-only';
import type { DocumentData } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { communityFirestore, firestoreConfigured, segmentDocumentId } from '@/lib/lts-firestore';
import type { ReviewerIdentity } from '@/lib/lts-review-auth';
import type { PathCorrection, PublishedPathCorrection } from '@/lib/path-corrections';

const REPORTS = 'ltsPathCorrections';
const PUBLISHED = 'ltsPublishedPathCorrections';
const DECISIONS = 'ltsPathCorrectionDecisions';
declare global { var __localPathCorrections: { reports: Map<string, PathCorrection>; published: Map<string, PublishedPathCorrection> } | undefined }
function local() {
  if (process.env.NODE_ENV === 'production') throw new Error('Path correction storage is not configured.');
  return globalThis.__localPathCorrections ??= { reports: new Map(), published: new Map() };
}
function encode(value: PathCorrection | PublishedPathCorrection) {
  const { geometry, ...segment } = value.segment;
  return JSON.parse(JSON.stringify({ ...value, segment: { ...segment, geometryJson: JSON.stringify(geometry) } }));
}
function decode<T extends PathCorrection | PublishedPathCorrection>(value: DocumentData): T {
  const { geometryJson, ...segment } = value.segment;
  return { ...value, segment: { ...segment, geometry: JSON.parse(geometryJson) } } as T;
}
export function pathCorrectionId(dataset: string, segmentId: string, uid: string): string {
  return createHash('sha256').update(`${dataset}\0${segmentId}\0${uid}`).digest('hex');
}
export async function savePathCorrection(report: PathCorrection) {
  if (!firestoreConfigured()) { local().reports.set(report.id, report); return; }
  await communityFirestore().collection(REPORTS).doc(report.id).set(encode(report));
}
export async function getPathCorrection(id: string): Promise<PathCorrection | null> {
  if (!firestoreConfigured()) return local().reports.get(id) ?? null;
  const doc = await communityFirestore().collection(REPORTS).doc(id).get();
  return doc.exists ? decode<PathCorrection>(doc.data()!) : null;
}
export async function listPathCorrections(status: PathCorrection['status']): Promise<PathCorrection[]> {
  if (!firestoreConfigured()) return [...local().reports.values()].filter(r => r.status === status);
  const docs = await communityFirestore().collection(REPORTS).where('status', '==', status).limit(200).get();
  return docs.docs.map(d => decode<PathCorrection>(d.data()));
}
export async function publishedPathCorrections(dataset: string): Promise<PublishedPathCorrection[]> {
  if (!firestoreConfigured()) return [...local().published.values()].filter(r => r.segment.dataset === dataset);
  const docs = await communityFirestore().collection(PUBLISHED).where('segment.dataset', '==', dataset).get();
  return docs.docs.map(d => decode<PublishedPathCorrection>(d.data()));
}
export async function decidePathCorrection(report: PathCorrection, action: 'approve' | 'reject', reviewer: ReviewerIdentity, reviewNote: string, published: PublishedPathCorrection | null) {
  const reviewedAt = new Date().toISOString();
  const decision = { ...report, status: action === 'approve' ? 'approved' as const : 'rejected' as const, reviewedAt, reviewedBy: reviewer.uid, reviewNote };
  const key = segmentDocumentId(report.segment.dataset, report.segment.segmentId);
  if (!firestoreConfigured()) {
    const store = local();
    if (store.reports.get(report.id)?.updatedAt !== report.updatedAt) throw new Error('This report changed; refresh before reviewing.');
    store.reports.set(report.id, decision);
    if (action === 'approve') { if (published) store.published.set(key, published); else store.published.delete(key); }
    return;
  }
  const db = communityFirestore();
  await db.runTransaction(async t => {
    const ref = db.collection(REPORTS).doc(report.id);
    const current = await t.get(ref);
    if (!current.exists || current.data()?.updatedAt !== report.updatedAt) throw new Error('This report changed; refresh before reviewing.');
    t.set(ref, encode(decision));
    t.set(db.collection(DECISIONS).doc(), { ...encode(decision), reviewer });
    if (action === 'approve') {
      const target = db.collection(PUBLISHED).doc(key);
      if (published) t.set(target, encode(published)); else t.delete(target);
    }
  });
}

/** Signed-in path edits publish atomically after current OSM access is checked. */
export async function publishPathCorrection(report: PathCorrection, published: PublishedPathCorrection | null, contributor: ReviewerIdentity) {
  const record: PathCorrection = { ...report, status: 'approved', reviewedAt: report.updatedAt, reviewedBy: contributor.uid, reviewNote: 'Applied from a signed-in path correction after current OSM access checks.' };
  const key = segmentDocumentId(report.segment.dataset, report.segment.segmentId);
  if (!firestoreConfigured()) {
    const store = local();
    if ((store.reports.get(report.id)?.updatedAt || '') > record.updatedAt) throw new Error('A newer correction was saved. Reload before retrying.');
    store.reports.set(report.id, record);
    if (published) store.published.set(key, published); else store.published.delete(key);
    return record;
  }
  const db = communityFirestore();
  await db.runTransaction(async t => {
    const ref = db.collection(REPORTS).doc(record.id);
    const current = await t.get(ref);
    if (current.exists && current.data()!.updatedAt > record.updatedAt) throw new Error('A newer correction was saved. Reload before retrying.');
    t.set(ref, encode(record));
    t.set(db.collection(DECISIONS).doc(), { ...encode(record), reviewer: contributor });
    const target = db.collection(PUBLISHED).doc(key);
    if (published) t.set(target, encode(published)); else t.delete(target);
  });
  return record;
}
