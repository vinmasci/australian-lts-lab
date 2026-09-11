import assert from 'node:assert/strict';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { applyTileApprovals, tileApprovals } from '../lib/lts-community-tiles';
import { applyHardSpeedRuleFloor } from '../lib/lts-voting';

// Read-only. Without --live, validate the merge against actual production tiles.
// With --live, require the deployed endpoint itself to contain the published scores.
async function main() {
const live = process.argv.includes('--live');
const endpoint = process.env.LTS_TILE_TEST_ENDPOINT || 'https://australian-lts-lab.vercel.app/api/lts-tiles';
const feed = await fetch('https://ausbug.app/ltsmap/api/lts-votes?dataset=victoria&approved=1');
assert.equal(feed.status, 200);
const collection = await feed.json();
const ratings = tileApprovals('victoria', collection.features.map((feature: GeoJSON.Feature) => ({
  dataset: 'victoria', segmentId: feature.properties?.segment_id,
  approvedLts: feature.properties?.lts, status: feature.properties?.reconciliation_status,
})));
const tiles = new Map<string, Uint8Array>();
let verified = 0;
for (const feature of collection.features as GeoJSON.Feature[]) {
  const id = String(feature.properties?.segment_id).replace(/^segment:/, '');
  if (!ratings.has(id) || feature.geometry.type !== 'LineString') continue;
  const [lng, lat] = feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)];
  const z = 14;
  const x = Math.floor((lng + 180) / 360 * 2 ** z);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
  const key = `${z}/${x}/${y}`;
  let data = tiles.get(key);
  if (!data) {
    const response = await fetch(`${endpoint}/victoria/${key}.pbf`);
    assert.equal(response.status, 200, key);
    assert.ok(response.headers.get('content-type')?.includes('mapbox-vector-tile'), 'Expected a tile, not a sign-in page');
    data = new Uint8Array(await response.arrayBuffer());
    tiles.set(key, data);
  }
  const before = new VectorTile(new Pbf(data)).layers.lts;
  const after = new VectorTile(new Pbf(live ? data : applyTileApprovals(data, ratings))).layers.lts;
  assert.equal(after.length, before.length);
  let found = false;
  for (let i = 0; i < after.length; i++) {
    const result = after.feature(i);
    assert.deepEqual(result.loadGeometry(), before.feature(i).loadGeometry(), `Geometry changed: ${key}/${i}`);
    if (result.properties.feature_kind === 'segment' && result.properties.osm_id === id) {
      const p = result.properties;
      const speed = Math.max(Number(p.maxspeed) || 0, Number(p.official_speed_forward) || 0, Number(p.official_speed_backward) || 0);
      const expected = applyHardSpeedRuleFloor(Number(p.base_lts ?? p.lts), ratings.get(id)!, speed);
      if (expected !== ratings.get(id)) console.log(`${id} (${p.name}): safety floor ${expected} retained at ${speed} km/h; approval requested ${ratings.get(id)}`);
      assert.equal(p.lts, expected, `${id}: published rating / safety floor missing`);
      found = true;
    }
  }
  assert.ok(found, `Published road missing from tile: ${id}`);
  console.log(`${id}: published LTS ${ratings.get(id)} checked with safety floors`);
  verified++;
}
assert.ok(verified > 0);
console.log(`${live ? 'LIVE endpoint' : 'Local merge'}: ${verified} published roads verified across ${tiles.size} real tiles; geometry unchanged.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
