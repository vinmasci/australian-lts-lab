import assert from 'node:assert/strict';
import test from 'node:test';
import { googleStreetViewUrl } from '../lib/google-maps';

test('opens Street View at the exact selected map point without an API key', () => {
  const url = new URL(googleStreetViewUrl([144.977113, -37.77056]));

  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/@');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('map_action'), 'pano');
  assert.equal(url.searchParams.get('viewpoint'), '-37.770560,144.977113');
});
