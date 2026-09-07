import assert from 'node:assert/strict';
import test from 'node:test';
import { summariseDismountReports, type StoredDismountReport } from '@/lib/dismount-reporting';

function report(reporterKey: string, observation: StoredDismountReport['observation'], updatedAt: string): StoredDismountReport {
  return {
    dataset: 'victoria',
    segmentId: 'dismount:w11587839',
    reporterKey,
    contributorUid: reporterKey,
    contributorEmail: `${reporterKey}@example.com`,
    contributorName: reporterKey,
    observation,
    note: observation,
    updatedAt,
    segment: {
      dataset: 'victoria',
      segmentId: 'dismount:w11587839',
      name: 'Station crossing',
      featureKind: 'dismount',
      osmId: 'w11587839',
      geometry: { type: 'LineString', coordinates: [[145.08, -37.89], [145.09, -37.9]] },
    },
  };
}

test('dismount reports keep one current observation per rider', () => {
  const summary = summariseDismountReports([
    report('alice', 'sign_present', '2026-09-01T00:00:00Z'),
    report('alice', 'no_sign_visible', '2026-09-02T00:00:00Z'),
    report('bob', 'unsure', '2026-09-03T00:00:00Z'),
  ], 'alice');

  assert.equal(summary.total, 2);
  assert.deepEqual(summary.counts, { sign_present: 0, no_sign_visible: 1, unsure: 1 });
  assert.equal(summary.yourObservation, 'no_sign_visible');
  assert.equal(summary.yourNote, 'no_sign_visible');
});
