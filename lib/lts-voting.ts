export const LTS_VOTE_LEVELS = [1, 1.5, 2, 3, 4] as const;
export const RIDEABILITY_LEVELS = [1, 2, 3, 4] as const;
export const RIDEABILITY_ISSUES = ['loose_surface', 'corrugations', 'potholes_ruts', 'uneven_stone', 'slippery_wet'] as const;

export type LtsVoteLevel = (typeof LTS_VOTE_LEVELS)[number];
export type RideabilityLevel = (typeof RIDEABILITY_LEVELS)[number];
export type RideabilityIssue = (typeof RIDEABILITY_ISSUES)[number];

export const LTS_VOTE_COLOURS: Record<LtsVoteLevel, string> = {
  1: '#16a34a',
  1.5: '#06b6d4',
  2: '#2563eb',
  3: '#f59e0b',
  4: '#dc2626',
};

export const LTS_VOTE_LABELS: Record<LtsVoteLevel, string> = {
  1: 'Very low stress',
  1.5: 'Quiet trafficable road',
  2: 'Low stress',
  3: 'Higher stress',
  4: 'High stress',
};

export const LTS_VOTE_DESCRIPTIONS: Record<LtsVoteLevel, string> = {
  1: 'Traffic-free, protected or calm enough for children and less-confident riders.',
  1.5: 'A trafficable road above 30 km/h that carries very little motor traffic.',
  2: 'Generally comfortable for most adults, with low traffic stress or useful separation.',
  3: 'Noticeable traffic stress, suited to more-confident riders who can tolerate moderate interaction.',
  4: 'High stress from fast or heavy traffic, difficult crossings or little meaningful separation.',
};

export const RIDEABILITY_LABELS: Record<RideabilityLevel, string> = {
  1: 'Any bike',
  2: 'Commuter or hybrid',
  3: 'Wider tyres advised',
  4: 'Specialist bike or walk',
};

export const RIDEABILITY_DESCRIPTIONS: Record<RideabilityLevel, string> = {
  1: 'Smooth and predictable: asphalt, concrete or very smooth setts.',
  2: 'Firm with minor vibration or loose material: compacted gravel or well-laid bluestone.',
  3: 'Rough enough to slow riders considerably: loose gravel, corrugations, potholes or rough setts.',
  4: 'Difficult or unreliable: deep gravel, sand, mud, severe ruts or very rough stone.',
};

export const RIDEABILITY_ISSUE_LABELS: Record<RideabilityIssue, string> = {
  loose_surface: 'Loose surface',
  corrugations: 'Corrugations',
  potholes_ruts: 'Potholes or ruts',
  uneven_stone: 'Uneven stone',
  slippery_wet: 'Slippery or muddy when wet',
};

export interface VoteSegment {
  dataset: string;
  segmentId: string;
  name: string;
  featureKind: string;
  currentLts: number;
  geometry: GeoJSON.Geometry;
  osmId?: string;
  direction?: string;
  maxspeed?: number;
  trafficAadt?: number;
  datasetVersion?: string;
  classifierVersion?: string;
  osmSnapshotDate?: string;
}

export type ReconciliationStatus = 'current' | 'carried_forward' | 'needs_review' | 'orphaned';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface ReviewerAudit {
  uid: string;
  email: string;
  name: string;
  note: string;
}

export interface StoredLtsVote {
  dataset: string;
  segmentId: string;
  voterKey: string;
  contributorName: string;
  contributorUid?: string;
  contributorEmail?: string;
  targetLts?: LtsVoteLevel | null;
  rideability?: RideabilityLevel | null;
  rideabilityIssues?: RideabilityIssue[];
  currentLts: number;
  ltsReason?: string;
  note: string;
  segment: VoteSegment;
  updatedAt: string;
}

export interface LtsApproval {
  dataset: string;
  segmentId: string;
  targetLts: LtsVoteLevel;
  approvedLts: LtsVoteLevel;
  approvedRideability?: RideabilityLevel | null;
  baseLts: number;
  segment: VoteSegment;
  approvedAt: string;
  voteCountAtApproval: number;
  status?: ReconciliationStatus;
  statusReason?: string;
  approvedAgainstVersion?: string;
  currentDatasetVersion?: string;
  lastReconciledAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}

export type VoteCounts = Record<string, number>;

export interface PublicLtsContribution {
  contributorName: string;
  targetLts: LtsVoteLevel | null;
  rideability: RideabilityLevel | null;
  rideabilityIssues: RideabilityIssue[];
  ltsReason: string;
  observation: string;
  updatedAt: string;
}

export interface SegmentVoteSummary {
  counts: VoteCounts;
  total: number;
  leadingTarget: LtsVoteLevel | null;
  projectedLts: LtsVoteLevel | null;
  yourVote: LtsVoteLevel | null;
  yourContributorName: string;
  yourLtsReason: string;
  rideabilityCounts: VoteCounts;
  rideabilityTotal: number;
  communityRideability: RideabilityLevel | null;
  yourRideability: RideabilityLevel | null;
  yourRideabilityIssues: RideabilityIssue[];
  yourObservation: string;
  publicContributions: PublicLtsContribution[];
  moderationStatus: ModerationStatus | null;
  approval: LtsApproval | null;
}

