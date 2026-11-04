'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LtsMap, MapMouseEvent, ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { ltsAppPath } from '@/lib/client-path';
import { WORKSHOP_CROSSING_STYLES, WORKSHOP_SIGN_ZOOM, canSelectWorkshop, normalizeWorkshopCode, workshopAssignmentCsv, workshopEdges, workshopLabels, workshopSourceUrl, workshopIslandsForLga, workshopPassagesForArea, workshopPageUrl, type WorkshopCrossing, type WorkshopCrossings, type WorkshopLga, type WorkshopLgas, type WorkshopSection, type WorkshopSections } from '@/lib/workshop-sections';

const sources=['workshop-areas','workshop-edges','workshop-labels','workshop-passages','workshop-lga'];
const layers=['workshop-hit-area','workshop-lga-boundary','workshop-boundaries','workshop-selection','workshop-numbers','workshop-selected-number','workshop-crossing-points','workshop-crossing-icons'];
const roadLayers=['lts-crossings','lts-dismount','lts-act-access-only-trails','lts-unverified-trails','lts-mtb-trails','lts-unsealed','lts-segments-low-confidence','lts-segments'];
type Bundle={sections:WorkshopSections;crossings:WorkshopCrossings;lgas:WorkshopLgas};
let cachedData:Bundle|null=null;
const kinds=['pedestrian','rail','wombat','zebra','refuge'] as const;
const empty=()=>({type:'FeatureCollection' as const,features:[]});

async function imageData(kind:typeof kinds[number]):Promise<ImageData>{
  const image=new Image();image.src=ltsAppPath('/data/workshop/'+WORKSHOP_CROSSING_STYLES[kind].image);await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=240;
  const context=canvas.getContext('2d');if(!context)throw new Error('Crossing symbols could not load.');
  const scale=240/Math.max(image.naturalWidth,image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;
  context.drawImage(image,(240-width)/2,(240-height)/2,width,height);return context.getImageData(0,0,240,240);
}
function fit(map:LtsMap,feature:Feature<Polygon|MultiPolygon>,island:boolean){
  const points=feature.geometry.type==='Polygon'?feature.geometry.coordinates.flat():feature.geometry.coordinates.flat(2);
  const b=points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:{top:140,bottom:245,left:45,right:45},maxZoom:island?16:13,duration:0});
}

