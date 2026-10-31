import assert from 'node:assert/strict';
import test from 'node:test';
import { ltsFromCost, precomputedLtsFromWayTags, routeSectionRating } from '@/lib/lts-route-ratings';

test('recognises community LTS 1.5 in both travel directions', () => {
  assert.equal(precomputedLtsFromWayTags('brouter_route_placeholder_dummy_18=dummy'), 1.5);
  assert.equal(precomputedLtsFromWayTags('reversedirection=yes brouter_route_placeholder_dummy_19=dummy'), 1.5);
});

test('places the community routing cost between LTS 1 and LTS 2', () => {
  assert.equal(ltsFromCost(1000), 1);
  assert.equal(ltsFromCost(1400), 1.5);
  assert.equal(ltsFromCost(1800), 2);
});

test('recognises an excluded LTS 4.5 before any ordinary directional rating', () => {
  assert.equal(precomputedLtsFromWayTags('brouter_route_placeholder_dummy_22=dummy brouter_route_placeholder_dummy_07=dummy'), 4.5);
  assert.equal(precomputedLtsFromWayTags('reversedirection=yes brouter_route_placeholder_dummy_23=dummy'), 4.5);
  assert.equal(precomputedLtsFromWayTags('brouter_route_placeholder_dummy_23=dummy brouter_route_placeholder_dummy_07=dummy'), 4);
});

test('pedestrian connections stay separate from cycling LTS even with an inherited score', () => {
  for (const tags of ['highway=footway', 'highway=pedestrian', 'highway=steps bicycle=yes',
    'highway=path bicycle=dismount', 'highway=cycleway bicycle=no', 'highway=path bicycle=use_sidepath']) {
    assert.deepEqual(routeSectionRating(tags + ' brouter_route_placeholder_dummy_04=dummy', 1000), { lts: null, requiresWalking: true });
  }
});
test('explicitly permitted cycling on a shared footway keeps its LTS colour', () => {
  for (const bicycle of ['yes', 'designated', 'permissive']) {
    assert.deepEqual(routeSectionRating(`highway=footway footway=crossing bicycle=${bicycle} brouter_route_placeholder_dummy_04=dummy`, 1000), { lts: 1, requiresWalking: false });
  }
  assert.deepEqual(routeSectionRating('highway=cycleway', 1000), { lts: 1, requiresWalking: false });
});
test('tag parsing respects comma delimiters and ignores name fragments', () => {
  assert.deepEqual(routeSectionRating('highway=footway,bicycle=designated', 1800), { lts: 2, requiresWalking: false });
  assert.deepEqual(routeSectionRating('highway=residential name=Footway name:highway=footway', 1800), { lts: 2, requiresWalking: false });
});
test('a walking tag never hides an LTS 4.5 exclusion in either travel direction', () => {
  assert.deepEqual(routeSectionRating('highway=footway bicycle=dismount brouter_route_placeholder_dummy_22=dummy', 12000), { lts: 4.5, requiresWalking: false });
  assert.deepEqual(routeSectionRating('highway=footway reversedirection=yes brouter_route_placeholder_dummy_23=dummy', 12000), { lts: 4.5, requiresWalking: false });
});
