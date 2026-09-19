import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRoadActivity, type Activity } from '../lib/lts-activity-groups';

const segment = (id: string, extra: Partial<Activity> = {}): Activity => ({
  id, dataset: 'victoria', name: 'Thomas Street', updatedAt: '2026-09-19T10:00:00Z',
  status: 'published', baseLts: 2, lts: 3, publishedAt: null,
  contributions: [], center: [145, -38], ...extra,
});

test('groups twenty nearby same-road segments and deduplicates loaded records', () => {
  const items = Array.from({ length: 20 }, (_, i) => segment(String(i), { center: [145 + i * 0.0001, -38] }));
  const groups = groupRoadActivity([...items, items[0]]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 20);
});

test('keeps distant namesakes, different states and unnamed roads separate', () => {
  assert.equal(groupRoadActivity([
    segment('a'), segment('b', { center: [146, -38] }), segment('c', { dataset: 'nsw' }),
    segment('d', { name: 'Unnamed road/path' }), segment('e', { name: 'Unnamed road/path' }),
  ]).length, 5);
});

test('keeps mixed score results and orders groups by newest contribution', () => {
  const groups = groupRoadActivity([segment('a'), segment('b', { lts: 4 }),
    segment('c', { name: 'New Road', updatedAt: '2026-09-20T10:00:00Z' })]);
  assert.equal(groups[0][0].name, 'New Road');
  assert.deepEqual(groups[1].map(item => item.lts), [3, 4]);
});
