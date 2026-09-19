import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SELECTED_SEGMENTS, segmentKey, submitSelectedSegments, toggleSegment } from '../lib/lts-multi-select';
import type { VoteSegment } from '../lib/lts-voting';

const segment = (id: string): VoteSegment => ({ dataset: 'victoria', segmentId: id, name: 'Test road', currentLts: 2, featureKind: 'segment', geometry: { type: 'LineString', coordinates: [[145, -38], [145.01, -38]] } });

test('Shift selection adds, toggles off, and keeps distinct segment IDs on the same road', () => {
  const a = { segment: segment('a') };
  const b = { segment: segment('b') };
  assert.deepEqual(toggleSegment(toggleSegment([], a), b), [a, b]);
  assert.deepEqual(toggleSegment([a, b], { segment: segment('a') }), [b]);
});

test('Selection cap still allows removing a segment', () => {
  const items = Array.from({ length: MAX_SELECTED_SEGMENTS }, (_, i) => ({ segment: segment(String(i)) }));
  assert.equal(toggleSegment(items, { segment: segment('extra') }).length, MAX_SELECTED_SEGMENTS);
  assert.equal(toggleSegment(items, items[0]).length, MAX_SELECTED_SEGMENTS - 1);
});

test('A partial failure stops the batch; retry skips successful segments', async () => {
  const targets = [segment('a'), segment('b'), segment('c')];
  const completed = new Set<string>();
  const calls: string[] = [];
  await assert.rejects(submitSelectedSegments(targets, completed, async (item) => {
    calls.push(item.segmentId);
    if (item.segmentId === 'b') throw new Error('Rate limited');
  }));
  assert.deepEqual([...completed], [segmentKey(targets[0])]);
  await submitSelectedSegments(targets, completed, async (item) => { calls.push(item.segmentId); });
  assert.deepEqual(calls, ['a', 'b', 'b', 'c']);
  assert.equal(completed.size, 3);
});
