import type { ReconciliationStatus, VoteSegment } from '@/lib/lts-voting';

type Position = [number, number];

export interface SegmentMatch {
  score: number;
  status: ReconciliationStatus;
  reason: string;
  materialChange: boolean;
}

function positions(geometry: GeoJSON.Geometry): Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates as Position];
  if (geometry.type === 'LineString') return geometry.coordinates as Position[];
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat() as Position[];
  return [];
}

function distanceMetres(left: Position, right: Position): number {
  const latitude = ((left[1] + right[1]) / 2) * Math.PI / 180;
  const x = (right[0] - left[0]) * Math.PI / 180 * Math.cos(latitude);
  const y = (right[1] - left[1]) * Math.PI / 180;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function lineLength(points: Position[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distanceMetres(points[index - 1], points[index]);
  return total;
}

function sample(points: Position[], maximum = 24): Position[] {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * (points.length - 1) / (maximum - 1))]);
}

function nearestDistance(point: Position, candidates: Position[]): number {
  return candidates.reduce((minimum, candidate) => Math.min(minimum, distanceMetres(point, candidate)), Number.POSITIVE_INFINITY);
}

function geometrySimilarity(left: GeoJSON.Geometry, right: GeoJSON.Geometry): number {
  const leftPoints = sample(positions(left));
  const rightPoints = sample(positions(right));
  if (!leftPoints.length || !rightPoints.length) return 0;
  const meanLeft = leftPoints.reduce((sum, point) => sum + nearestDistance(point, rightPoints), 0) / leftPoints.length;
  const meanRight = rightPoints.reduce((sum, point) => sum + nearestDistance(point, leftPoints), 0) / rightPoints.length;
  const proximity = Math.exp(-Math.max(meanLeft, meanRight) / 35);
  const leftLength = lineLength(leftPoints);
  const rightLength = lineLength(rightPoints);
  const lengthRatio = Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength, 1);
  return Math.max(0, Math.min(1, proximity * 0.75 + lengthRatio * 0.25));
}

function normalName(value: string): string {
  return value.toLocaleLowerCase('en-AU').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function segmentMatch(previous: VoteSegment, current: VoteSegment): SegmentMatch {
  const sameIdentity = previous.segmentId === current.segmentId;
  const sameOsmWay = Boolean(previous.osmId && current.osmId && previous.osmId === current.osmId);
  const sameDirection = !previous.direction || !current.direction || previous.direction === current.direction;
  const sameName = normalName(previous.name) !== '' && normalName(previous.name) === normalName(current.name);
  const geometry = geometrySimilarity(previous.geometry, current.geometry);
  const ltsChanged = previous.currentLts !== current.currentLts;

  if (sameIdentity && previous.datasetVersion === current.datasetVersion && !ltsChanged && sameDirection) {
    return { score: 1, status: 'current', reason: 'Exact current segment match.', materialChange: false };
  }

  let score = geometry * 0.65;
  if (sameIdentity) score += 0.35;
  else if (sameOsmWay && sameDirection) score += 0.3;
  else if (sameName) score += 0.12;
  if (!sameDirection) score -= 0.25;
  score = Math.max(0, Math.min(1, score));

  const materialChange = ltsChanged || geometry < 0.58 || !sameDirection;
  if (sameIdentity && !materialChange) {
    return { score, status: 'carried_forward', reason: 'Stable segment carried to a newer dataset snapshot.', materialChange };
  }
  if ((sameOsmWay || sameName) && score >= 0.72 && !materialChange) {
    return { score, status: 'carried_forward', reason: 'Strong OSM and geometry match after a segment identifier change.', materialChange };
  }
  if (score >= 0.48) {
    return { score, status: 'needs_review', reason: ltsChanged ? 'The source classifier changed for this road.' : 'The refreshed road geometry is not an unambiguous match.', materialChange };
  }
  return { score, status: 'orphaned', reason: 'No reliable segment match was found in the refreshed dataset.', materialChange: true };
}

export function bestSegmentMatch(previous: VoteSegment, candidates: VoteSegment[]): { segment: VoteSegment; match: SegmentMatch; ambiguous: boolean } | null {
  const ranked = candidates
    .map((segment) => ({ segment, match: segmentMatch(previous, segment) }))
    .sort((left, right) => right.match.score - left.match.score);
  if (!ranked.length || ranked[0].match.score < 0.48) return null;
  return { ...ranked[0], ambiguous: Boolean(ranked[1] && ranked[0].match.score - ranked[1].match.score < 0.08) };
}
