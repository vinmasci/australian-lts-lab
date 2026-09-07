import 'server-only';

import {
  communityFirestore,
  firestoreConfigured,
  segmentDocumentId,
} from '@/lib/lts-firestore';
import { listVoteRecords, writeVoteRecord } from '@/lib/lts-vote-store';
import type { StoredDismountReport } from '@/lib/dismount-reporting';

const COLLECTION = 'ltsDismountReports';

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function saveDismountReport(report: StoredDismountReport): Promise<void> {
  const documentId = segmentDocumentId(report.dataset, report.segmentId);
  if (!firestoreConfigured()) {
    await writeVoteRecord(
      `dismount-reports/${report.dataset}/${documentId}/${report.reporterKey}.json`,
      report,
    );
    return;
  }

  const db = communityFirestore();
  const reference = db.collection(COLLECTION).doc(documentId);
  const { geometry, ...segmentProperties } = report.segment;
  const batch = db.batch();
  batch.set(reference, clean({
    dataset: report.dataset,
    segmentId: report.segmentId,
    segment: { ...segmentProperties, geometryJson: JSON.stringify(geometry) },
    lastReportAt: report.updatedAt,
    reviewStatus: report.observation === 'no_sign_visible' ? 'needs_verification' : 'observed',
  }), { merge: true });
  batch.set(reference.collection('reports').doc(report.reporterKey), clean({
    ...report,
    segment: { ...segmentProperties, geometryJson: JSON.stringify(geometry) },
  }));
  await batch.commit();
}

export async function readDismountReports(dataset: string, segmentId: string): Promise<StoredDismountReport[]> {
  const documentId = segmentDocumentId(dataset, segmentId);
  if (!firestoreConfigured()) {
    return (await listVoteRecords<StoredDismountReport>(
      `dismount-reports/${dataset}/${documentId}/`,
      1000,
    )).filter((report) => report.dataset === dataset && report.segmentId === segmentId);
  }

  const snapshot = await communityFirestore().collection(COLLECTION).doc(documentId).collection('reports').get();
  return snapshot.docs.map((document) => {
    const value = document.data();
    const segment = value.segment || {};
    const { geometryJson, ...segmentProperties } = segment;
    return clean({
      ...value,
      segment: {
        ...segmentProperties,
        geometry: typeof geometryJson === 'string' ? JSON.parse(geometryJson) : segment.geometry,
      },
    }) as StoredDismountReport;
  });
}
