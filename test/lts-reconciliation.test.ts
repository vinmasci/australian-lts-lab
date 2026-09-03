import assert from 'node:assert/strict';
import test from 'node:test';
import { bestSegmentMatch, segmentMatch } from '@/lib/lts-reconciliation';
import type { VoteSegment } from '@/lib/lts-voting';

function segment(overrides: Partial<VoteSegment> = {}): VoteSegment {
  return {
    dataset: 'victoria',
    segmentId: 'segment:w123:forward',
    name: 'Example Street',
    featureKind: 'segment',
    currentLts: 2,
    geometry: { type: 'LineString', coordinates: [[144.97, -37.8], [144.971, -37.8]] },
    osmId: 'w123',
    direction: 'forward',
    datasetVersion: 'snapshot-a:classifier-a',
    classifierVersion: 'classifier-a',
    osmSnapshotDate: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

test('keeps an exact segment current within one dataset version', () => {
  assert.equal(segmentMatch(segment(), segment()).status, 'current');
});

test('does not treat map-tile clipping as a source change within one dataset version', () => {
  const clipped = segment({ geometry: { type: 'LineString', coordinates: [[144.9704, -37.8], [144.9706, -37.8]] } });
  const match = segmentMatch(segment(), clipped);
  assert.equal(match.status, 'current');
  assert.equal(match.materialChange, false);
});

test('carries an unchanged segment to a newer dataset version', () => {
  assert.equal(segmentMatch(segment(), segment({ datasetVersion: 'snapshot-b:classifier-a' })).status, 'carried_forward');
});

test('requires review when the refreshed classifier changes the base LTS', () => {
  const match = segmentMatch(segment(), segment({ currentLts: 3, datasetVersion: 'snapshot-b:classifier-a' }));
  assert.equal(match.status, 'needs_review');
  assert.equal(match.materialChange, true);
});

test('carries a renamed identifier when OSM provenance and geometry remain stable', () => {
  const match = segmentMatch(segment(), segment({ segmentId: 'segment:w123:forward:replacement', datasetVersion: 'snapshot-b:classifier-a' }));
  assert.equal(match.status, 'carried_forward');
});

test('does not attach a vote to an unrelated distant road', () => {
  const current = segment({
    segmentId: 'segment:w999:forward',
    osmId: 'w999',
    name: 'Other Road',
    geometry: { type: 'LineString', coordinates: [[145.5, -37.2], [145.501, -37.2]] },
  });
  assert.equal(bestSegmentMatch(segment(), [current]), null);
});
