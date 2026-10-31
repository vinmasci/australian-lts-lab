import assert from 'node:assert/strict';
import test from 'node:test';
import { initialRouteHistory, MAX_ROUTE_POINTS, routeHistoryReducer as reduce } from '../lib/route-history';

test('rapid waypoint additions retain every stop in order', () => {
  let state = initialRouteHistory;
  for (let index = 0; index < 5; index++) state = reduce(state, { type: 'add', point: [index, -index] });
  assert.deepEqual(state.snapshots[state.index], [[0, -0], [1, -1], [2, -2], [3, -3], [4, -4]]);
});
test('editing after undo discards abandoned stops and cannot redo them', () => {
  let state = reduce(initialRouteHistory, { type: 'add', point: [1, 1] });
  state = reduce(state, { type: 'add', point: [2, 2] });
  state = reduce(state, { type: 'undo' });
  state = reduce(state, { type: 'add', point: [3, 3] });
  state = reduce(state, { type: 'redo' });
  assert.deepEqual(state.snapshots[state.index], [[1, 1], [3, 3]]);
});
test('reverse, removal and clear remain undoable without mutating prior routes', () => {
  let state = reduce(initialRouteHistory, { type: 'add', point: [1, 1] });
  state = reduce(state, { type: 'add', point: [2, 2] });
  const original = state.snapshots[state.index];
  state = reduce(state, { type: 'reverse' });
  assert.deepEqual(original, [[1, 1], [2, 2]]);
  assert.deepEqual(state.snapshots[state.index], [[2, 2], [1, 1]]);
  state = reduce(state, { type: 'remove', index: 0 });
  state = reduce(state, { type: 'clear' });
  state = reduce(state, { type: 'undo' });
  assert.deepEqual(state.snapshots[state.index], [[1, 1]]);
});
test('waypoint limit matches API limit and reset removes undo history between maps', () => {
  let state = initialRouteHistory;
  for (let index = 0; index <= MAX_ROUTE_POINTS; index++) state = reduce(state, { type: 'add', point: [index, index] });
  assert.equal(state.snapshots[state.index].length, MAX_ROUTE_POINTS);
  state = reduce(reduce(state, { type: 'reset' }), { type: 'undo' });
  assert.deepEqual(state, initialRouteHistory);
});
