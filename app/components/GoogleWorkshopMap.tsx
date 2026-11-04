'use client';

import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import { ltsAppPath } from '@/lib/client-path';
import { SegmentVote } from '@/app/components/SegmentVote';
import { GOOGLE_LTS_COLOURS, googleWorkshopTiles, googleWorkshopVoteSegment, type GoogleWorkshopMetadata, type WorkshopTile } from '@/lib/google-workshop';
import { normalizeWorkshopCode, WORKSHOP_CROSSING_STYLES, WORKSHOP_SIGN_ZOOM, workshopAssignmentCsv, workshopEdges, workshopIslandsForLga, workshopLabels, workshopPageUrl, workshopViewUrl, type WorkshopMapView, workshopPassagesForArea, workshopSourceUrl, type WorkshopCrossings, type WorkshopCrossing, type WorkshopLgas, type WorkshopSections } from '@/lib/workshop-sections';

type Bundle={sections:WorkshopSections;crossings:WorkshopCrossings;lgas:WorkshopLgas;metadata:GoogleWorkshopMetadata|null};
type Layers={roads:google.maps.Data;edges:google.maps.Data;lga:google.maps.Data;labels:google.maps.Data;crossings:google.maps.Data};
type Road={feature:Feature<Geometry>;point:google.maps.LatLngLiteral};
let bundlePromise:Promise<Bundle>|null=null;
const empty=():FeatureCollection=>({type:'FeatureCollection',features:[]});
const labelImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="24"><rect width="56" height="24" fill="white" fill-opacity="0.01"/></svg>');
function replaceData(layer:google.maps.Data,data:FeatureCollection){layer.forEach(f=>layer.remove(f));layer.addGeoJson(data);}
function pageUrl(lga:string,code=''){
  return workshopPageUrl(window.location.href,lga,code);
}
function fit(map:google.maps.Map,f:Feature<Polygon|MultiPolygon>,island:boolean){
  const bounds=new google.maps.LatLngBounds();
  const visit=(v:unknown)=>{if(Array.isArray(v)){if(typeof v[0]==='number'&&typeof v[1]==='number')bounds.extend({lng:v[0],lat:v[1]});else v.forEach(visit);}};
  visit(f.geometry.coordinates);map.getStreetView().setVisible(false);map.fitBounds(bounds,{top:50,right:65,left:35,bottom:260});
  google.maps.event.addListenerOnce(map,'idle',()=>{if((map.getZoom()||0)>(island?16:13))map.setZoom(island?16:13);});
}
async function loadBundle():Promise<Bundle>{
  if(!bundlePromise)bundlePromise=(async()=>{
    const [sections,crossings,lgas,release]=await Promise.all(['sections','crossings','lgas','release'].map(async name=>{
      const response=await fetch(ltsAppPath(name==='release'?'/api/lts-release':'/data/workshop/'+name+'.geojson'));
      if(!response.ok)throw new Error('Workshop data could not load.');return response.json();
    }));
    const metadata=release?.datasets?.victoria?.metadata||await fetch(ltsAppPath('/data/lts/victoria-lts-metadata.json')).then(r=>r.json());
    return {sections,crossings,lgas,metadata};
  })().catch(error=>{bundlePromise=null;throw error;});
  return bundlePromise;
}
async function loadRoadTile(tile:WorkshopTile,signal:AbortSignal):Promise<Feature<Geometry>[]> {
  const response=await fetch(ltsAppPath(`/api/lts-tiles/victoria/${tile.z}/${tile.x}/${tile.y}`),{signal});
  if(response.status===204)return [];
  if(!response.ok)throw new Error('LTS roads could not load.');
  const layer=new VectorTile(new Pbf(new Uint8Array(await response.arrayBuffer()))).layers.lts;
  if(!layer)return [];
  const features:Feature<Geometry>[]=[];
  for(let i=0;i<layer.length;i++){
    const f=layer.feature(i);if(!['segment','dismount'].includes(String(f.properties.feature_kind)))continue;
    const feature=f.toGeoJSON(tile.x,tile.y,tile.z) as Feature<Geometry>;
    if(!['LineString','MultiLineString'].includes(feature.geometry.type))continue;
    feature.id=`${tile.z}/${tile.x}/${tile.y}/${i}`;features.push(feature);
  }
  return features;
}

