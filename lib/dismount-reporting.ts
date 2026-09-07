export const DISMOUNT_OBSERVATIONS = ['sign_present', 'no_sign_visible', 'unsure'] as const;

export type DismountObservation = (typeof DISMOUNT_OBSERVATIONS)[number];

export const DISMOUNT_OBSERVATION_LABELS: Record<DismountObservation, string> = {
  sign_present: 'Dismount sign present',
  no_sign_visible: 'No dismount sign visible',
  unsure: 'Could not confirm',
};

export interface DismountReportSegment {
  dataset: string;
  segmentId: string;
  name: string;
  featureKind: 'dismount';
  geometry: GeoJSON.Geometry;
  osmId?: string;
  datasetVersion?: string;
  classifierVersion?: string;
  osmSnapshotDate?: string;
}

export interface StoredDismountReport {
  dataset: string;
  segmentId: string;
  reporterKey: string;
  contributorUid: string;
  contributorEmail: string;
  contributorName: string;
  observation: DismountObservation;
  note: string;
  segment: DismountReportSegment;
  updatedAt: string;
}

export interface DismountReportSummary {
  counts: Record<DismountObservation, number>;
  total: number;
  yourObservation: DismountObservation | null;
  yourNote: string;
  yourUpdatedAt: string | null;
}

export function isDismountObservation(value: unknown): value is DismountObservation {
  return typeof value === 'string' && DISMOUNT_OBSERVATIONS.includes(value as DismountObservation);
}

export function summariseDismountReports(
  reports: StoredDismountReport[],
  reporterKey?: string,
): DismountReportSummary {
  const latestByReporter = new Map<string, StoredDismountReport>();
  for (const report of reports) {
    if (!isDismountObservation(report.observation)) continue;
    const previous = latestByReporter.get(report.reporterKey);
    if (!previous || previous.updatedAt < report.updatedAt) latestByReporter.set(report.reporterKey, report);
  }
  const current = [...latestByReporter.values()];
  const counts: Record<DismountObservation, number> = {
    sign_present: 0,
    no_sign_visible: 0,
    unsure: 0,
  };
  for (const report of current) counts[report.observation] += 1;
  const yours = reporterKey ? latestByReporter.get(reporterKey) : undefined;
  return {
    counts,
    total: current.length,
    yourObservation: yours?.observation ?? null,
    yourNote: yours?.note ?? '',
    yourUpdatedAt: yours?.updatedAt ?? null,
  };
}
