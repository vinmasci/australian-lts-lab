import type { Feature, Geometry } from 'geojson';
import { isLtsVoteLevel, type VoteSegment } from './lts-voting';

export const GOOGLE_LTS_COLOURS:Record<number,string>={1:'#16a34a',1.5:'#06b6d4',2:'#2563eb',3:'#f59e0b',4:'#dc2626',4.5:'#7f1d1d'};
export type WorkshopTile={z:number;x:number;y:number};
export function googleWorkshopTiles(bounds:{west:number;east:number;north:number;south:number},zoom:number):WorkshopTile[]{
  if(zoom<10||!Object.values(bounds).every(Number.isFinite)||bounds.east<bounds.west)return [];
  const z=Math.min(14,Math.max(10,Math.floor(zoom))),n=2**z;
  const x=(lng:number)=>Math.max(0,Math.min(n-1,Math.floor((lng+180)/360*n)));
  const y=(lat:number)=>{const r=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;return Math.max(0,Math.min(n-1,Math.floor((1-Math.asinh(Math.tan(r))/Math.PI)/2*n)));};
  const left=x(bounds.west),right=x(bounds.east),top=y(bounds.north),bottom=y(bounds.south);
  if((right-left+1)*(bottom-top+1)>49)return [];
  return Array.from({length:right-left+1},(_,i)=>Array.from({length:bottom-top+1},(_,j)=>({z,x:left+i,y:top+j}))).flat();
}
export interface GoogleWorkshopMetadata{source_pbf_modified_at:string;classifier_version:string;}
/** Use the same contribution identity and original classifier score as the standard map. */
export function googleWorkshopVoteSegment(feature:Feature<Geometry>,metadata:GoogleWorkshopMetadata|null):VoteSegment|null{
  const p=feature.properties||{},base=Number(p.base_lts??p.lts),kind=String(p.feature_kind||'segment');
  if(!isLtsVoteLevel(base)||kind!=='segment'||!/^w\d+$/.test(String(p.osm_id||'')))return null;
  const direction=p.lts_direction||p.direction,source=String(p.segment_id||p.osm_id);
  const speed=Number(p.maxspeed),traffic=Number(p.traffic_aadt);
  return {dataset:'victoria',segmentId:`${kind}:${source}${direction?':'+String(direction):''}`.replace(/[^a-zA-Z0-9:._-]/g,'_').slice(0,160),
    name:String(p.name||'Unnamed road/path').slice(0,160),featureKind:kind,currentLts:base,geometry:feature.geometry,
    osmId:String(p.osm_id),direction:direction?String(direction).slice(0,30):undefined,highway:String(p.highway||''),trailRouting:String(p.trail_routing||''),isMtb:p.is_mtb===true||p.is_mtb===1,
    maxspeed:Number.isFinite(speed)?speed:undefined,trafficAadt:Number.isFinite(traffic)?traffic:undefined,
    datasetVersion:metadata?`${metadata.source_pbf_modified_at}:${metadata.classifier_version}`.slice(0,160):undefined,
    classifierVersion:metadata?.classifier_version,osmSnapshotDate:metadata?.source_pbf_modified_at};
}
