import 'server-only';

import { createHash } from 'node:crypto';
import {
  firestoreConfigured,
  listPublishedApprovals,
  listFirestoreReviewItems,
  observeSegment,
  readFirestoreApproval,
  readFirestoreModerationStatus,
  readFirestoreVotes,
  rejectFirestoreSegment,
  reconcileDataset,
  registerDataset,
  writeFirestoreApproval,
  writeFirestoreVote,
  type ReconciliationResult,
  type StoredReviewItem,
} from '@/lib/lts-firestore';
import { listVoteRecords, readVoteRecord, writeVoteRecord } from '@/lib/lts-vote-store';
import type { LtsApproval, ModerationStatus, ReviewerAudit, StoredLtsVote, VoteSegment } from '@/lib/lts-voting';

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

export async function saveCommunityApproval(approval: LtsApproval, reviewer?: ReviewerAudit): Promise<void> {
  if (firestoreConfigured()) return writeFirestoreApproval(approval, reviewer);
  return writeVoteRecord(`approvals/${approval.dataset}/${legacySegmentKey(approval.dataset, approval.segmentId)}.json`, approval);
}

export async function communityModerationStatus(dataset: string, segmentId: string): Promise<ModerationStatus | null> {
  if (firestoreConfigured()) return readFirestoreModerationStatus(dataset, segmentId);
  return (await communityVotes(dataset, segmentId)).length ? 'pending' : null;
}

export async function communityReviewItems(status: ModerationStatus = 'pending'): Promise<StoredReviewItem[]> {
  if (!firestoreConfigured()) return [];
  return listFirestoreReviewItems(status);
}

export async function rejectCommunitySegment(dataset: string, segmentId: string, reviewer: ReviewerAudit): Promise<void> {
  if (!firestoreConfigured()) throw new Error('Firestore is required for moderation.');
  await rejectFirestoreSegment(dataset, segmentId, reviewer);
}

export async function publishedCommunityApprovals(dataset: string): Promise<Array<Record<string, unknown>>> {
  if (firestoreConfigured()) return listPublishedApprovals(dataset) as Promise<Array<Record<string, unknown>>>;
  if (process.env.NODE_ENV === 'development') {
    // Read the public production records for previews, rather than silently
    // painting an empty development store. Never forward credentials or writes.
    const read = async (params: URLSearchParams) => {
      const response = await fetch(`https://ausbug.app/ltsmap/api/lts-votes?${params}`, {
        next: { revalidate: 60 }, signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Published community records are unavailable.');
      return response.json();
    };
    const collection = await read(new URLSearchParams({ dataset, approved: '1' })) as {
      features: Array<{ properties: { segment_id: string } }>;
    };
    const approvals: Array<Record<string, unknown>> = [];
    // Bound concurrent requests; use each original vote target and base score
    // so preview calculations do not average an already-adjusted score again.
    for (let start = 0; start < collection.features.length; start += 6) {
      const batch = await Promise.all(collection.features.slice(start, start + 6).map(async feature => {
        const result = await read(new URLSearchParams({ dataset, segmentId: feature.properties.segment_id }));
        return result.approval as LtsApproval | null;
      }));
      for (const approval of batch) {
        if (approval && approval.status !== 'needs_review' && approval.status !== 'orphaned') {
          approvals.push(approval as unknown as Record<string, unknown>);
        }
      }
    }
    return approvals;
  }
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
