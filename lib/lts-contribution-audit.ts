import type {
  LtsVoteLevel,
  RideabilityIssue,
  RideabilityLevel,
  StoredLtsVote,
} from '@/lib/lts-voting';

export const CONTRIBUTION_TRACKED_FIELDS = [
  'targetLts',
  'rideability',
  'rideabilityIssues',
  'ltsReason',
  'observation',
] as const;

export type ContributionTrackedField = (typeof CONTRIBUTION_TRACKED_FIELDS)[number];
export type ContributionAction = 'created' | 'updated';
export type ContributionKind = 'lts' | 'rideability' | 'lts_and_rideability';

export interface ContributionSnapshot {
  targetLts: LtsVoteLevel | null;
  rideability: RideabilityLevel | null;
  rideabilityIssues: RideabilityIssue[];
  ltsReason: string;
  observation: string;
}

export interface LtsContributionEvent {
  schemaVersion: 1;
  action: ContributionAction;
  contributionKind: ContributionKind;
  dataset: string;
  segmentId: string;
  segmentDocumentId: string;
  segmentName: string;
  featureKind: string;
  osmId: string | null;
  sourceLts: number;
  contributorUid: string | null;
  contributorName: string;
  voterKey: string;
  occurredAt: string;
  changedFields: ContributionTrackedField[];
  previous: ContributionSnapshot | null;
  current: ContributionSnapshot;
}

function contributionSnapshot(vote: StoredLtsVote): ContributionSnapshot {
  return {
    targetLts: vote.targetLts ?? null,
    rideability: vote.rideability ?? null,
    rideabilityIssues: [...(vote.rideabilityIssues ?? [])].sort(),
    ltsReason: vote.ltsReason ?? '',
    observation: vote.note,
  };
}

function contributionKind(snapshot: ContributionSnapshot): ContributionKind {
  if (snapshot.targetLts !== null && snapshot.rideability !== null) return 'lts_and_rideability';
  return snapshot.targetLts !== null ? 'lts' : 'rideability';
}

function changedFields(previous: ContributionSnapshot | null, current: ContributionSnapshot): ContributionTrackedField[] {
  if (!previous) return [...CONTRIBUTION_TRACKED_FIELDS];
  return CONTRIBUTION_TRACKED_FIELDS.filter((field) => {
    if (field === 'rideabilityIssues') {
      return JSON.stringify(previous[field]) !== JSON.stringify(current[field]);
    }
    return previous[field] !== current[field];
  });
}

export function createLtsContributionEvent(
  vote: StoredLtsVote,
  previousVote: StoredLtsVote | null,
  segmentDocumentId: string,
): LtsContributionEvent {
  const current = contributionSnapshot(vote);
  const previous = previousVote ? contributionSnapshot(previousVote) : null;
  return {
    schemaVersion: 1,
    action: previous ? 'updated' : 'created',
    contributionKind: contributionKind(current),
    dataset: vote.dataset,
    segmentId: vote.segmentId,
    segmentDocumentId,
    segmentName: vote.segment.name,
    featureKind: vote.segment.featureKind,
    osmId: vote.segment.osmId ?? null,
    sourceLts: vote.currentLts,
    contributorUid: vote.contributorUid ?? null,
    contributorName: vote.contributorName,
    voterKey: vote.voterKey,
    occurredAt: vote.updatedAt,
    changedFields: changedFields(previous, current),
    previous,
    current,
  };
}