export function WorkshopSections({map,enabled,ready,crossings,routeMode,saving,controlsOpen,onAreaChange}:{
  map:LtsMap|null;enabled:boolean;ready:boolean;crossings:boolean;routeMode:boolean;saving:boolean;controlsOpen:boolean;onAreaChange:()=>void;
}){
  const cache=useRef<Bundle|null>(cachedData),aliveMap=useRef<LtsMap|null>(null);
  const interaction=useRef({routeMode,saving,crossings}),areaChanged=useRef(onAreaChange);
  const lgaRef=useRef(''),scopeRef=useRef<WorkshopSections>(empty());
  const chooseLgaRef=useRef<(id:string)=>void>(()=>undefined),chooseIslandRef=useRef<(code:string)=>void>(()=>undefined);
  const [loading,setLoading]=useState(true),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
  const [lgas,setLgas]=useState<WorkshopLga[]>([]),[lgaId,setLgaId]=useState(''),[islands,setIslands]=useState<WorkshopSection[]>([]);
  const [section,setSection]=useState<WorkshopSection|null>(null),[crossing,setCrossing]=useState<WorkshopCrossing|null>(null);
  useEffect(()=>{interaction.current={routeMode,saving,crossings};areaChanged.current=onAreaChange;},[routeMode,saving,crossings,onAreaChange]);

  useEffect(()=>{
    if(!enabled||!ready||!map||!map.getCanvas().isConnected)return;
    const controller=new AbortController();let cancelled=false,removed=false;aliveMap.current=map;
    const removedMap=()=>{removed=true;cancelled=true;controller.abort();aliveMap.current=null;chooseLgaRef.current=()=>undefined;chooseIslandRef.current=()=>undefined;setLoaded(false);setLoading(true);setSection(null);setCrossing(null);};
    map.on('remove',removedMap);
    const setData=(id:string,data:GeoJSON.FeatureCollection)=>(map.getSource(id) as GeoJSONSource).setData(data);
    const filterSelection=(id:string)=>{
      map.setFilter('workshop-selection',['==',['get','id'],id]);
      map.setFilter('workshop-selected-number',['==',['get','id'],id]);
      map.setFilter('workshop-numbers',['!=',['get','id'],id]);
    };
    const chooseLga=(id:string,zoom:boolean)=>{
      if(cancelled||removed||interaction.current.saving)return;
      const feature=cache.current?.lgas.features.find(f=>f.properties.id===id);
      if(!feature&&id){setError('This LGA is not available in the current workshop coverage.');return;}
      const scoped=id?workshopIslandsForLga(cache.current!.sections,id):empty();
      lgaRef.current=id;scopeRef.current=scoped;setLgaId(id);setSection(null);setCrossing(null);setError('');
      setIslands(scoped.features.map(f=>f.properties).sort((a,b)=>a.section_code.localeCompare(b.section_code)));
      setData('workshop-areas',scoped);setData('workshop-edges',workshopEdges(scoped));setData('workshop-labels',workshopLabels(scoped));
      setData('workshop-lga',feature?{type:'FeatureCollection',features:[feature]}:empty());
      setData('workshop-passages',id?workshopPassagesForArea(cache.current!.crossings,id,new Set(scoped.features.map(f=>f.properties.id))):empty());
      filterSelection('');window.history.replaceState(null,'',workshopPageUrl(window.location.href,id));
      if(feature&&zoom)fit(map,feature,false);
    };
    const chooseIsland=(code:string,zoom:boolean)=>{
      if(cancelled||removed||interaction.current.saving)return;
      if(!code){
        setSection(null);setCrossing(null);filterSelection('');
        setData('workshop-passages',workshopPassagesForArea(cache.current!.crossings,lgaRef.current,new Set(scopeRef.current.features.map(f=>f.properties.id))));
        window.history.replaceState(null,'',workshopPageUrl(window.location.href,lgaRef.current));
        const lga=cache.current!.lgas.features.find(f=>f.properties.id===lgaRef.current);if(lga&&zoom)fit(map,lga,false);return;
      }
      const feature=scopeRef.current.features.find(f=>f.properties.section_code===code);
      if(!feature){setError('Choose an island within the selected LGA.');return;}
      setSection(feature.properties);setCrossing(null);setError('');filterSelection(feature.properties.id);
      setData('workshop-passages',workshopPassagesForArea(cache.current!.crossings,lgaRef.current,new Set([feature.properties.id])));
      window.history.replaceState(null,'',workshopPageUrl(window.location.href,lgaRef.current,code));
      if(zoom)fit(map,feature,true);
    };
    const click=(event:MapMouseEvent)=>{
      const state=interaction.current;if(state.routeMode||state.saving||!lgaRef.current||!map.getLayer('workshop-hit-area'))return;
      const label=map.queryRenderedFeatures(event.point,{layers:['workshop-numbers','workshop-selected-number']})[0];
      if(label){areaChanged.current();chooseIsland(String(label.properties.section_code),true);return;}
      const hit=state.crossings?map.queryRenderedFeatures(event.point,{layers:['workshop-crossing-icons','workshop-crossing-points']})[0]:null;
      if(hit){const p=cache.current?.crossings.features.find(f=>f.properties.id===hit.properties.id)?.properties;if(p){setCrossing(p);map.setLayoutProperty('workshop-crossing-icons','symbol-sort-key',['case',['==',['get','id'],p.id],-1,0]);}return;}
      const available=roadLayers.filter(id=>Boolean(map.getLayer(id)));
      const roads=map.queryRenderedFeatures([[event.point.x-7,event.point.y-7],[event.point.x+7,event.point.y+7]],{layers:available});
      if(!canSelectWorkshop(roads.length>0,state.routeMode,state.saving))return;
      const area=map.queryRenderedFeatures(event.point,{layers:['workshop-hit-area']})[0];if(area){areaChanged.current();chooseIsland(String(area.properties.section_code),false);}
    };
    (async()=>{
      try{
        if(!cache.current){
          const [sections,passages,lgas]=await Promise.all(['sections','crossings','lgas'].map(async name=>{
            const response=await fetch(ltsAppPath('/data/workshop/'+name+'.geojson'),{signal:controller.signal});
            if(!response.ok)throw new Error('Workshop data could not load.');return response.json();
          }));
          if(cancelled)return;cache.current={sections,crossings:passages,lgas};cachedData=cache.current;
        }
        const images=await Promise.all(kinds.map(imageData));if(cancelled)return;
        kinds.forEach((kind,i)=>{if(!map.hasImage('workshop-'+kind))map.addImage('workshop-'+kind,images[i],{pixelRatio:6});});
        map.addSource('workshop-areas',{type:'geojson',data:empty(),tolerance:.2});
        map.addSource('workshop-edges',{type:'geojson',data:empty(),tolerance:.2});
        map.addSource('workshop-labels',{type:'geojson',data:empty()});
        map.addSource('workshop-lga',{type:'geojson',data:empty()});
        map.addSource('workshop-passages',{type:'geojson',data:empty(),cluster:false});
        const before=map.getLayer('lts-segments')?'lts-segments':undefined;
        map.addLayer({id:'workshop-hit-area',type:'fill',source:'workshop-areas',paint:{'fill-opacity':0}},before);
        map.addLayer({id:'workshop-lga-boundary',type:'line',source:'workshop-lga',paint:{'line-color':'#738277','line-width':1.5,'line-dasharray':[3,3]}},before);
        map.addLayer({id:'workshop-boundaries',type:'line',source:'workshop-edges',paint:{'line-color':'#344a40','line-width':1.2,'line-opacity':.8}},before);
        map.addLayer({id:'workshop-selection',type:'line',source:'workshop-edges',filter:['==',['get','id'],''],paint:{'line-color':'#183c2a','line-width':3}},before);
        const label={'text-field':['get','section_code'] as ExpressionSpecification,'text-font':['Noto Sans Regular'],'text-size':12,'text-padding':5,'text-allow-overlap':false};
        map.addLayer({id:'workshop-numbers',type:'symbol',source:'workshop-labels',minzoom:10,layout:label,paint:{'text-color':'#243c31','text-halo-color':'#fff','text-halo-width':2}});
        map.addLayer({id:'workshop-selected-number',type:'symbol',source:'workshop-labels',filter:['==',['get','id'],''],layout:{...label,'text-size':15,'text-allow-overlap':true},paint:{'text-color':'#183c2a','text-halo-color':'#fff','text-halo-width':3}});
        const color:ExpressionSpecification=['match',['get','kind'],'pedestrian',WORKSHOP_CROSSING_STYLES.pedestrian.color,'rail',WORKSHOP_CROSSING_STYLES.rail.color,'wombat',WORKSHOP_CROSSING_STYLES.wombat.color,'zebra',WORKSHOP_CROSSING_STYLES.zebra.color,'refuge',WORKSHOP_CROSSING_STYLES.refuge.color,'#344052'];
        map.addLayer({id:'workshop-crossing-points',type:'circle',source:'workshop-passages',minzoom:10,maxzoom:WORKSHOP_SIGN_ZOOM,paint:{'circle-color':color,'circle-radius':['interpolate',['linear'],['zoom'],10,1.5,12,2,WORKSHOP_SIGN_ZOOM,3],'circle-stroke-color':'#fff','circle-stroke-width':.75}});
        map.addLayer({id:'workshop-crossing-icons',type:'symbol',source:'workshop-passages',minzoom:WORKSHOP_SIGN_ZOOM,layout:{'icon-image':['concat','workshop-',['get','kind']],'icon-size':['interpolate',['linear'],['zoom'],WORKSHOP_SIGN_ZOOM,.65,17,1.05],'icon-allow-overlap':false,'icon-ignore-placement':false}});
        for(const id of ['workshop-crossing-points','workshop-crossing-icons'])map.setLayoutProperty(id,'visibility',interaction.current.crossings?'visible':'none');
        map.on('click',click);
        chooseLgaRef.current=id=>{areaChanged.current();chooseLga(id,true);};
        chooseIslandRef.current=code=>{areaChanged.current();chooseIsland(normalizeWorkshopCode(code),true);};
        setLgas(cache.current.lgas.features.map(f=>f.properties));setLoaded(true);setLoading(false);
        const params=new URLSearchParams(window.location.search),requested=params.get('lga')||'',code=normalizeWorkshopCode(params.get('section')||'');
        const initialIsland=cache.current.sections.features.find(f=>f.properties.section_code===code);
        const initialLga=cache.current.lgas.features.find(f=>f.properties.id===requested)
          ||cache.current.lgas.features.find(f=>initialIsland?.properties.councils.includes(f.properties.id)&&!f.properties.partial_coverage)
          ||cache.current.lgas.features.find(f=>initialIsland?.properties.councils.includes(f.properties.id));
        if(initialLga){const matches=initialIsland?.properties.councils.includes(initialLga.properties.id);chooseLga(initialLga.properties.id,!matches);if(initialIsland)chooseIsland(code,true);}
      }catch(error){if(!cancelled){setError(error instanceof Error?error.message:'Workshop data could not load.');setLoading(false);}}
    })();
    return()=>{
      cancelled=true;controller.abort();map.off('click',click);map.off('remove',removedMap);chooseLgaRef.current=()=>undefined;chooseIslandRef.current=()=>undefined;
      if(aliveMap.current===map)aliveMap.current=null;if(removed||!map.getCanvas().isConnected)return;
      for(const id of [...layers].reverse())if(map.getLayer(id))map.removeLayer(id);
      for(const id of sources)if(map.getSource(id))map.removeSource(id);
    };
  },[enabled,ready,map]);

  useEffect(()=>{
    if(!map||!loaded||aliveMap.current!==map)return;
    for(const id of ['workshop-crossing-points','workshop-crossing-icons'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',crossings?'visible':'none');
  },[map,loaded,crossings]);

  if(!enabled||!ready||controlsOpen)return null;
  const lga=lgas.find(f=>f.id===lgaId),source=crossing?workshopSourceUrl(crossing.osm_id):null;
  return <section className="workshop-strip" aria-label="Workshop area selector">
    <div className="workshop-strip-heading"><strong>Choose a workshop area</strong></div>
    <div className="workshop-area-steps">
      <label htmlFor="workshop-lga">1 · LGA</label>
      <select id="workshop-lga" value={lgaId} disabled={!loaded||saving} onChange={event=>chooseLgaRef.current(event.target.value)}>
        <option value="">Select an LGA…</option>
        {lgas.map(f=><option key={f.id} value={f.id}>{f.name}{f.partial_coverage?' (edge coverage)':''} · {f.island_count} islands</option>)}
      </select>
      <label htmlFor="workshop-island">2 · Island</label>
      <select id="workshop-island" value={section?.section_code||''} disabled={!loaded||!lgaId||saving} onChange={event=>chooseIslandRef.current(event.target.value)}>
        <option value="">{lgaId?'Select an island…':'Choose an LGA first'}</option>
        {islands.map(p=><option key={p.id} value={p.section_code}>{p.section_code} · {p.area_km2.toFixed(3)} km²</option>)}
      </select>
    </div>
    <p className="workshop-hint" role="status">{loading?'Loading workshop areas…':lga?lga.name+' · '+islands.length+' islands':'Select an LGA, then an island to review its roads.'}</p>
    {error&&<p role="alert">{error}</p>}
    {section&&<p className="workshop-detail"><strong>{section.section_code}</strong> · {section.area_km2.toFixed(3)} km² · <a href={workshopPageUrl(window.location.href,lgaId,section.section_code)}>Island link</a></p>}
    {crossing&&crossings&&<p className="workshop-detail"><strong>{WORKSHOP_CROSSING_STYLES[crossing.kind].title}</strong>{crossing.name!==WORKSHOP_CROSSING_STYLES[crossing.kind].title&&<> · {crossing.name}</>}{crossing.has_refuge&&crossing.kind!=='refuge'&&' · Includes a refuge island'} · Bicycle: {crossing.bicycle}{source&&<> · <a href={source} target="_blank" rel="noreferrer">OSM source</a></>}</p>}
    <div className="workshop-footer-actions"><button type="button" disabled={!loaded||!lgaId} onClick={()=>{
      if(!cache.current)return;const scoped=workshopIslandsForLga(cache.current.sections,lgaId);
      const blob=new Blob([workshopAssignmentCsv(scoped,window.location.href,lgaId)],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(lga?.name||'workshop').toLowerCase().replaceAll(' ','-')+'-island-assignments.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>LGA assignment list</button></div>
    {(lga?.coverage_note||lga?.partial_coverage)&&<p className="workshop-hint">{lga?.coverage_note||'Only adjoining islands are currently covered for this LGA.'}</p>}
    <p className="workshop-hint">Islands can cross council borders. Small and narrow enclosures omitted. Click a road to inspect or edit its rating.</p>
  </section>;
}
