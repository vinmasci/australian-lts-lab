import assert from 'node:assert/strict';
import test from 'node:test';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { fromGeojsonVt } from 'vt-pbf';
import { applyTileApprovals, tileApprovals } from '../lib/lts-community-tiles';

function fixture() {
  const features = [
    { id: 1, type: 2, geometry: [[[1, 2], [30, 80], [50, 90]]], tags: { feature_kind: 'segment', osm_id: 'w50882098', lts: 2, lts_forward: 2, lts_backward: 2, maxspeed: 50, name: 'Little Clyde Street', bicycle: 'dismount' } },
    { id: 2, type: 1, geometry: [[30, 80]], tags: { feature_kind: 'crossing', osm_id: 'w50882098', lts: 3 } },
    { id: 3, type: 2, geometry: [[[50, 90], [90, 100]]], tags: { feature_kind: 'segment', osm_id: 'w70', lts: 4, lts_forward: 4, lts_backward: 3, maxspeed: 70 } },
    { id: 4, type: 2, geometry: [[[20, 90], [90, 100]]], tags: { feature_kind: 'segment', osm_id: 'w99', lts: 2 } },
  ];
  return fromGeojsonVt({ lts: { features } } as unknown as Parameters<typeof fromGeojsonVt>[0], { version: 2, extent: 4096 });
}

test('shared tile changes published roads, preserves geometry, crossings, access and unrated roads', () => {
  const input = fixture();
  const original = new VectorTile(new Pbf(input)).layers.lts;
  const output = new VectorTile(new Pbf(applyTileApprovals(input, new Map([['w50882098', 1.5], ['w70', 1]])))).layers.lts;
  assert.equal(output.length, original.length);
  assert.equal(output.extent, original.extent);
  for (let i = 0; i < output.length; i++) {
    assert.deepEqual(output.feature(i).loadGeometry(), original.feature(i).loadGeometry());
    assert.equal(output.feature(i).id, original.feature(i).id);
  }
  assert.equal(output.feature(0).properties.lts, 1.5);
  assert.equal(output.feature(0).properties.base_lts, 2);
  assert.equal(output.feature(0).properties.bicycle, 'dismount');
  assert.deepEqual(output.feature(1).properties, original.feature(1).properties);
  assert.equal(output.feature(2).properties.lts, 4);
  assert.equal(output.feature(2).properties.lts_backward, 3);
  assert.deepEqual(output.feature(3).properties, original.feature(3).properties);
});

test('only current published segment ratings apply, using approved rather than requested score', () => {
  const records = [
    { dataset: 'victoria', segmentId: 'segment:w50882098', approvedLts: 1, targetLts: 2, status: 'current' },
    { dataset: 'victoria', segmentId: 'segment:w2', approvedLts: 1.5, status: 'carried_forward' },
    { dataset: 'victoria', segmentId: 'segment:w3', approvedLts: 1, status: 'needs_review' },
    { dataset: 'nsw', segmentId: 'segment:w4', approvedLts: 1 },
    { dataset: 'victoria', segmentId: 'crossing:n5', approvedLts: 1 },
    { dataset: 'victoria', segmentId: 'segment:w6', approvedLts: 9 },
    { dataset: 'victoria', segmentId: 'segment:w7', approvedLts: 1, baseLts: 4, segment: { maxspeed: 70 } },
  ];
  assert.deepEqual([...tileApprovals('victoria', records)], [['w50882098', 1], ['w2', 1.5], ['w7', 4]]);
});

test('empty / nonmatching approval snapshots return byte-identical base tiles', () => {
  const data = fixture();
  assert.equal(applyTileApprovals(data, new Map()), data);
  assert.equal(applyTileApprovals(data, new Map([['w9999', 1]])), data);
});
