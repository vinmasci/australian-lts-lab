import assert from 'node:assert/strict';
import test from 'node:test';
import { avoidanceParameters, routeUsesExclusion, routeWithExclusions, routingExclusions, type RoutingExclusion } from '../lib/lts-routing-exclusions';
import { leadingVote, projectApprovedLts } from '../lib/lts-voting';

const exclusion: RoutingExclusion = { segmentId: 'segment:w123', geometry: {
  type: 'LineString', coordinates: [[145, -37], [145.00002, -37]],
} };
const unsafe = { geometry: { type: 'LineString' as const, coordinates: [[144.9999, -37], [145.0001, -37]] } };
const safe = { geometry: { type: 'LineString' as const, coordinates: [[144.9999, -37.0001], [145.0001, -37.0001]] } };

test('4.5 is an exclusion, never averaged or rounded back to LTS 4', () => {
  for (const base of [1, 1.5, 2, 3, 4]) assert.equal(projectApprovedLts(base, 4.5), 4.5);
  assert.equal(projectApprovedLts(4.5, 1), 4.5);
  assert.equal(projectApprovedLts(4, 1.5), 3);
  assert.equal(leadingVote({ '4': 2, '4.5': 2 }), 4.5);
});

test('even a two-metre hostile connector matches in both directions', () => {
  assert.equal(routeUsesExclusion(unsafe.geometry, exclusion), true);
  assert.equal(routeUsesExclusion({ ...unsafe.geometry, coordinates: [...unsafe.geometry.coordinates].reverse() }, exclusion), true);
  assert.equal(routeUsesExclusion(safe.geometry, exclusion), false);
});

test('a nearby parallel road and a transverse bridge are not the flagged link', () => {
  assert.equal(routeUsesExclusion({ type: 'LineString', coordinates: [[144.9999, -37.00004], [145.0001, -37.00004]] }, exclusion), false);
  assert.equal(routeUsesExclusion({ type: 'LineString', coordinates: [[145.00001, -37.0001], [145.00001, -36.9999]] }, exclusion), false);
});

test('routing retries around a short 4.5 link, but leaves an ordinary LTS 4 connection usable', async () => {
  const requests: unknown[] = [];
  const result = await routeWithExclusions(async avoidance => {
    requests.push(avoidance);
    return avoidance ? safe : unsafe;
  }, [exclusion]);
  assert.equal(result, safe);
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1]), /polylines/);
  let calls = 0;
  assert.equal(await routeWithExclusions(async () => { calls++; return unsafe; }, []), unsafe);
  assert.equal(calls, 1);
});

test('an engine ignoring avoidance or a blocked endpoint cannot return an unsafe fallback', async () => {
  await assert.rejects(routeWithExclusions(async () => unsafe, [exclusion]), /No route avoiding LTS 4.5/);
  let calls = 0;
  await assert.rejects(routeWithExclusions(async avoidance => {
    calls++;
    if (avoidance) throw new Error('No route found');
    return unsafe;
  }, [exclusion]), /No route found/);
  assert.equal(calls, 2);
});

test('the alternative is checked against every restriction, not just the first conflict', async () => {
  const other: RoutingExclusion = { ...exclusion, segmentId: 'segment:w456', geometry: safe.geometry };
  await assert.rejects(routeWithExclusions(async avoidance => avoidance ? safe : unsafe, [exclusion, other]), /No route avoiding/);
});

test('island snapping cannot move a requested destination across an excluded gap', async () => {
  const stoppedShort = { geometry: { type: 'LineString' as const,
    coordinates: [[144.999, -37], [145, -37]] } };
  await assert.rejects(routeWithExclusions(async () => stoppedShort, [exclusion],
    [[144.999, -37], [145.001, -37]]), /reaches the requested location/);
  assert.equal(await routeWithExclusions(async () => stoppedShort, [exclusion],
    [[144.999, -37], [144.9999, -37]]), stoppedShort);
});

test('only current published 4.5 ratings enter routing; malformed restrictions fail closed', () => {
  const record = { dataset: 'victoria', segmentId: 'segment:w123', baseLts: 4, targetLts: 4.5,
    approvedLts: 4.5, status: 'current', segment: { geometry: exclusion.geometry } };
  assert.deepEqual(routingExclusions('victoria', [record]), [exclusion]);
  for (const change of [{ status: 'needs_review' }, { status: 'orphaned' }, { dataset: 'nsw' }, { targetLts: 4, approvedLts: 4 }]) {
    assert.deepEqual(routingExclusions('victoria', [{ ...record, ...change }]), []);
  }
  assert.throws(() => routingExclusions('victoria', [{ ...record, segment: {} }]), /valid, reconciled/);
});

test('a published 4.5 crossing is excluded without declaring the road legally bicycle=no', () => {
  const point: RoutingExclusion = { segmentId: 'crossing:n123', geometry: { type: 'Point', coordinates: [145.00001, -37] } };
  assert.equal(routeUsesExclusion(unsafe.geometry, point), true);
  assert.equal(routeUsesExclusion(safe.geometry, point), false);
  const params = avoidanceParameters([point]);
  assert.match(params.nogos, /^145\.00001,-37,2$/);
  assert.equal(params.polylines, '');
});
