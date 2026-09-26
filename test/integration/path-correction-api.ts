// Run with: node --import ./test/integration/server-only-hook.mjs --import tsx --test test/integration/path-correction-api.ts
// In-memory local records and mocked OSM only: no production writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as submit, GET as own } from '@/app/api/path-corrections/route';
import { GET as queue, POST as review } from '@/app/api/path-corrections/review/route';
import { POST as ltsVote, GET as publishedVotes } from '@/app/api/lts-votes/route';
import { publishedPathCorrections } from '@/lib/path-correction-store';
import { currentPublishedPaths } from '@/lib/path-correction-osm';
const segment = { dataset: 'victoria', segmentId: 'segment:w123', name: 'Test path', featureKind: 'segment', osmId: 'w123', currentLts: 1, highway: 'path', trailRouting: 'caution', isMtb: false, datasetVersion: 'local:1', geometry: { type: 'LineString', coordinates: [[145,-37],[145.001,-37]] } };
function request(url: string, body?: unknown, reviewer = false, auth = true) {
  return new NextRequest(`http://localhost${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { [reviewer ? 'x-local-review' : 'x-local-contributor']: 'true' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('signed-in pink path edits publish immediately; access restrictions, identities and ratings remain protected', async () => {
  const originalFetch = globalThis.fetch;
  let version = 7; let restricted = false;
  globalThis.fetch = async () => Response.json({ elements: [
    { type: 'way', id: 123, version, tags: { highway: 'path', ...(restricted ? { bicycle: 'no' } : {}) }, nodes: [1,2] },
    { type: 'node', id: 1, lon: 145, lat: -37 }, { type: 'node', id: 2, lon: 145.001, lat: -37 },
  ] });
  try {
    const correction = { segment, pathType: 'cycling', note: 'Shared path signs.' };
    assert.equal((await submit(request('/api/path-corrections', correction, false, false))).status, 401);
    assert.equal((await queue(request('/api/path-corrections/review'))).status, 401);
    assert.equal((await submit(request('/api/path-corrections', { ...correction, segment: { ...segment, trailRouting: 'normal' } }))).status, 400);
    restricted = true;
    assert.equal((await submit(request('/api/path-corrections', correction))).status, 409);
    assert.equal((await publishedPathCorrections('victoria')).length, 0);
    restricted = false;
    const saved = await submit(request('/api/path-corrections', correction));
    assert.equal(saved.status, 200); assert.equal((await saved.json()).report.status, 'approved');
    assert.equal((await publishedPathCorrections('victoria')).length, 1, 'no review or second action required');
    assert.equal((await (await queue(request('/api/path-corrections/review', undefined, true))).json()).items.length, 0, 'no pending submission');
    const mine = await (await own(request('/api/path-corrections?dataset=victoria&segmentId=segment:w123'))).json();
    assert.deepEqual(Object.keys(mine.report).sort(), ['note','pathType','status']);
    assert.equal((await ltsVote(request('/api/lts-votes', { segment, targetLts: 2, ltsReason: 'Checked traffic conditions.' }))).status, 200);
    assert.equal((await publishedPathCorrections('victoria'))[0].pathType, 'cycling');
    const exported = await (await publishedVotes(request('/api/lts-votes?dataset=victoria&approved=1'))).json();
    assert.equal(exported.features.length, 1); assert.equal(exported.features[0].properties.path_type, 'cycling'); assert.equal(exported.features[0].properties.lts, 2);
    version++;
    assert.equal((await currentPublishedPaths('victoria')).length, 0, 'changed OSM version withholds override');
    version--;
    const item = (await (await queue(request('/api/path-corrections/review?status=approved', undefined, true))).json()).items[0];
    const decision = { id: item.id, updatedAt: item.updatedAt, action: 'reject', pathType: 'cycling', reviewNote: 'Retain existing classification.' };
    assert.equal((await review(request('/api/path-corrections/review', decision))).status, 401);
    assert.equal((await review(request('/api/path-corrections/review', { ...decision, updatedAt: 'stale' }, true))).status, 409);
    assert.equal((await review(request('/api/path-corrections/review', decision, true))).status, 200);
    assert.equal((await publishedPathCorrections('victoria'))[0].pathType, 'cycling');
    assert.equal((await submit(request('/api/path-corrections', { ...correction, pathType: 'walking', note: 'Dismount signs.' }))).status, 200);
    assert.equal((await publishedPathCorrections('victoria'))[0].pathType, 'walking');
    assert.equal((await submit(request('/api/path-corrections', { ...correction, pathType: 'unsure', note: 'Evidence unclear.' }))).status, 200);
    assert.equal((await publishedPathCorrections('victoria')).length, 0, 'unsure restores unverified classification immediately');
  } finally { globalThis.fetch = originalFetch; }
});
