import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findLga, lgaBounds, lgaBoundary, lgaFocusUrl, lgaMask, pointInLga, type LgaCollection, type LgaFeature } from '../lib/lga-focus';
import { hiddenWorkshopUrl } from '../lib/workshop-availability';

const feature:LgaFeature={type:'Feature',properties:{id:'322',name:'Glen Eira',official_name:'Glen Eira City',abs_code:'22310'},geometry:{type:'MultiPolygon',coordinates:[
  [[[140,-39],[144,-39],[144,-35],[140,-35],[140,-39]],[[141,-38],[141,-37],[142,-37],[142,-38],[141,-38]]],
  [[[145,-39],[146,-39],[146,-38],[145,-38],[145,-39]]],
]}};
const collection:LgaCollection={type:'FeatureCollection',features:[feature]};

test('council focus includes separate parts and boundaries but excludes interior holes',()=>{
  assert.equal(pointInLga([140.5,-38],feature),true);
  assert.equal(pointInLga([145.5,-38.5],feature),true);
  assert.equal(pointInLga([141.5,-37.5],feature),false);
  assert.equal(pointInLga([144.5,-38],feature),false);
  assert.equal(pointInLga([140,-36],feature),true);
  assert.deepEqual(lgaBounds(feature),[140,-39,146,-35]);
});
test('inverse focus mask covers holes and preserves separate council parts without mutation',()=>{
  const original=JSON.stringify(feature),mask=lgaMask(feature);
  assert.equal(mask.features.length,2);
  assert.equal(mask.features[0].geometry.coordinates.length,3);
  assert.equal(lgaBoundary(feature).features[0].geometry.coordinates.length,3);
  assert.equal(JSON.stringify(feature),original);
});
test('legacy workshop names resolve to normal map councils and clear links remove focus only',()=>{
  assert.equal(findLga(collection,'City of Glen Eira')?.properties.id,'322');
  assert.equal(findLga(collection,'322')?.properties.name,'Glen Eira');
  assert.equal(findLga(collection,'Missing'),null);
  const link=lgaFocusUrl('https://ausbug.app/ltsmap?section=M3023&workshop=1&other=keep','Glen Eira');
  assert.equal(link,'https://ausbug.app/ltsmap?other=keep&lga=Glen+Eira');
  assert.equal(lgaFocusUrl(link,''),'https://ausbug.app/ltsmap?other=keep');
  assert.equal(hiddenWorkshopUrl({lga:'City of Glen Eira',section:'M3023'}),'/ltsmap?lga=City+of+Glen+Eira');
  assert.equal(hiddenWorkshopUrl({}),'/ltsmap');
});
test('normal-map council data contains all 79 councils including outside the workshop pilot',()=>{
  const data=JSON.parse(readFileSync(new URL('../public/data/lga/victoria.geojson',import.meta.url),'utf8')) as LgaCollection;
  assert.equal(data.features.length,79);
  assert.equal(new Set(data.features.map(f=>f.properties.id)).size,79);
  const glen=findLga(data,'City of Glen Eira');assert.ok(glen);
  assert.equal(pointInLga([145.033,-37.889],glen),true);
  assert.equal(pointInLga([144.96,-37.81],glen),false);
  assert.ok(findLga(data,'Wodonga'));assert.ok(findLga(data,'Mildura'));
});
