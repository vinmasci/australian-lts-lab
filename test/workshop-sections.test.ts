import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workshopMapViewUrl, workshopViewUrl, workshopPageUrl, canSelectWorkshop, normalizeWorkshopCode, workshopAssignmentCsv, workshopEdges, workshopLabels, workshopSourceUrl, workshopIslandsForLga, workshopPassagesForArea, type WorkshopSections, type WorkshopCrossings } from '../lib/workshop-sections';

test('public map selector reaches the workshop without requiring a website proxy release',()=>{
  assert.equal(workshopMapViewUrl('https://ausbug.app/ltsmap',true),'https://australian-lts-lab.vercel.app/ltsmap/workshop');
  assert.equal(workshopMapViewUrl('https://australian-lts-lab.vercel.app/ltsmap/workshop',false),'https://ausbug.app/ltsmap');
  assert.equal(workshopMapViewUrl('http://127.0.0.1:8794/ltsmap',true),'http://127.0.0.1:8794/ltsmap/workshop');
});

const sections: WorkshopSections = {type:'FeatureCollection',features:[{
  type:'Feature',properties:{id:'SEC-test',section_code:'M3126',section_number:3126,area_m2:10000,area_km2:.01,councils:['City of Example'],regions:['Metro Melbourne'],centre:[145,-38]},
  geometry:{type:'Polygon',coordinates:[[[144,-39],[146,-39],[146,-37],[144,-37],[144,-39]],[[144.1,-38.9],[144.2,-38.9],[144.2,-38.8],[144.1,-38.9]]]},
}]};

test('section boundaries omit internal roundabout/hole rings without changing polygons',()=>{
  assert.equal(workshopEdges(sections).features[0].geometry.coordinates.length,1);
  assert.equal(sections.features[0].geometry.coordinates.length,2);
  assert.equal(workshopLabels(sections).features[0].properties.section_code,'M3126');
});
test('section selection preserves the existing road editor and routing interactions',()=>{
  assert.equal(canSelectWorkshop(false,false,false),true);
  assert.equal(canSelectWorkshop(true,false,false),false);
  assert.equal(canSelectWorkshop(false,true,false),false);
  assert.equal(canSelectWorkshop(false,false,true),false);
});
test('codes and assignment links retain the same reference on the main LTS map',()=>{
  assert.equal(normalizeWorkshopCode('m-03126'),'M3126');
  assert.equal(normalizeWorkshopCode('3126'),'M3126');
  assert.equal(normalizeWorkshopCode('B7'),'B0007');
  const csv=workshopAssignmentCsv(sections,'https://ausbug.app/ltsmap?obsolete=1','City of Example');
  assert.match(csv,/"Champion","BUG group"/);
  assert.match(csv,/"M3126"/);
  assert.match(csv,/https:\/\/ausbug.app\/ltsmap\/workshop\?lga=City\+of\+Example&section=M3126/);
  assert.doesNotMatch(csv,/obsolete/);
});
test('LGA filtering keeps whole cross-border islands and their permanent codes',()=>{
  const shared=structuredClone(sections);
  shared.features[0].properties.councils=['City of Example','City of Neighbour'];
  const first=workshopIslandsForLga(shared,'City of Example');
  const second=workshopIslandsForLga(shared,'City of Neighbour');
  assert.deepEqual(first,second);
  assert.equal(first.features[0].properties.section_code,'M3126');
  assert.deepEqual(first.features[0].geometry,sections.features[0].geometry);
  assert.equal(workshopIslandsForLga(shared,'Unmapped LGA').features.length,0);
});
test('crossing scope includes the selected island and omits unrelated points',()=>{
  const points:WorkshopCrossings={type:'FeatureCollection',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:[145,-38]},properties:{id:'near',kind:'rail',name:'Rail passage',osm_id:'n123',bicycle:'yes',councils:['City of Neighbour'],section_ids:['SEC-test']}},
    {type:'Feature',geometry:{type:'Point',coordinates:[145,-38]},properties:{id:'elsewhere',kind:'zebra',name:'Zebra',osm_id:'n124',bicycle:'not tagged',councils:['Other LGA'],section_ids:['SEC-other']}},
  ]};
  const visible=workshopPassagesForArea(points,'City of Example',new Set(['SEC-test']));
  assert.deepEqual(visible.features.map(f=>f.properties.id),['near']);
});
test('OSM source links accept feature references only',()=>{
  assert.equal(workshopSourceUrl('n123'),'https://www.openstreetmap.org/node/123');
  assert.equal(workshopSourceUrl('javascript:alert(1)'),null);
});
test('the optional payload contains all numbered workshop areas and individual crossing points',()=>{
  const areas=JSON.parse(readFileSync('public/data/workshop/sections.geojson','utf8')) as WorkshopSections;
  const metadata=JSON.parse(readFileSync('public/data/workshop/metadata.json','utf8'));
  const crossings=JSON.parse(readFileSync('public/data/workshop/crossings.geojson','utf8'));
  const lgas=JSON.parse(readFileSync('public/data/workshop/lgas.geojson','utf8'));
  assert.equal(areas.features.length,metadata.section_count);
  assert.equal(new Set(areas.features.map(f=>f.properties.section_code)).size,areas.features.length);
  assert.ok(areas.features.every(f=>f.properties.area_m2>=10000));
  assert.equal(areas.features.filter(f=>f.properties.regions.includes('Metro Melbourne')).length,metadata.metro_sections);
  assert.equal(crossings.features.length,metadata.crossing_points);
  assert.equal(metadata.crossings_clustered,false);
  assert.ok(!areas.features.some(f=>['M2493'].includes(f.properties.section_code)));
  assert.ok(areas.features.some(f=>f.properties.section_code==='M2517'));
  assert.ok(areas.features.some(f=>f.properties.section_code==='M3136'));
  assert.ok(lgas.features.length>31);
  for(const lga of lgas.features)assert.equal(workshopIslandsForLga(areas,lga.properties.id).features.length,lga.properties.island_count);
  assert.ok(areas.features.every(f=>lgas.features.some((l:{properties:{id:string}})=>f.properties.councils.includes(l.properties.id))));
  assert.deepEqual(new Set(crossings.features.map((f:{properties:{kind:string}})=>f.properties.kind)),new Set(['pedestrian','rail','wombat','zebra','refuge']));
});

