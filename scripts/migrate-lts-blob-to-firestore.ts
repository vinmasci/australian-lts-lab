import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { list } from '@vercel/blob';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { LtsApproval, StoredLtsVote, VoteSegment } from '../lib/lts-voting';

const PREFIX = 'ausbug-lts-votes/v1';
const apply = process.argv.includes('--apply');
const encoded = process.env.LTS_FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
if (!encoded) throw new Error('LTS_FIREBASE_SERVICE_ACCOUNT_BASE64 is required.');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is required.');

const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Parameters<typeof cert>[0];
const app = initializeApp({ credential: cert(serviceAccount), projectId: (process.env.LTS_FIREBASE_PROJECT_ID || 'cyaroutes').trim() }, `lts-migration-${Date.now()}`);
const db = getFirestore(app);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function documentId(dataset: string, segmentId: string): string {
  return digest(`${dataset}\0${segmentId}`).slice(0, 40);
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function encodeSegment(segment: VoteSegment): Record<string, unknown> {
  const { geometry, ...properties } = segment;
  return clean({ ...properties, geometryJson: JSON.stringify(geometry) });
}

function encodeVote(vote: StoredLtsVote): Record<string, unknown> {
  return clean({ ...vote, segment: encodeSegment(vote.segment) });
}

function encodeApproval(approval: LtsApproval): Record<string, unknown> {
  return clean({ ...approval, segment: encodeSegment(approval.segment) });
}

async function records<T>(prefix: string): Promise<T[]> {
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${PREFIX}/${prefix}`, cursor, limit: 1000 });
    const fetched = await Promise.all(page.blobs.map(async (blob) => {
      const response = await fetch(blob.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not read ${blob.pathname}: ${response.status}`);
      return response.json() as Promise<T>;
    }));
    values.push(...fetched);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return values;
}

async function writeSegment(segment: VoteSegment, firstSeenAt: string, lastSeenAt: string): Promise<string> {
  const id = documentId(segment.dataset, segment.segmentId);
  await db.collection('ltsSegments').doc(id).set(clean({
    dataset: segment.dataset,
    canonicalSegmentId: segment.segmentId,
    currentSegmentId: segment.segmentId,
    current: encodeSegment(segment),
    status: 'current',
    statusReason: 'Imported from the Vercel Blob pilot store.',
    firstSeenAt,
    lastSeenAt,
    lastReconciledAt: lastSeenAt,
  }), { merge: true });
  await db.collection('ltsSegmentAliases').doc(id).set(clean({
    dataset: segment.dataset,
    segmentId: segment.segmentId,
    canonicalDocumentId: id,
    importedAt: lastSeenAt,
  }), { merge: true });
  return id;
}

async function main() {
  const votes = await records<StoredLtsVote>('votes/');
  const approvals = await records<LtsApproval>('approvals/');
  const latestVotes = new Map<string, StoredLtsVote>();
  for (const vote of votes) {
    const key = `${vote.dataset}\0${vote.segmentId}\0${vote.voterKey}`;
    const previous = latestVotes.get(key);
    if (!previous || previous.updatedAt < vote.updatedAt) latestVotes.set(key, vote);
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', blobVoteRecords: votes.length, latestVotes: latestVotes.size, approvals: approvals.length }));

  if (!apply) return;
  for (const vote of latestVotes.values()) {
    const id = await writeSegment(vote.segment, vote.updatedAt, vote.updatedAt);
    await db.collection('ltsSegments').doc(id).collection('votes').doc(vote.voterKey).set(encodeVote(vote));
  }
  for (const approval of approvals) {
    const id = await writeSegment(approval.segment, approval.approvedAt, approval.approvedAt);
    const stored = clean({
      ...approval,
      status: 'current',
      statusReason: 'Imported from the Vercel Blob pilot store.',
      approvedAgainstVersion: approval.segment.datasetVersion || null,
      currentDatasetVersion: approval.segment.datasetVersion || null,
      lastReconciledAt: approval.approvedAt,
    }) as LtsApproval;
    await db.collection('ltsApprovals').doc(id).set(encodeApproval(stored));
    await db.collection('ltsPublishedSegments').doc(id).set(clean({
      dataset: approval.dataset,
      segmentId: approval.segmentId,
      osmId: approval.segment.osmId || null,
      approvedLts: approval.approvedLts,
      approvedRideability: approval.approvedRideability ?? null,
      targetLts: approval.targetLts,
      geometryJson: JSON.stringify(approval.segment.geometry),
      status: 'current',
      statusReason: 'Imported from the Vercel Blob pilot store.',
      approvedAt: approval.approvedAt,
      approvedAgainstVersion: approval.segment.datasetVersion || null,
      currentDatasetVersion: approval.segment.datasetVersion || null,
      lastReconciledAt: approval.approvedAt,
    }));
  }

  const metadataFiles: Record<string, string> = {
    victoria: 'victoria-lts-metadata.json',
    nsw: 'nsw-lts-metadata.json',
    queensland: 'queensland-lts-metadata.json',
    western_australia: 'western-australia-lts-metadata.json',
    south_australia: 'south-australia-lts-metadata.json',
    act: 'act-lts-metadata.json',
    tasmania: 'tasmania-lts-metadata.json',
    northern_territory: 'northern-territory-lts-metadata.json',
  };
  for (const [dataset, filename] of Object.entries(metadataFiles)) {
    const metadata = JSON.parse(await readFile(resolve('public/data/lts', filename), 'utf8')) as Record<string, unknown>;
    const classifierVersion = String(metadata.classifier_version || 'unknown');
    const osmSnapshotDate = String(metadata.source_pbf_modified_at || 'unknown');
    await db.collection('ltsDatasets').doc(dataset).set(clean({
      dataset,
      currentVersion: `${osmSnapshotDate}:${classifierVersion}`,
      classifierVersion,
      osmSnapshotDate,
      generatedAt: metadata.generated_at || null,
      importedAt: new Date().toISOString(),
    }), { merge: true });
  }
  console.log(JSON.stringify({ migratedVotes: latestVotes.size, migratedApprovals: approvals.length, datasets: 8 }));
}

void main();
