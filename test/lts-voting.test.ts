import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyHardSpeedRuleFloor,
  emptyRideabilityCounts,
  emptyVoteCounts,
  leadingVote,
  medianRideability,
  projectApprovedLts,
  publishedLtsContributions,
  type StoredLtsVote,
} from '@/lib/lts-voting';

test('publishes approved LTS 1, 1.5 and 2 directly', () => {
  assert.equal(projectApprovedLts(4, 1), 3);
  assert.equal(projectApprovedLts(4, 1.5), 3);
  assert.equal(projectApprovedLts(4, 2), 3);
  for (const speed of [30, 70, 80, 100, undefined]) {
    assert.equal(projectApprovedLts(2, 1.5, speed), 1.5);
    assert.equal(projectApprovedLts(4, 1.5, speed), 3);
    assert.equal(applyHardSpeedRuleFloor(4, projectApprovedLts(4, 1.5, speed), speed), 3);
  }
});

test('averages higher-stress votes with the source LTS and rounds up', () => {
  assert.equal(projectApprovedLts(2, 3), 3);
  assert.equal(projectApprovedLts(2, 4), 3);
  assert.equal(projectApprovedLts(3, 4), 4);
});

test('records votes without lowering an explicit 70 km/h safety-rule result', () => {
  assert.equal(projectApprovedLts(4, 1, 70), 3);
  assert.equal(projectApprovedLts(4, 1.5, 70), 3);
  assert.equal(projectApprovedLts(4, 2, 70), 3);
  assert.equal(projectApprovedLts(4, 3, 70), 4);
});

test('preserves the classifier facility result as the floor on a 70 km/h road', () => {
  assert.equal(projectApprovedLts(3, 1.5, 70), 3);
  assert.equal(projectApprovedLts(1, 1.5, 70), 1.5);
});

test('clamps an older published approval when it is served to the map', () => {
  assert.equal(applyHardSpeedRuleFloor(4, 1.5, 70), 3);
  assert.equal(applyHardSpeedRuleFloor(3, 2, 80), 3);
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

const storedVote: StoredLtsVote = {
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
    geometry: { type: 'LineString', coordinates: [[144.9, -37.8], [144.91, -37.8]] },
  },
  updatedAt: '2026-09-03T10:00:00.000Z',
};

test('publishes signed-in contributor names and comments without private identifiers', () => {
  const [published] = publishedLtsContributions([storedVote], true);
  assert.deepEqual(published, {
    contributorName: 'Casey Rider',
    targetLts: 1.5,
    rideability: 2,
    rideabilityIssues: ['loose_surface'],
    ltsReason: 'Modal filter prevents through traffic.',
    observation: 'Quiet connection to the school.',
    updatedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal('contributorEmail' in published, false);
  assert.equal('contributorUid' in published, false);
  assert.equal('voterKey' in published, false);
});

test('does not expose removed or old anonymous comments', () => {
  assert.deepEqual(publishedLtsContributions([storedVote], false), []);
  const [legacy] = publishedLtsContributions([{ ...storedVote, contributorUid: undefined }], true);
  assert.equal(legacy.contributorName, storedVote.contributorName);
  assert.equal(legacy.targetLts, storedVote.targetLts);
  assert.equal(legacy.observation, '');
  assert.equal(legacy.ltsReason, '');
});

test('shows approved votes even without comments, but never email display names', () => {
  const [vote] = publishedLtsContributions([{ ...storedVote, contributorName: 'rider@example.com', ltsReason: '', note: '' }], true);
  assert.equal(vote.contributorName, 'AusBUG rider');
  assert.equal(vote.targetLts, 1.5);
});

test('does not use an email prefix as a public display name', () => {
  const [published] = publishedLtsContributions([{ ...storedVote, contributorName: 'casey' }], true);
  assert.equal(published.contributorName, 'AusBUG rider');
});
