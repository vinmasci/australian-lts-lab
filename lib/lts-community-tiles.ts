import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { fromVectorTileJs } from 'vt-pbf';
import { applyHardSpeedRuleFloor, projectApprovedLts, isLtsVoteLevel, type LtsVoteLevel } from './lts-voting';

export function tileApprovals(dataset: string, records: Array<Record<string, unknown>>): Map<string, LtsVoteLevel> {
  const ratings = new Map<string, LtsVoteLevel>();
  for (const record of records) {
    if (record.dataset !== dataset || !isLtsVoteLevel(record.approvedLts)) continue;
    if (record.status && !['current', 'carried_forward'].includes(String(record.status))) continue;
    const id = /^segment:(w[1-9][0-9]*)$/.exec(String(record.segmentId));
    if (!id) continue;
    const segment = record.segment as { maxspeed?: number; currentLts?: number } | undefined;
    const base = Number(record.baseLts ?? segment?.currentLts ?? record.approvedLts);
    ratings.set(id[1], base >= 4 ? projectApprovedLts(base, isLtsVoteLevel(record.targetLts) ? record.targetLts : record.approvedLts, segment?.maxspeed) : applyHardSpeedRuleFloor(base, record.approvedLts, segment?.maxspeed));
  }
  return ratings;
}

const colours: Record<LtsVoteLevel, string> = {
  1: '#16a34a', 1.5: '#06b6d4', 2: '#2563eb', 3: '#f59e0b', 4: '#dc2626',
};

/** Change properties, never reconstruct/simplify road geometry or join crossings. */
export function applyTileApprovals(data: Uint8Array, ratings: ReadonlyMap<string, LtsVoteLevel>): Uint8Array {
  if (!ratings.size) return data;
  const tile = new VectorTile(new Pbf(data));
  const layer = tile.layers.lts;
  if (!layer) return data;
  let changed = false;
  const features = Array.from({ length: layer.length }, (_, index) => {
    const feature = layer.feature(index);
    const p = feature.properties;
    const rating = p.feature_kind === 'segment' ? ratings.get(String(p.osm_id)) : undefined;
    if (rating === undefined) return feature;
    // Recheck against the CURRENT tile's speed, not just the saved vote snapshot.
    const speed = Math.max(Number(p.maxspeed) || 0, Number(p.official_speed_forward) || 0, Number(p.official_speed_backward) || 0);
    const base = Number(p.lts);
    if (!Number.isFinite(base)) return feature;
    const lts = applyHardSpeedRuleFloor(base, rating, speed);
    feature.properties = { ...p, base_lts: base, lts,
      lts_forward: applyHardSpeedRuleFloor(Number(p.lts_forward ?? base), rating, speed),
      lts_backward: applyHardSpeedRuleFloor(Number(p.lts_backward ?? base), rating, speed),
      colour: colours[lts], community_lts: true,
    };
    changed = true;
    return feature;
  });
  if (!changed) return data;
  layer.feature = (index: number) => features[index];
  // vt-pbf accepts vector-tile-js objects; its DefinitelyTyped signature incorrectly names geojson-vt.
  return fromVectorTileJs(tile as unknown as Parameters<typeof fromVectorTileJs>[0]);
}
