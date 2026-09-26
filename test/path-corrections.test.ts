import assert from 'node:assert/strict';
import test from 'node:test';
import { canCorrectPath, validPathSegment, pathApprovalError, mergePathCorrections } from '@/lib/path-corrections';
import type { VoteSegment } from '@/lib/lts-voting';
const segment: VoteSegment = { dataset: 'victoria', segmentId: 'segment:w123', name: 'Test path', currentLts: 1, featureKind: 'segment', osmId: 'w123', highway: 'path', trailRouting: 'caution', isMtb: false, datasetVersion: '2026-09-26:classifier-1', geometry: { type: 'LineString', coordinates: [[145,-37],[145.001,-37]] } };
test('only individual pink unverified OSM paths are eligible', () => {
  assert.equal(canCorrectPath(segment), true);
  assert.equal(canCorrectPath({ ...segment, trailRouting: 'avoid' }), true);
  for (const change of [{ trailRouting: 'normal' }, { highway: 'residential' }, { isMtb: true }, { segmentId: 'segment:w123:forward' }, { featureKind: 'dismount' }]) assert.equal(canCorrectPath({ ...segment, ...change }), false);
});
test('submission requires a bounded valid line and dataset revision', () => {
  assert.equal(validPathSegment(segment), true);
  for (const change of [{ datasetVersion: undefined }, { dataset: 'made_up' }, { geometry: { type: 'LineString', coordinates: [[999,-37],[145,-37]] } }, { geometry: { type: 'LineString', coordinates: [[145,-37]] } }]) assert.equal(validPathSegment({ ...segment, ...change }), false);
});
test('review never relaxes explicit access or technical constraints', () => {
  assert.equal(pathApprovalError({ highway: 'path' }, 'cycling'), null);
  assert.ok(pathApprovalError({ highway: 'path', bicycle: 'no' }, 'cycling'));
  assert.ok(pathApprovalError({ highway: 'path', access: 'private' }, 'mtb'));
  assert.ok(pathApprovalError({ highway: 'path', foot: 'no' }, 'walking'));
  assert.ok(pathApprovalError({ highway: 'path', 'mtb:scale': '3' }, 'cycling'));
  assert.equal(pathApprovalError({ highway: 'path', 'mtb:scale': '3' }, 'mtb'), null);
});
test('path publication preserves an existing LTS vote and uses verified geometry', () => {
  const base: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', id: segment.segmentId, properties: { segment_id: segment.segmentId, lts: 2, rideability: 3 }, geometry: segment.geometry }] };
  const correction = { segment, pathType: 'mtb' as const, osmVersion: 7, approvedAt: 'now' };
  const merged = mergePathCorrections(base, [correction]);
  assert.equal(merged.features.length, 1);
  assert.equal(merged.features[0].properties?.lts, 2);
  assert.equal(merged.features[0].properties?.rideability, 3);
  assert.equal(merged.features[0].properties?.path_type, 'mtb');
  assert.equal(merged.features[0].properties?.path_only, false);
  assert.equal(merged.features[0].properties?.osm_version, 7);
  assert.equal(mergePathCorrections({ type: 'FeatureCollection', features: [] }, [correction]).features[0].properties?.path_only, true);
});
