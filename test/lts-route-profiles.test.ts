import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoutingProfile } from '../lib/lts-route-profiles';
import { routeSectionRating } from '../lib/lts-route-ratings';

test('only the four mobile cycling profiles can reach the routing engine', () => {
  assert.equal(parseRoutingProfile(undefined), 'cyalts');
  for (const profile of ['cyalts', 'cyabikepath', 'cyabalanced', 'cyaroads']) assert.equal(parseRoutingProfile(profile), profile);
  for (const value of ['__proto__', 'constructor', 'hiking-mountain', 'car-vario', '../custom', '', null, 1]) assert.equal(parseRoutingProfile(value), null);
});
test('non-LTS profiles never interpret a cycling preference cost as traffic stress', () => {
  assert.deepEqual(routeSectionRating('highway=primary', 1000, false), { lts: null, requiresWalking: false });
  assert.deepEqual(routeSectionRating('highway=primary brouter_route_placeholder_dummy_07=dummy', 1000, false), { lts: 4, requiresWalking: false });
  assert.deepEqual(routeSectionRating('highway=footway bicycle=dismount', 1000, false), { lts: null, requiresWalking: true });
});
