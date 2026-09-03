import assert from 'node:assert/strict';
import test from 'node:test';
import { ltsFromCost, precomputedLtsFromWayTags } from '@/app/api/lts-route/route';

test('recognises community LTS 1.5 in both travel directions', () => {
  assert.equal(precomputedLtsFromWayTags('brouter_route_placeholder_dummy_18=dummy'), 1.5);
  assert.equal(precomputedLtsFromWayTags('reversedirection=yes brouter_route_placeholder_dummy_19=dummy'), 1.5);
});

test('places the community routing cost between LTS 1 and LTS 2', () => {
  assert.equal(ltsFromCost(1000), 1);
  assert.equal(ltsFromCost(1400), 1.5);
  assert.equal(ltsFromCost(1800), 2);
});
