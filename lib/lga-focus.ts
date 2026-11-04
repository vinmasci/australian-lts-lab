import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';

export interface LgaProperties { id: string; name: string; official_name: string; abs_code: string; }
export type LgaFeature = Feature<Polygon | MultiPolygon, LgaProperties>;
export type LgaCollection = FeatureCollection<Polygon | MultiPolygon, LgaProperties>;

const normalise = (value: string) => value.toLowerCase().replace(/\b(city|shire|rural|borough|of|council)\b/g, '').replace(/[^a-z0-9]/g, '');
export function findLga(data: LgaCollection, value: string): LgaFeature | null {
  if (!value) return null;
  return data.features.find(f => f.properties.id === value || normalise(f.properties.name) === normalise(value) || normalise(f.properties.official_name) === normalise(value)) || null;
}
export function lgaBounds(feature: LgaFeature): [number, number, number, number] {
  const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
  return rings.flat().reduce<[number, number, number, number]>((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
}
function inRing(point: Position, ring: Position[]): 'inside' | 'outside' | 'boundary' {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const cross = (point[0] - a[0]) * dy - (point[1] - a[1]) * dx;
    if (Math.abs(cross) < 1e-10 && point[0] >= Math.min(a[0], b[0]) - 1e-10 && point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10) return 'boundary';
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}
export function pointInLga(point: Position, feature: LgaFeature): boolean {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.some(rings => {
    const outer = inRing(point, rings[0]);
    if (outer === 'outside') return false;
    if (outer === 'boundary') return true;
    return !rings.slice(1).some(hole => inRing(point, hole) === 'inside');
  });
}
function oriented(ring: Position[], clockwise: boolean): Position[] {
  const area = ring.reduce((a, p, i) => { const next = ring[(i + 1) % ring.length]; return a + p[0] * next[1] - next[0] * p[1]; }, 0);
  return (area < 0) === clockwise ? ring : [...ring].reverse();
}
/** Dim everything outside all parts of a council, restoring its interior exclusions. */
export function lgaMask(feature: LgaFeature): FeatureCollection<Polygon> {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const world = [[-180, -85.051129], [180, -85.051129], [180, 85.051129], [-180, 85.051129], [-180, -85.051129]];
  return { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...polygons.map(p => oriented(p[0], true))] } },
    ...polygons.flatMap(p => p.slice(1).map(hole => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [oriented(hole, false)] } }))),
  ] };
}
export function lgaBoundary(feature: LgaFeature): FeatureCollection<MultiLineString> {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat() } }] };
}
export function lgaFocusUrl(page: string, name: string): string {
  const url = new URL(page);
  url.searchParams.delete('section'); url.searchParams.delete('workshop');
  if (name) url.searchParams.set('lga', name); else url.searchParams.delete('lga');
  return url.href;
}
