import type { FeatureCollection, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson';

export interface WorkshopSection {
  id: string;
  section_code: string;
  section_number: number;
  area_m2: number;
  area_km2: number;
  councils: string[];
  regions: string[];
  centre: [number, number];
}
export type WorkshopSections = FeatureCollection<Polygon | MultiPolygon, WorkshopSection>;
export interface WorkshopLga {
  id: string;
  name: string;
  island_count: number;
  partial_coverage: boolean;
  coverage_note?: string;
}
export type WorkshopLgas = FeatureCollection<Polygon | MultiPolygon, WorkshopLga>;
export interface WorkshopCrossing {
  id: string;
  kind: 'pedestrian' | 'rail' | 'wombat' | 'zebra' | 'refuge';
  name: string;
  osm_id: string;
  bicycle: string;
  crossing_kind?: string;
  source_osm_id?: string;
  has_refuge?: boolean;
  councils: string[];
  section_ids: string[];
}
export type WorkshopCrossings = FeatureCollection<Point, WorkshopCrossing>;

export const WORKSHOP_CROSSING_STYLES = {
  pedestrian: {title:'Pedestrian traffic lights',color:'#167144',image:'pedestrian.png'},
  rail: {title:'Separate railway passage',color:'#7051aa',image:'rail.svg'},
  wombat: {title:'Raised zebra (wombat) crossing',color:'#bb5b1c',image:'wombat.png'},
  zebra: {title:'Zebra crossing',color:'#344052',image:'zebra.png'},
  refuge: {title:'Pedestrian refuge / traffic island',color:'#a87900',image:'refuge.png'},
} as const;
/** Match the app's detailed-marker zoom; dots and signs never overlap. */
export const WORKSHOP_SIGN_ZOOM = 14.5;

/** The public website already proxies the standard map; workshop lives on the LTS host. */
export function workshopMapViewUrl(pageUrl:string,workshop:boolean):string{
  const page=new URL(pageUrl);
  const publicHosts=['ausbug.app','www.ausbug.app','vicbug.app','www.vicbug.app','australian-lts-lab.vercel.app'];
  const origin=publicHosts.includes(page.hostname)?(workshop?'https://australian-lts-lab.vercel.app':'https://ausbug.app'):page.origin;
  return new URL(workshop?'/ltsmap/workshop':'/ltsmap',origin).href;
}

export function workshopEdges(sections: WorkshopSections): FeatureCollection<MultiLineString, { id: string }> {
  return { type: 'FeatureCollection', features: sections.features.map(f => ({
    type: 'Feature', properties: { id: f.properties.id },
    geometry: { type: 'MultiLineString', coordinates: f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p => p[0]) },
  })) };
}

export function workshopLabels(sections: WorkshopSections): FeatureCollection<Point, WorkshopSection> {
  return { type: 'FeatureCollection', features: sections.features.map(f => ({
    type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: f.properties.centre },
  })) };
}

export function normalizeWorkshopCode(value: string): string {
  const text = value.trim().toUpperCase().replace(/[\s-]/g, '');
  const match = text.match(/^([MB])?0*(\d{1,6})$/);
  return match ? (match[1] || 'M') + String(Number(match[2])).padStart(4, '0') : text;
}

export function workshopIslandsForLga(sections: WorkshopSections, lga: string): WorkshopSections {
  return {type:'FeatureCollection',features:sections.features.filter(f=>f.properties.councils.includes(lga))};
}

export function workshopPassagesForArea(crossings: WorkshopCrossings, lga: string, islandIds: Set<string>): WorkshopCrossings {
  return {type:'FeatureCollection',features:crossings.features.filter(f=>
    (islandIds.size===0&&f.properties.councils.includes(lga)) || f.properties.section_ids.some(id=>islandIds.has(id)))};
}

export function workshopPageUrl(pageUrl: string, lga: string, code?: string): string {
  const url=new URL(pageUrl);url.pathname='/ltsmap/workshop';url.search='';
  if(lga)url.searchParams.set('lga',lga);
  if(code)url.searchParams.set('section',code);
  return url.href;
}

export function workshopSourceUrl(osmId: string): string | null {
  const match = osmId.match(/^([nwr])(\d+)$/);
  return match ? `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[match[1]]}/${match[2]}` : null;
}

/** Existing road inspection, multi-selection and routing always keep priority. */
export function canSelectWorkshop(roadHit: boolean, routeMode: boolean, saving: boolean): boolean {
  return !roadHit && !routeMode && !saving;
}

export function workshopAssignmentCsv(sections: WorkshopSections, pageUrl: string, lga = ''): string {
  const rows: (string | number)[][] = [['Section label', 'Council(s)', 'Area (km²)', 'Champion', 'BUG group', 'Status', 'Notes', 'Map link', 'Section ID']];
  for (const f of [...sections.features].sort((a,b) => a.properties.section_code.localeCompare(b.properties.section_code))) {
    const p = f.properties, url = workshopPageUrl(pageUrl,lga,p.section_code);
    rows.push([p.section_code, p.councils.join('; '), p.area_km2, '', '', 'Unassigned', '', url, p.id]);
  }
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
