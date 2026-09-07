import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBikeAccess, orderedOsmTags, parseOsmFeatureId } from '../lib/osm-tags';

test('parses the compact OSM identifiers carried by map tiles', () => {
  assert.deepEqual(parseOsmFeatureId('w978401086'), { type: 'way', id: 978401086 });
  assert.deepEqual(parseOsmFeatureId('n123'), { type: 'node', id: 123 });
  assert.equal(parseOsmFeatureId('way/123'), null);
});

test('distinguishes explicit bicycle permission from designation', () => {
  assert.equal(assessBikeAccess({ highway: 'footway', bicycle: 'yes' }).kind, 'permitted');
  assert.equal(assessBikeAccess({ highway: 'footway', bicycle: 'designated' }).kind, 'designated');
  assert.equal(assessBikeAccess({ highway: 'cycleway' }).kind, 'designated');
});

test('does not treat an untagged footway as confirmed bicycle access', () => {
  const assessment = assessBikeAccess({ highway: 'footway' });
  assert.equal(assessment.kind, 'unconfirmed');
  assert.match(assessment.detail, /no explicit bicycle permission/i);
});

test('honours bicycle-specific prohibitions and broader access limits', () => {
  assert.equal(assessBikeAccess({ highway: 'path', bicycle: 'no' }).kind, 'prohibited');
  assert.equal(assessBikeAccess({ highway: 'path', access: 'private' }).label, 'Private access');
  assert.equal(assessBikeAccess({ highway: 'path', access: 'no', bicycle: 'yes' }).kind, 'permitted');
});

test('orders access evidence before less relevant OSM tags', () => {
  assert.deepEqual(orderedOsmTags({ surface: 'asphalt', bicycle: 'yes', highway: 'footway', name: 'Test path' }), [
    ['name', 'Test path'],
    ['highway', 'footway'],
    ['bicycle', 'yes'],
    ['surface', 'asphalt'],
  ]);
});
