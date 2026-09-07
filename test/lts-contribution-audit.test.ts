import assert from 'node:assert/strict';
import test from 'node:test';
import { createLtsContributionEvent } from '@/lib/lts-contribution-audit';
import type { StoredLtsVote } from '@/lib/lts-voting';

const vote: StoredLtsVote = {
  dataset: 'victoria',
  segmentId: 'segment:w1',
  voterKey: 'hashed-user',
  contributorName: 'Casey Rider',
  contributorUid: 'firebase-user',
  contributorEmail: 'casey@example.com',
  targetLts: 1.5,
  rideability: 2,
  rideabilityIssues: ['loose_surface'],
  currentLts: 2,
  ltsReason: 'Modal filter prevents through traffic.',
  note: 'Quiet connection to the school.',
  segment: {
    dataset: 'victoria',
    segmentId: 'segment:w1',
    name: 'Example Street',
    featureKind: 'segment',
    currentLts: 2,
    osmId: 'way/123',
    geometry: { type: 'LineString', coordinates: [[144.9, -37.8], [144.91, -37.8]] },
  },
  updatedAt: '2026-09-03T10:00:00.000Z',
};

test('records a first contribution without copying email or geometry', () => {
  const event = createLtsContributionEvent(vote, null, 'firestore-segment');
  assert.equal(event.action, 'created');
  assert.equal(event.contributionKind, 'lts_and_rideability');
  assert.equal(event.occurredAt, vote.updatedAt);
  assert.equal(event.contributorUid, vote.contributorUid);
  assert.deepEqual(event.changedFields, [
    'targetLts',
    'rideability',
    'rideabilityIssues',
    'ltsReason',
    'observation',
  ]);
  assert.equal('contributorEmail' in event, false);
  assert.equal('geometry' in event, false);
  assert.equal('segment' in event, false);
});

test('records only fields changed by an edited contribution', () => {
  const updated = {
    ...vote,
    targetLts: 1 as const,
    note: 'Filter confirmed during school drop-off.',
    updatedAt: '2026-09-04T10:00:00.000Z',
  };
  const event = createLtsContributionEvent(updated, vote, 'firestore-segment');
  assert.equal(event.action, 'updated');
  assert.deepEqual(event.changedFields, ['targetLts', 'observation']);
  assert.equal(event.previous?.targetLts, 1.5);
  assert.equal(event.current.targetLts, 1);
  assert.equal(event.previous?.observation, vote.note);
  assert.equal(event.current.observation, updated.note);
});

test('recognises a repeated identical save and ignores issue ordering', () => {
  const previous: StoredLtsVote = {
    ...vote,
    rideabilityIssues: ['slippery_wet', 'loose_surface'],
  };
  const current: StoredLtsVote = {
    ...vote,
    rideabilityIssues: ['loose_surface', 'slippery_wet'],
  };
  const event = createLtsContributionEvent(current, previous, 'firestore-segment');
  assert.equal(event.action, 'updated');
  assert.deepEqual(event.changedFields, []);
});
