import assert from 'node:assert/strict';
import test from 'node:test';
import { googleStreetViewUrl, streetViewCanvasPoint } from '../lib/google-maps';

test('opens Street View at the exact selected map point without an API key', () => {
  const url = new URL(googleStreetViewUrl([144.977113, -37.77056]));

  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/@');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('map_action'), 'pano');
  assert.equal(url.searchParams.get('viewpoint'), '-37.770560,144.977113');
});

test('Street View drops account for the header and an open road sidebar',()=>{
  assert.deepEqual(streetViewCanvasPoint({left:440,top:64,width:840,height:656},[640,300]),[200,236]);
  assert.equal(streetViewCanvasPoint({left:440,top:64,width:840,height:656},[200,300]),null);
  assert.equal(streetViewCanvasPoint({left:0,top:64,width:1280,height:656},[640,32]),null);
  assert.equal(streetViewCanvasPoint({left:0,top:64,width:1280,height:656},[1280,300]),null);
  assert.equal(streetViewCanvasPoint({left:0,top:64,width:0,height:656},[0,100]),null);
  assert.equal(streetViewCanvasPoint({left:0,top:64,width:1280,height:656},[NaN,100]),null);
});