export interface ReviewVote {
  contributorName: string;
  contributorEmail?: string;
  targetLts: LtsVoteLevel | null;
  rideability: RideabilityLevel | null;
  rideabilityIssues: RideabilityIssue[];
  ltsReason: string;
  note: string;
  updatedAt: string;
}

export interface ReviewQueueItem {
  dataset: string;
  segmentId: string;
  segment: VoteSegment;
  moderationStatus: ModerationStatus;
  lastContributionAt: string;
  lastReviewedAt?: string;
  reviewNote?: string;
  votes: ReviewVote[];
  counts: VoteCounts;
  rideabilityCounts: VoteCounts;
  leadingTarget: LtsVoteLevel | null;
  projectedLts: LtsVoteLevel | null;
  communityRideability: RideabilityLevel | null;
  approval: LtsApproval | null;
}

export function isLtsVoteLevel(value: unknown): value is LtsVoteLevel {
  return typeof value === 'number' && LTS_VOTE_LEVELS.includes(value as LtsVoteLevel);
}

export function isRideabilityLevel(value: unknown): value is RideabilityLevel {
  return typeof value === 'number' && RIDEABILITY_LEVELS.includes(value as RideabilityLevel);
}

export function isRideabilityIssue(value: unknown): value is RideabilityIssue {
  return typeof value === 'string' && RIDEABILITY_ISSUES.includes(value as RideabilityIssue);
}

function publicContributorName(vote: StoredLtsVote): string {
  const name = typeof vote.contributorName === 'string'
    ? vote.contributorName.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
    : '';
  const emailPrefix = typeof vote.contributorEmail === 'string' ? vote.contributorEmail.split('@')[0]?.toLowerCase() : '';
  return name && name.toLowerCase() !== emailPrefix ? name : 'AusBUG rider';
}

export function publishedLtsContributions(votes: StoredLtsVote[], published: boolean): PublicLtsContribution[] {
  if (!published) return [];
  return votes
    .filter((vote) => Boolean(vote.contributorUid) && (Boolean(vote.ltsReason?.trim()) || Boolean(vote.note?.trim())))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((vote) => ({
      contributorName: publicContributorName(vote),
      targetLts: isLtsVoteLevel(vote.targetLts) ? vote.targetLts : null,
      rideability: isRideabilityLevel(vote.rideability) ? vote.rideability : null,
      rideabilityIssues: (vote.rideabilityIssues || []).filter(isRideabilityIssue),
      ltsReason: typeof vote.ltsReason === 'string' ? vote.ltsReason.trim().slice(0, 500) : '',
      observation: typeof vote.note === 'string' ? vote.note.trim().slice(0, 500) : '',
      updatedAt: vote.updatedAt,
    }));
}

export function hardSpeedRuleFloor(currentLts: number, maxspeed?: number): LtsVoteLevel | null {
  if (!Number.isFinite(maxspeed) || Number(maxspeed) < 70) return null;
  return Math.min(4, Math.max(1, Math.ceil(currentLts))) as LtsVoteLevel;
}

export function applyHardSpeedRuleFloor(currentLts: number, proposedLts: LtsVoteLevel, maxspeed?: number): LtsVoteLevel {
  const hardFloor = hardSpeedRuleFloor(currentLts, maxspeed);
  return hardFloor === null ? proposedLts : Math.max(proposedLts, hardFloor) as LtsVoteLevel;
}

export function projectApprovedLts(currentLts: number, targetLts: LtsVoteLevel, maxspeed?: number): LtsVoteLevel {
  const projected = targetLts < 3
    ? targetLts
    : Math.min(4, Math.max(1, Math.ceil((currentLts + targetLts) / 2))) as LtsVoteLevel;
  return applyHardSpeedRuleFloor(currentLts, projected, maxspeed);
}

export function leadingVote(counts: VoteCounts): LtsVoteLevel | null {
  return [...LTS_VOTE_LEVELS]
    .reverse()
    .reduce<LtsVoteLevel | null>((leader, level) => {
      if (!counts[String(level)]) return leader;
      if (leader === null || counts[String(level)] > counts[String(leader)]) return level;
      return leader;
    }, null);
}

export function emptyVoteCounts(): VoteCounts {
  return Object.fromEntries(LTS_VOTE_LEVELS.map((level) => [String(level), 0]));
}

export function emptyRideabilityCounts(): VoteCounts {
  return Object.fromEntries(RIDEABILITY_LEVELS.map((level) => [String(level), 0]));
}

export function medianRideability(counts: VoteCounts): RideabilityLevel | null {
  const total = RIDEABILITY_LEVELS.reduce((sum, level) => sum + (counts[String(level)] || 0), 0);
  if (!total) return null;
  const midpoint = Math.floor(total / 2) + 1;
  let cumulative = 0;
  for (const level of RIDEABILITY_LEVELS) {
    cumulative += counts[String(level)] || 0;
    if (cumulative >= midpoint) return level;
  }
  return null;
}