function nearbyRoad(data:google.maps.Data,map:google.maps.Map,point:google.maps.LatLng):google.maps.Data.Feature|null{
  const projection=map.getProjection(),target=projection?.fromLatLngToPoint(point);if(!projection||!target||!data.getMap())return null;
  const scale=2**(map.getZoom()||0);let best=100,result:google.maps.Data.Feature|null=null;
  data.forEach(feature=>{
    const geometry=feature.getGeometry();
    const lines=geometry instanceof google.maps.Data.LineString?[geometry.getArray()]:geometry instanceof google.maps.Data.MultiLineString?geometry.getArray().map(l=>l.getArray()):[];
    for(const line of lines)for(let i=1;i<line.length;i++){
      const a=projection.fromLatLngToPoint(line[i-1]),b=projection.fromLatLngToPoint(line[i]);if(!a||!b)continue;
      const ax=(a.x-target.x)*scale,ay=(a.y-target.y)*scale,bx=(b.x-target.x)*scale,by=(b.y-target.y)*scale,dx=bx-ax,dy=by-ay;
      const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),distance=(ax+t*dx)**2+(ay+t*dy)**2;
      if(distance<best){best=distance;result=feature;}
    }
  });return result;
}

export default function GoogleWorkshopMap(){
  const container=useRef<HTMLDivElement>(null),layers=useRef<Layers|null>(null),tiles=useRef(new Map<string,Feature<Geometry>[]>());
  const actions=useRef<{chooseIsland:(code:string,fit:boolean)=>void;selectRoad:(road:Road)=>void;selectCrossing:(id:string)=>void}>({chooseIsland:()=>{},selectRoad:()=>{},selectCrossing:()=>{}});
  const [map,setMap]=useState<google.maps.Map|null>(null),[bundle,setBundle]=useState<Bundle|null>(null),[error,setError]=useState('');
  const [lgaId,setLgaId]=useState(''),[sectionCode,setSectionCode]=useState(''),[road,setRoad]=useState<Road|null>(null),[crossing,setCrossing]=useState<WorkshopCrossing|null>(null);
  const [zoom,setZoom]=useState(12),[viewTick,setViewTick]=useState(0),[roadRefresh,setRoadRefresh]=useState(0),[roadMessage,setRoadMessage]=useState('');
  const [showRoads,setShowRoads]=useState(true),[showCrossings,setShowCrossings]=useState(true),[panoOpen,setPanoOpen]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState('');
  const key=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY||'';
  const scoped=bundle&&lgaId?workshopIslandsForLga(bundle.sections,lgaId):empty() as WorkshopSections;
  const section=scoped.features.find(f=>f.properties.section_code===sectionCode)||null;
  const lga=bundle?.lgas.features.find(f=>f.properties.id===lgaId);
  const backParams=new URLSearchParams();if(lgaId)backParams.set('lga',lgaId);if(sectionCode)backParams.set('section',sectionCode);
  const classicUrl='/ltsmap/workshop/classic'+(backParams.size?'?'+backParams.toString():'');

  const chooseLga=(id:string,zoomTo=true)=>{
    if(saving)return;
    setLgaId(id);setSectionCode('');setRoad(null);setCrossing(null);setSaved('');window.history.replaceState(null,'',pageUrl(id));
    const feature=bundle?.lgas.features.find(f=>f.properties.id===id);if(feature&&map&&zoomTo)fit(map,feature,false);
  };
  const chooseIsland=(code:string,zoomTo=true)=>{
    if(saving)return;
    const normalized=normalizeWorkshopCode(code),f=scoped.features.find(f=>f.properties.section_code===normalized);
    if(code&&!f)return;
    setSectionCode(normalized);setRoad(null);setCrossing(null);setSaved('');window.history.replaceState(null,'',pageUrl(lgaId,normalized));
    if(map&&zoomTo){if(f)fit(map,f,true);else if(lga)fit(map,lga,false);}
  };
  useEffect(()=>{actions.current={chooseIsland,selectRoad:r=>{if(!saving){setRoad(r);setCrossing(null);setSaved('');}},selectCrossing:id=>{if(!saving){setRoad(null);setCrossing(bundle?.crossings.features.find(f=>f.properties.id===id)?.properties||null);}}};});

  useEffect(()=>{
    let cancelled=false;const host=container.current;let ownedMap:google.maps.Map|null=null;const listeners:google.maps.MapsEventListener[]=[];
    if(!key)return;
    const authWindow=window as Window&{gm_authFailure?:()=>void},previous=authWindow.gm_authFailure;
    authWindow.gm_authFailure=()=>{if(!cancelled)setError('Google Maps could not authorise this key. Open the classic workshop using the link below.');};
    (async()=>{
      try{
        setOptions({key,v:'weekly',region:'AU',authReferrerPolicy:'origin'});
        const maps=await importLibrary('maps');if(cancelled||!host)return;
        const instance=new maps.Map(host,{center:{lat:-37.86,lng:145.02},zoom:12,streetViewControl:true,fullscreenControl:false,mapTypeControl:true,clickableIcons:false,
          styles:[{featureType:'poi',stylers:[{visibility:'off'}]}]});
        ownedMap=instance;
        const data:Layers={roads:new maps.Data({map:instance}),edges:new maps.Data({map:instance}),lga:new maps.Data({map:instance}),labels:new maps.Data({map:instance}),crossings:new maps.Data({map:instance})};
        layers.current=data;
        listeners.push(instance.addListener('idle',()=>{setZoom(instance.getZoom()||12);setViewTick(v=>v+1);}));
        listeners.push(instance.getStreetView().addListener('visible_changed',()=>setPanoOpen(instance.getStreetView().getVisible())));
        let dataClickAt=0;
        listeners.push(data.labels.addListener('click',(e:google.maps.Data.MouseEvent)=>{dataClickAt=performance.now();actions.current.chooseIsland(String(e.feature.getProperty('section_code')),true);}));
        listeners.push(data.crossings.addListener('click',(e:google.maps.Data.MouseEvent)=>{dataClickAt=performance.now();actions.current.selectCrossing(String(e.feature.getProperty('id')));}));
        listeners.push(data.roads.addListener('click',(e:google.maps.Data.MouseEvent)=>{dataClickAt=performance.now();const point=e.latLng?.toJSON();if(point)e.feature.toGeoJson(f=>actions.current.selectRoad({feature:f as Feature<Geometry>,point}));}));
        listeners.push(instance.addListener('click',(e:google.maps.MapMouseEvent)=>{
          if(!e.latLng||instance.getStreetView().getVisible()||performance.now()-dataClickAt<100)return;
          const feature=nearbyRoad(data.roads,instance,e.latLng),point=e.latLng.toJSON();
          if(feature)feature.toGeoJson(f=>actions.current.selectRoad({feature:f as Feature<Geometry>,point}));
        }));
        setMap(instance);
        const result=await loadBundle();if(cancelled)return;setBundle(result);
        const params=new URLSearchParams(window.location.search),code=normalizeWorkshopCode(params.get('section')||''),requested=params.get('lga');
        const area=result.sections.features.find(f=>f.properties.section_code===code);
        const council=result.lgas.features.find(f=>f.properties.id===requested)||result.lgas.features.find(f=>area?.properties.councils.includes(f.properties.id));
        if(council){setLgaId(council.properties.id);if(area?.properties.councils.includes(council.properties.id)){setSectionCode(code);fit(instance,area,true);}else fit(instance,council,false);}
      }catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:'Google Maps could not load.');}
    })();
    return()=>{cancelled=true;listeners.forEach(l=>l.remove());if(layers.current)Object.values(layers.current).forEach(l=>l.setMap(null));layers.current=null;if(ownedMap){google.maps.event.clearInstanceListeners(ownedMap);google.maps.event.clearInstanceListeners(ownedMap.getStreetView());host?.replaceChildren();}authWindow.gm_authFailure=previous;};
  },[key]);

  useEffect(()=>{
    const data=layers.current;if(!data||!map||!bundle)return;
    const areas=lgaId?workshopIslandsForLga(bundle.sections,lgaId):empty() as WorkshopSections;
    replaceData(data.edges,workshopEdges(areas));replaceData(data.labels,workshopLabels(areas));
    const council=bundle.lgas.features.find(f=>f.properties.id===lgaId);
    replaceData(data.lga,council?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:council.geometry.type==='Polygon'?[council.geometry.coordinates[0]]:council.geometry.coordinates.map(p=>p[0])}}]}:empty());
    const selected=areas.features.find(f=>f.properties.section_code===sectionCode);
    replaceData(data.crossings,lgaId?workshopPassagesForArea(bundle.crossings,lgaId,new Set(selected?[selected.properties.id]:areas.features.map(f=>f.properties.id))):empty());
  },[map,bundle,lgaId,sectionCode]);

  useEffect(()=>{
    const data=layers.current;if(!data||!map)return;
    Object.entries(data).forEach(([name,layer])=>layer.setMap(panoOpen||(name==='roads'&&!showRoads)||(name==='crossings'&&!showCrossings)?null:map));
    data.lga.setStyle({fillOpacity:0,strokeColor:'#738277',strokeOpacity:.6,strokeWeight:1,clickable:false,zIndex:0});
    data.edges.setStyle(f=>({strokeColor:f.getProperty('id')===section?.properties.id?'#183c2a':'#344a40',strokeOpacity:.8,strokeWeight:f.getProperty('id')===section?.properties.id?3:1.2,clickable:false,zIndex:f.getProperty('id')===section?.properties.id?40:2}));
    data.labels.setStyle(f=>({visible:zoom>=10,icon:{url:labelImage,scaledSize:new google.maps.Size(56,24),anchor:new google.maps.Point(28,12),labelOrigin:new google.maps.Point(28,12)},
      label:{text:String(f.getProperty('section_code')),color:'#183c2a',fontSize:f.getProperty('section_code')===sectionCode?'15px':'12px',fontWeight:'600',className:'google-workshop-label'},title:'Select '+String(f.getProperty('section_code')),zIndex:1000,clickable:true}));
    const visibleSigns=new Set<string>(),occupied:{x:number;y:number;width:number;height:number}[]=[];
    const projection=map.getProjection(),scale=2**zoom,bounds=map.getBounds();
    if(zoom>=WORKSHOP_SIGN_ZOOM&&projection){
      const candidates:google.maps.Data.Feature[]=[];data.crossings.forEach(f=>candidates.push(f));
      const priority:Record<string,number>={pedestrian:0,rail:1,wombat:2,zebra:3,refuge:4};
      candidates.sort((a,b)=>(a.getProperty('id')===crossing?.id?-1:b.getProperty('id')===crossing?.id?1:(priority[String(a.getProperty('kind'))]??5)-(priority[String(b.getProperty('kind'))]??5)));
      for(const f of candidates){
        const geometry=f.getGeometry();if(!(geometry instanceof google.maps.Data.Point)||!bounds?.contains(geometry.get()))continue;
        const point=projection.fromLatLngToPoint(geometry.get());if(!point)continue;
        const size=Math.min(42,26+(zoom-WORKSHOP_SIGN_ZOOM)*4),width=f.getProperty('kind')==='pedestrian'?size*2/3:size;
        const box={x:point.x*scale,y:point.y*scale,width:width+5,height:size+5};
        if(occupied.some(other=>Math.abs(other.x-box.x)<(other.width+box.width)/2&&Math.abs(other.y-box.y)<(other.height+box.height)/2))continue;
        occupied.push(box);visibleSigns.add(String(f.getProperty('id')));
      }
    }
    data.crossings.setStyle(f=>{
      const kind=f.getProperty('kind') as keyof typeof WORKSHOP_CROSSING_STYLES,style=WORKSHOP_CROSSING_STYLES[kind];
      const size=zoom<WORKSHOP_SIGN_ZOOM?0:Math.min(42,26+(zoom-WORKSHOP_SIGN_ZOOM)*4),width=kind==='pedestrian'?size*2/3:size;
      return {visible:zoom>=10&&(zoom<WORKSHOP_SIGN_ZOOM||visibleSigns.has(String(f.getProperty('id')))),clickable:true,title:style.title,zIndex:2000,icon:size?{url:ltsAppPath('/data/workshop/'+style.image),scaledSize:new google.maps.Size(width,size),anchor:new google.maps.Point(width/2,size/2)}:
        {path:google.maps.SymbolPath.CIRCLE,scale:Math.min(3,1.5+(zoom-10)*.4),fillColor:style.color,fillOpacity:1,strokeColor:'#fff',strokeWeight:.75}};
    });
    data.roads.setStyle(f=>{
      const lts=Number(f.getProperty('lts')),walk=f.getProperty('feature_kind')==='dismount',inferred=f.getProperty('confidence')==='low',unsealed=f.getProperty('is_unsealed')===true;
      const mtb=f.getProperty('is_mtb')===true,unverified=['caution','avoid'].includes(String(f.getProperty('trail_routing')))&&['path','track','bridleway'].includes(String(f.getProperty('highway')));
      const color=walk?'#6b7280':mtb?'#a855f7':unverified?'#ec4899':GOOGLE_LTS_COLOURS[lts]||'#6b7280',selected=road?.feature.id===f.getId();
      const weight=selected?7:Math.max(1.2,Math.min(6,(zoom-9)*.6));
      return {clickable:true,zIndex:selected?50:10,strokeColor:selected?'#183c2a':color,strokeWeight:weight,strokeOpacity:inferred||walk||unsealed?0:.48,
        icons:inferred||walk||unsealed?[{icon:{path:'M 0,-1 0,1',strokeColor:color,strokeOpacity:.4,strokeWeight:weight,scale:1.5},offset:'0',repeat:'9px'}]:[]};
    });
  },[map,zoom,viewTick,panoOpen,showRoads,showCrossings,section,sectionCode,road,crossing]);

  useEffect(()=>{
    if(!map||!bundle||!lgaId||!showRoads||panoOpen)return;
    const controller=new AbortController();let disposed=false;
    (async()=>{
      const bounds=map.getBounds();if(!bounds)return;
      const ne=bounds.getNorthEast(),sw=bounds.getSouthWest();
      const wanted=googleWorkshopTiles({west:sw.lng(),east:ne.lng(),north:ne.lat(),south:sw.lat()},map.getZoom()||0);
      if(!wanted.length){if(layers.current)replaceData(layers.current.roads,empty());setRoadMessage('Zoom in to show LTS roads.');return;}
      try{
        const result:Feature<Geometry>[][]=[];
        for(let offset=0;offset<wanted.length;offset+=6){
          const batch=await Promise.all(wanted.slice(offset,offset+6).map(async tile=>{
            const id=`${roadRefresh}/${tile.z}/${tile.x}/${tile.y}`;
            if(tiles.current.has(id))return tiles.current.get(id)!;
            const features=await loadRoadTile(tile,controller.signal);tiles.current.set(id,features);
            if(tiles.current.size>80)tiles.current.delete(tiles.current.keys().next().value!);return features;
          }));result.push(...batch);
        }
        if(disposed||!layers.current)return;replaceData(layers.current.roads,{type:'FeatureCollection',features:result.flat()});setRoadMessage('');
      }catch(cause){if(!disposed)setRoadMessage(cause instanceof Error?cause.message:'LTS roads could not load.');}
    })();
    return()=>{disposed=true;controller.abort();};
  },[map,bundle,lgaId,viewTick,roadRefresh,showRoads,panoOpen]);

  useEffect(()=>{if(map){const id=requestAnimationFrame(()=>{google.maps.event.trigger(map,'resize');google.maps.event.trigger(map.getStreetView(),'resize');});return()=>cancelAnimationFrame(id);}},[map,road,panoOpen]);
  const vote=road?googleWorkshopVoteSegment(road.feature,bundle?.metadata||null):null,p=road?.feature.properties||{};
  const source=crossing?workshopSourceUrl(crossing.osm_id):road?workshopSourceUrl(String(p.osm_id||'')):null;
  return <main className={`google-workshop lts-app ${road&&!panoOpen?'google-workshop-has-road':''}`}>
    <header className="google-workshop-header"><strong>Workshop map</strong><select aria-label="Map view" className="workshop-map-view" value="workshop" disabled={saving} onChange={event=>{window.location.href=workshopViewUrl(window.location.href,event.target.value as WorkshopMapView);}}><option value="standard">Standard LTS map</option><option value="workshop">Workshop map</option><option value="classic">Classic workshop map</option></select>{panoOpen&&<button type="button" onClick={()=>map?.getStreetView().setVisible(false)}>Back to workshop map</button>}</header>
    <div className="google-workshop-map" ref={container} aria-label="Google workshop map" />
    {(!key||error)&&<div className="google-workshop-error" role="alert">{!key?'The Google Maps key is not configured for the workshop.':error} <a href={classicUrl}>Open the classic workshop map</a></div>}
    {key&&!bundle&&!error&&<p className="google-workshop-loading" role="status">Loading the Google workshop map…</p>}
    {!panoOpen&&!road&&bundle&&<section className="workshop-strip" aria-label="Google workshop area selector">
      <div className="workshop-strip-heading"><strong>Choose a workshop area</strong></div>
      <div className="workshop-area-steps"><label htmlFor="google-workshop-lga">1 · LGA</label><select id="google-workshop-lga" value={lgaId} disabled={saving} onChange={e=>chooseLga(e.target.value)}><option value="">Select an LGA…</option>{bundle.lgas.features.map(f=><option key={f.properties.id} value={f.properties.id}>{f.properties.name}{f.properties.partial_coverage?' (edge coverage)':''} · {f.properties.island_count} islands</option>)}</select>
        <label htmlFor="google-workshop-island">2 · Island</label><select id="google-workshop-island" value={sectionCode} disabled={!lgaId||saving} onChange={e=>chooseIsland(e.target.value)}><option value="">{lgaId?'Select an island…':'Choose an LGA first'}</option>{scoped.features.map(f=><option key={f.properties.id} value={f.properties.section_code}>{f.properties.section_code} · {f.properties.area_km2.toFixed(3)} km²</option>)}</select></div>
      {section&&<p className="workshop-detail"><strong>{sectionCode}</strong> · {section.properties.area_km2.toFixed(3)} km² · <a href={pageUrl(lgaId,sectionCode)}>Island link</a></p>}
      <div className="google-workshop-switches"><label><input type="checkbox" checked={showRoads} onChange={e=>setShowRoads(e.target.checked)}/> LTS roads</label><label><input type="checkbox" checked={showCrossings} onChange={e=>setShowCrossings(e.target.checked)}/> Crossing signs</label></div>
      {crossing&&<p className="workshop-detail"><strong>{WORKSHOP_CROSSING_STYLES[crossing.kind].title}</strong>{crossing.has_refuge&&crossing.kind!=='refuge'&&' · Includes a refuge island'} · Bicycle: {crossing.bicycle}{source&&<> · <a href={source} target="_blank" rel="noreferrer">OSM source</a></>}</p>}
      <div className="workshop-footer-actions"><button type="button" disabled={!lgaId} onClick={()=>{const blob=new Blob([workshopAssignmentCsv(scoped,window.location.href,lgaId)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(lga?.properties.name||'workshop').toLowerCase().replaceAll(' ','-')+'-island-assignments.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>LGA assignment list</button></div>
      <p className="workshop-hint">Drag Google’s yellow Pegman onto a blue street to inspect it here. Click a road to inspect or rate it.</p>
      {roadMessage&&<p role="status" className="workshop-hint">{roadMessage}</p>}
    </section>}
    {!panoOpen&&road&&<aside className="google-workshop-road-panel" aria-label="Road details"><button className="google-workshop-close" type="button" disabled={saving} onClick={()=>setRoad(null)} aria-label="Close road details">×</button><h2>{String(p.name||'Unnamed road/path')}</h2><p className="google-workshop-score">{Number.isFinite(Number(p.lts))?'LTS '+String(p.lts):'Walk-bike link'} · {String(p.reason||p.trail_reason||'')}</p><dl><div><dt>Road type</dt><dd>{String(p.highway||'Not tagged')}</dd></div><div><dt>Confidence</dt><dd>{String(p.confidence||'Not available')}</dd></div>{p.maxspeed&&<div><dt>Speed used</dt><dd>{String(p.maxspeed)} km/h{p.speed_inferred?' · inferred':''}</dd></div>}{p.lanes_each_direction&&<div><dt>Lanes / direction</dt><dd>{String(p.lanes_each_direction)}{p.lanes_inferred?' · inferred':''}</dd></div>}</dl>
      <div className="google-workshop-road-actions"><button type="button" onClick={()=>{if(map){const pano=map.getStreetView();pano.setPosition(road.point);pano.setVisible(true);}}}>Inspect in Street View</button>{source&&<a href={source} target="_blank" rel="noreferrer">OSM source ↗</a>}</div>
      {vote?<SegmentVote key={vote.segmentId} segment={vote} onSavingChange={setSaving} onPublished={()=>{tiles.current.clear();setRoadRefresh(v=>v+1);}} onSaved={()=>setSaved('Saved. The map will refresh published ratings.')}/>:<p>This link can be inspected in the current workshop map.</p>}{saved&&<p role="status">{saved}</p>}
    </aside>}
    {!panoOpen&&<div className="google-workshop-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">LTS data © OpenStreetMap contributors</a></div>}
  </main>;
}
