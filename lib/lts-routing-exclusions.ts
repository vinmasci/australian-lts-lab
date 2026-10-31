import { isLtsVoteLevel, projectApprovedLts } from './lts-voting';

type Coordinate = [number, number];
export interface RoutingExclusion {
  segmentId: string;
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString;
}

function coordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function lines(geometry: RoutingExclusion['geometry']): number[][][] {
  return geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
}

/** Published, reconciled decisions only. A missing restriction store must throw upstream. */
export function routingExclusions(dataset: string, records: Array<Record<string, unknown>>): RoutingExclusion[] {
  return records.flatMap(record => {
    if (record.dataset !== dataset || !isLtsVoteLevel(record.approvedLts)
      || (record.status && !['current', 'carried_forward'].includes(String(record.status)))) return [];
    const segment = record.segment as { currentLts?: number; maxspeed?: number; geometry?: unknown } | undefined;
    const base = Number(record.baseLts ?? segment?.currentLts ?? record.approvedLts);
    const target = isLtsVoteLevel(record.targetLts) ? record.targetLts : record.approvedLts;
    if (projectApprovedLts(base, target, segment?.maxspeed) !== 4.5) return [];
    const geometry = (record.geometry ?? segment?.geometry) as RoutingExclusion['geometry'] | undefined;
    const valid = geometry && (geometry.type === 'Point' ? coordinate(geometry.coordinates)
      : ['LineString', 'MultiLineString'].includes(geometry.type) && lines(geometry).length > 0
        && lines(geometry).every(line => line.length >= 2 && line.every(coordinate)));
    if (!valid || !/^(segment:w|crossing:n)[1-9][0-9]*$/.test(String(record.segmentId))) {
      throw new Error('An LTS 4.5 restriction needs valid, reconciled map geometry. Routing is temporarily unavailable.');
    }
    return [{ segmentId: String(record.segmentId), geometry } as RoutingExclusion];
  });
}

function project(point: number[], origin: number[]): Coordinate {
  return [(point[0] - origin[0]) * 111_320 * Math.cos(origin[1] * Math.PI / 180),
    (point[1] - origin[1]) * 110_540];
}

function pointDistance(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2)) : 0;
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

/** Match travel along the flagged link; a nearby parallel road or transverse bridge is distinct. */
export function routeUsesExclusion(route: GeoJSON.LineString, exclusion: RoutingExclusion): boolean {
  if (exclusion.geometry.type === 'Point') {
    const origin = exclusion.geometry.coordinates;
    return route.coordinates.slice(1).some((end, i) =>
      pointDistance([0, 0], project(route.coordinates[i], origin), project(end, origin)) <= 1.5);
  }
  for (const line of lines(exclusion.geometry)) {
    for (let j = 1; j < line.length; j++) {
      const origin = line[j - 1], end = project(line[j], origin);
      const length = Math.hypot(...end);
      if (length < 0.2) continue;
      const ux = end[0] / length, uy = end[1] / length;
      for (let i = 1; i < route.coordinates.length; i++) {
        const a = project(route.coordinates[i - 1], origin), b = project(route.coordinates[i], origin);
        const dx = b[0] - a[0], dy = b[1] - a[1], distance = Math.hypot(dx, dy);
        if (!distance || Math.abs((dx * ux + dy * uy) / distance) < 0.85) continue;
        const ta = a[0] * ux + a[1] * uy, tb = b[0] * ux + b[1] * uy;
        const low = Math.max(0, Math.min(ta, tb)), high = Math.min(length, Math.max(ta, tb));
        if (high - low < Math.min(0.5, length / 2)) continue;
        const middle: Coordinate = [ux * (low + high) / 2, uy * (low + high) / 2];
        if (pointDistance(middle, a, b) <= 1.5) return true;
      }
    }
  }
  return false;
}

/** Narrow barriers across each flagged edge preserve neighbouring junctions. */
export function avoidanceParameters(exclusions: RoutingExclusion[]): { polylines: string; nogos: string } {
  const polylines: string[] = [], nogos: string[] = [];
  for (const exclusion of exclusions) {
    if (exclusion.geometry.type === 'Point') {
      nogos.push(`${exclusion.geometry.coordinates.slice(0, 2).join(',')},2`);
      continue;
    }
    for (const line of lines(exclusion.geometry)) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], end = project(b, a), length = Math.hypot(...end);
      if (length < 0.2) continue;
      const lonScale = 111_320 * Math.cos(a[1] * Math.PI / 180);
      const dx = -end[1] / length * 2 / lonScale, dy = end[0] / length * 2 / 110_540;
      const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      polylines.push([x + dx, y + dy, x - dx, y - dy].map(n => n.toFixed(7)).join(','));
    }
  }
  if (polylines.join('|').length + nogos.join('|').length > 24_000) {
    throw new Error('Too many LTS 4.5 restrictions for this route. Please plan a shorter section.');
  }
  return { polylines: polylines.join('|'), nogos: nogos.join('|') };
}

export async function routeWithExclusions<T extends { geometry: GeoJSON.LineString }>(
  request: (avoidance?: ReturnType<typeof avoidanceParameters>) => Promise<T>,
  exclusions: RoutingExclusion[],
  waypoints: number[][] = [],
): Promise<T> {
  const avoided = new Map<string, RoutingExclusion>();
  let route = await request();
  // A detour can encounter another unpublished-to-the-graph exclusion. Keep
  // every discovered barrier, rather than abandoning the search after one retry.
  for (let attempt = 0; attempt < 8; attempt++) {
    const conflicts = exclusions.filter(exclusion => routeUsesExclusion(route.geometry, exclusion));
    if (!conflicts.length) {
      if (exclusions.length) assertWaypointConnections(route.geometry, waypoints, exclusions);
      return route;
    }
    const additions = conflicts.filter(exclusion => !avoided.has(exclusion.segmentId));
    // Repeating an ignored barrier cannot improve the route. Never accept it,
    // including when the engine snaps a start/finish point onto that barrier.
    if (!additions.length || attempt === 7) break;
    for (const exclusion of additions) avoided.set(exclusion.segmentId, exclusion);
    route = await request(avoidanceParameters([...avoided.values()]));
  }
  throw new Error('No route avoiding LTS 4.5 was found. Move the start, finish or via point to a suitable connection.');
}

/** Island snapping must not silently move a destination across a forbidden gap. */
export function assertWaypointConnections(route: GeoJSON.LineString, waypoints: number[][], exclusions: RoutingExclusion[]): void {
  for (const point of waypoints) {
    let bestDistance = Infinity;
    let closest: number[] | undefined;
    for (let i = 1; i < route.coordinates.length; i++) {
      const start = route.coordinates[i - 1], end = route.coordinates[i];
      const a = project(start, point), b = project(end, point);
      const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length2)) : 0;
      const distance = Math.hypot(a[0] + t * dx, a[1] + t * dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])];
      }
    }
    if (closest && bestDistance > 0.5 && exclusions.some(exclusion => routeUsesExclusion({
      type: 'LineString', coordinates: [point, closest!],
    }, exclusion))) {
      throw new Error('No route avoiding LTS 4.5 reaches the requested location. Move the start, finish or via point to a suitable connection.');
    }
  }
}
