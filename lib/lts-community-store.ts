import 'server-only';

import { createHash } from 'node:crypto';
import {
  firestoreConfigured,
  listPublishedApprovals,
  observeSegment,
  readFirestoreApproval,
  readFirestoreVotes,
  reconcileDataset,
  registerDataset,
  writeFirestoreApproval,
  writeFirestoreVote,
  type ReconciliationResult,
} from '@/lib/lts-firestore';
import { listVoteRecords, readVoteRecord, writeVoteRecord } from '@/lib/lts-vote-store';
import type { LtsApproval, StoredLtsVote, VoteSegment } from '@/lib/lts-voting';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function legacySegmentKey(dataset: string, segmentId: string): string {
  return digest(`${dataset}\0${segmentId}`).slice(0, 32);
}

export async function saveCommunityVote(vote: StoredLtsVote): Promise<void> {
  if (firestoreConfigured()) return writeFirestoreVote(vote);
  return writeVoteRecord(`votes/${vote.dataset}/${legacySegmentKey(vote.dataset, vote.segmentId)}/${vote.voterKey}-${Date.now()}.json`, vote);
}

export async function communityVotes(dataset: string, segmentId: string): Promise<StoredLtsVote[]> {
  if (firestoreConfigured()) return readFirestoreVotes(dataset, segmentId);
  return (await listVoteRecords<StoredLtsVote>(`votes/${dataset}/${legacySegmentKey(dataset, segmentId)}/`, 1000))
    .filter((vote) => vote.dataset === dataset && vote.segmentId === segmentId);
}

export async function communityApproval(dataset: string, segmentId: string): Promise<LtsApproval | null> {
  if (firestoreConfigured()) return readFirestoreApproval(dataset, segmentId);
  return readVoteRecord<LtsApproval>(`approvals/${dataset}/${legacySegmentKey(dataset, segmentId)}.json`);
}

export async function saveCommunityApproval(approval: LtsApproval): Promise<void> {
  if (firestoreConfigured()) return writeFirestoreApproval(approval);
  return writeVoteRecord(`approvals/${approval.dataset}/${legacySegmentKey(approval.dataset, approval.segmentId)}.json`, approval);
}

export async function publishedCommunityApprovals(dataset: string): Promise<Array<Record<string, unknown>>> {
  if (firestoreConfigured()) return listPublishedApprovals(dataset) as Promise<Array<Record<string, unknown>>>;
  return (await listVoteRecords<LtsApproval>(`approvals/${dataset}/`, 1000))
    .filter((approval) => approval.dataset === dataset) as unknown as Array<Record<string, unknown>>;
}

export async function observeCommunitySegment(segment: VoteSegment): Promise<void> {
  if (firestoreConfigured()) await observeSegment(segment);
}

export async function reconcileCommunityDataset(dataset: string, segments: VoteSegment[], complete: boolean): Promise<ReconciliationResult> {
  if (!firestoreConfigured()) throw new Error('Firestore is required for dataset reconciliation.');
  return reconcileDataset(dataset, segments, complete);
}

export async function registerCommunityDataset(dataset: string, values: Record<string, unknown>): Promise<void> {
  if (!firestoreConfigured()) return;
  await registerDataset(dataset, values);
}
