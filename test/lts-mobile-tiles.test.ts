import assert from 'node:assert/strict';
import test from 'node:test';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { fromGeojsonVt } from 'vt-pbf';
import { removeInferredWalkingContext } from '../lib/lts-mobile-tiles';
import { applyTileApprovals } from '../lib/lts-community-tiles';

function fixture() {
  const properties = [
    { feature_kind: 'dismount', highway: 'footway', confidence: 'inferred_walking', bicycle: '', routable_walk_bike: true },
    { feature_kind: 'dismount', highway: 'pedestrian', confidence: 'inferred_walking', bicycle: '', routable_walk_bike: true },
    { feature_kind: 'dismount', highway: 'footway', confidence: 'explicit_osm', bicycle: 'dismount', routable_walk_bike: true },
    { feature_kind: 'dismount', highway: 'path', confidence: 'user_report', walking_override: 'surveyed-link', routable_walk_bike: true },
    { feature_kind: 'segment', highway: 'footway', lts: 1, bicycle: 'yes' },
    { feature_kind: 'segment', highway: 'unclassified', lts: 3, confidence: 'low', is_unsealed: true },
    { feature_kind: 'crossing', lts: 3 },
    { feature_kind: 'dismount', confidence: 'inferred_walking', community_path_type: 'walking', routable_walk_bike: true },
  ];
  const features = properties.map((tags, index) => ({ id: index + 1, type: 2,
    geometry: [[[index, 2], [30 + index, 80]]], tags: { ...tags, osm_id: `w${index + 1}` } }));
  return fromGeojsonVt({ lts: { features }, other: { features: [features[0]] } } as unknown as Parameters<typeof fromGeojsonVt>[0], { version: 2, extent: 4096 });
}

test('mobile tiles remove inferred footpaths without changing cycling, signed dismount links or other layers', () => {
  const input = fixture();
  const before = new VectorTile(new Pbf(input));
  const after = new VectorTile(new Pbf(removeInferredWalkingContext(input)));
  assert.equal(after.layers.lts.length, 6);
  assert.equal(after.layers.lts.extent, before.layers.lts.extent);
  for (let i = 0; i < after.layers.lts.length; i++) {
    const retained = after.layers.lts.feature(i);
    const original = before.layers.lts.feature(i + 2);
    assert.equal(retained.id, original.id);
    assert.deepEqual(retained.properties, original.properties);
    assert.deepEqual(retained.loadGeometry(), original.loadGeometry());
  }
  assert.deepEqual(after.layers.other.feature(0).properties, before.layers.other.feature(0).properties);
  assert.deepEqual(after.layers.other.feature(0).loadGeometry(), before.layers.other.feature(0).loadGeometry());
});

test('mobile filtering is idempotent and preserves subsequent community ratings', () => {
  const filtered = removeInferredWalkingContext(fixture());
  assert.equal(removeInferredWalkingContext(filtered), filtered);
  const approved = new VectorTile(new Pbf(applyTileApprovals(filtered, new Map([['w6', 2]])))).layers.lts;
  assert.equal(approved.length, 6);
  assert.equal(approved.feature(3).properties.lts, 2);
  assert.equal(approved.feature(3).properties.is_unsealed, true);
});
