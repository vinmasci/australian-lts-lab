import type { FeatureCollection, LineString, MultiLineString } from 'geojson';
import { ltsAppPath } from './client-path';

export const WORKSHOP_SCC_COLOUR = '#8634c7';
export const WORKSHOP_SCC_SOURCE = 'https://www.vic.gov.au/strategic-cycling-corridors';
export type WorkshopScc = FeatureCollection<LineString | MultiLineString, { classification: 'C1' | 'C2' }>;
let pending: Promise<WorkshopScc> | null = null;

/** Shared, separately loaded reference layer; never used as an LTS rating. */
export function loadWorkshopScc(): Promise<WorkshopScc> {
  if (!pending) pending = fetch(ltsAppPath('/data/workshop/scc.geojson')).then(async response => {
    if (!response.ok) throw new Error('SCC corridors could not load.');
    return response.json() as Promise<WorkshopScc>;
  }).catch(error => { pending = null; throw error; });
  return pending;
}
