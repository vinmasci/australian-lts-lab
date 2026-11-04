import test from 'node:test';
import assert from 'node:assert/strict';
import { googleWorkshopTiles,googleWorkshopVoteSegment } from '../lib/google-workshop';
import type { Feature,LineString } from 'geojson';

test('Google trial requests only bounded visible LTS tiles',()=>{
  const tiles=googleWorkshopTiles({west:145.02,east:145.05,north:-37.88,south:-37.91},16);
  assert.ok(tiles.length>0&&tiles.length<=49);
  assert.ok(tiles.every(t=>t.z===14&&t.x>=0&&t.x<2**14&&t.y>=0&&t.y<2**14));
  assert.equal(new Set(tiles.map(t=>`${t.z}/${t.x}/${t.y}`)).size,tiles.length);
  assert.deepEqual(googleWorkshopTiles({west:-180,east:180,north:85,south:-85},12),[]);
  assert.deepEqual(googleWorkshopTiles({west:145,east:146,north:-37,south:-38},8),[]);
});
test('Google trial contributions retain standard-map identity and original score',()=>{
  const feature:Feature<LineString>={type:'Feature',id:'14/14788/10055/7',geometry:{type:'LineString',coordinates:[[145.03,-37.89],[145.04,-37.89]]},properties:{feature_kind:'segment',osm_id:'w123',name:'Example Lane',lts:1.5,base_lts:2,maxspeed:30}};
  const vote=googleWorkshopVoteSegment(feature,{source_pbf_modified_at:'2026-10-30',classifier_version:'test'});
  assert.equal(vote?.segmentId,'segment:w123');assert.equal(vote.currentLts,2);assert.deepEqual(vote.geometry,feature.geometry);
  assert.equal(vote.dataset,'victoria');assert.equal(vote.osmSnapshotDate,'2026-10-30');
  assert.equal(googleWorkshopVoteSegment({...feature,properties:{...feature.properties,feature_kind:'dismount'}},null),null);
  assert.equal(googleWorkshopVoteSegment({...feature,properties:{...feature.properties,osm_id:undefined}},null),null);
});
