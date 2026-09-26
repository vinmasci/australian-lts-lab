import { isLtsVoteLevel, type VoteSegment } from '@/lib/lts-voting';

export const PATH_TYPES = ['cycling', 'walking', 'mtb', 'unsure'] as const;
export type PathType = (typeof PATH_TYPES)[number];
export const PATH_TYPE_LABELS: Record<PathType, string> = {
  cycling: 'Suitable for cycling', walking: 'Walking only / dismount', mtb: 'MTB trail', unsure: 'Unsure',
};
export interface PathCorrection {
  id: string;
  segment: VoteSegment;
  pathType: PathType;
  note: string;
  contributorUid: string;
  contributorName: string;
  contributorEmail: string;
  updatedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
}
export interface PublishedPathCorrection {
  segment: VoteSegment;
  pathType: Exclude<PathType, 'unsure'>;
  osmVersion: number;
  approvedAt: string;
}
export function isPathType(value: unknown): value is PathType {
  return typeof value === 'string' && PATH_TYPES.includes(value as PathType);
}
export function canCorrectPath(segment: VoteSegment): boolean {
  return segment.featureKind === 'segment'
    && /^w[1-9][0-9]*$/.test(segment.osmId || '')
    && segment.segmentId === `segment:${segment.osmId}`
    && isLtsVoteLevel(segment.currentLts)
    && ['caution', 'avoid'].includes(segment.trailRouting || '')
    && ['path', 'track', 'bridleway'].includes(segment.highway || '')
    && segment.isMtb !== true;
}
export function validPathSegment(value: unknown): value is VoteSegment {
  if (!value || typeof value !== 'object') return false;
  const s = value as VoteSegment;
  const datasets = ['victoria', 'nsw', 'queensland', 'western_australia', 'south_australia', 'act', 'tasmania', 'northern_territory'];
  if (!datasets.includes(s.dataset) || !canCorrectPath(s) || typeof s.name !== 'string' || s.name.length > 160) return false;
  if (typeof s.datasetVersion !== 'string' || !/^[a-zA-Z0-9:._-]{1,160}$/.test(s.datasetVersion)) return false;
  if (s.geometry?.type !== 'LineString' && s.geometry?.type !== 'MultiLineString') return false;
  if (JSON.stringify(s.geometry).length > 100_000) return false;
  const lines = s.geometry.type === 'LineString' ? [s.geometry.coordinates] : s.geometry.coordinates;
  return Array.isArray(lines) && lines.length > 0 && lines.every(line => Array.isArray(line) && line.length >= 2
    && line.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
      && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90));
}
// Explicit access and technical constraints take precedence over a community suggestion.
export function pathApprovalError(tags: Record<string, string>, pathType: PathType): string | null {
  if (!['path', 'track', 'bridleway'].includes(tags.highway)) return 'This is no longer an unverified path or track.';
  if (['no', 'private'].includes(tags.access) && !['yes', 'designated', 'permissive'].includes(tags.bicycle)) return 'Explicit access restrictions must be corrected in OSM first.';
  if (['no', 'private', 'dismount', 'use_sidepath'].includes(tags.bicycle)) return 'Explicit bicycle restrictions must be corrected in OSM first.';
  if (pathType === 'walking' && ['no', 'private'].includes(tags.foot)) return 'Explicit walking restrictions must be corrected in OSM first.';
  if (pathType === 'cycling' && ((tags.sac_scale && tags.sac_scale !== 'hiking') || Number(tags['mtb:scale'] || 0) > 0)) {
    return 'Technical trail evidence needs an MTB classification, not ordinary cycling.';
  }
  return null;
}
export function mergePathCorrections(collection: GeoJSON.FeatureCollection, corrections: PublishedPathCorrection[]): GeoJSON.FeatureCollection {
  const byId = new Map(collection.features.map(f => [String(f.properties?.segment_id || f.id), f]));
  for (const correction of corrections) {
    const s = correction.segment;
    const previous = byId.get(s.segmentId);
    byId.set(s.segmentId, {
      type: 'Feature', id: s.segmentId, geometry: s.geometry,
      properties: { ...previous?.properties, segment_id: s.segmentId,
        lts: previous?.properties?.lts ?? s.currentLts, path_type: correction.pathType,
        path_only: previous ? false : true, osm_id: s.osmId, feature_kind: 'segment', name: s.name,
        osm_version: correction.osmVersion, dataset_version: s.datasetVersion,
        highway: s.highway, trail_routing: s.trailRouting, is_mtb: false,
        approved_at: correction.approvedAt, reconciliation_status: 'current',
        reason: `Community path correction: ${PATH_TYPE_LABELS[correction.pathType]}.`,
      },
    });
  }
  return { type: 'FeatureCollection', features: [...byId.values()] };
}