test('crossing markers have no duplicate source nodes or coincident positions',()=>{
  const crossings=JSON.parse(readFileSync('public/data/workshop/crossings.geojson','utf8')) as WorkshopCrossings;
  const positions=crossings.features.map(f=>f.geometry.coordinates.map(v=>v.toFixed(7)).join(','));
  const ids=crossings.features.map(f=>f.properties.source_osm_id);
  assert.equal(new Set(positions).size,positions.length);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(crossings.features.some(f=>f.properties.kind!=='refuge'&&f.properties.has_refuge));
  assert.ok(crossings.features.some(f=>f.properties.kind==='refuge'&&f.properties.councils.length&&f.properties.section_ids.length));
});


test('live and classic workshop links preserve council and permanent island selection',()=>{
  const trial='https://australian-lts-lab.vercel.app/ltsmap/workshop/google?lga=City+of+Glen+Eira&section=M3018&obsolete=1';
  const live='https://australian-lts-lab.vercel.app/ltsmap/workshop?lga=City+of+Glen+Eira&section=M3018';
  const classic=live.replace('/workshop?','/workshop/classic?');
  assert.equal(workshopViewUrl(trial,'workshop'),live);
  assert.equal(workshopViewUrl(live,'classic'),classic);
  assert.equal(workshopViewUrl(classic,'workshop'),live);
  assert.equal(workshopViewUrl(live,'standard'),'https://ausbug.app/ltsmap');
  assert.equal(workshopPageUrl(trial,'City of Glen Eira','M3018'),live);
  assert.equal(workshopPageUrl(classic,'City of Glen Eira','M3049'),classic.replace('M3018','M3049'));
  assert.match(workshopAssignmentCsv(sections,live,'City of Example'),/\/ltsmap\/workshop\?lga=City\+of\+Example&section=M3126/);
});
