import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyRideabilityCounts,
  emptyVoteCounts,
  leadingVote,
  medianRideability,
  projectApprovedLts,
} from '@/lib/lts-voting';

test('publishes approved LTS 1, 1.5 and 2 directly', () => {
  assert.equal(projectApprovedLts(4, 1), 1);
  assert.equal(projectApprovedLts(4, 1.5), 1.5);
  assert.equal(projectApprovedLts(4, 2), 2);
});

test('averages higher-stress votes with the source LTS and rounds up', () => {
  assert.equal(projectApprovedLts(2, 3), 3);
  assert.equal(projectApprovedLts(2, 4), 3);
  assert.equal(projectApprovedLts(3, 4), 4);
});

test('a tied LTS vote resolves conservatively to the higher stress', () => {
  const counts = emptyVoteCounts();
  counts['1.5'] = 2;
  counts['3'] = 2;
  assert.equal(leadingVote(counts), 3);
});

test('an even rideability split uses the conservative upper median', () => {
  const counts = emptyRideabilityCounts();
  counts['2'] = 1;
  counts['3'] = 1;
  assert.equal(medianRideability(counts), 3);
});
