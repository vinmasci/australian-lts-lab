import { NextRequest, NextResponse } from 'next/server';

const USING_LOCAL_ENRICHED_ROUTER = process.env.NODE_ENV === 'development';
const DEFAULT_BROUTER_ROUTE_URL = process.env.LTS_BROUTER_URL
  || (USING_LOCAL_ENRICHED_ROUTER ? 'http://127.0.0.1:17780/brouter' : 'https://valhalla.vicbug.app/brouter');
const ROUTER_URLS = {
  victoria: DEFAULT_BROUTER_ROUTE_URL,
  nsw: process.env.LTS_BROUTER_NSW_URL || 'https://valhalla.vicbug.app/lts-brouter-nsw',
  queensland: DEFAULT_BROUTER_ROUTE_URL,
  western_australia: process.env.LTS_BROUTER_WA_URL || 'https://valhalla.vicbug.app/lts-brouter-wa',
  south_australia: process.env.LTS_BROUTER_SA_URL || 'https://valhalla.vicbug.app/lts-brouter-sa',
  act: process.env.LTS_BROUTER_ACT_URL || 'https://valhalla.vicbug.app/lts-brouter-act',
  tasmania: process.env.LTS_BROUTER_TAS_URL || 'https://valhalla.vicbug.app/lts-brouter-tas',
  northern_territory: process.env.LTS_BROUTER_NT_URL || 'https://valhalla.vicbug.app/lts-brouter-nt',
} as const;
type RoutableDataset = keyof typeof ROUTER_URLS;
const COMPARISON_BROUTER_ROUTE_URL = process.env.BROUTER_COMPARISON_URL
  || 'https://valhalla.vicbug.app/brouter';
const COMPARISON_PROFILE = 'cyabikepath';
const ROUTING_CLASSIFIER_VERSION = process.env.LTS_ROUTER_CLASSIFIER_VERSION?.trim()
  || (USING_LOCAL_ENRICHED_ROUTER ? 'au-lts-v0.5-trail-suitability-test' : 'au-lts-brouter-v0.1');

type Coordinate = [number, number] | [number, number, number];
type MessageRow = Array<string | number>;

interface BRouterProperties {
  messages?: MessageRow[];
  'track-length'?: string | number;
  'total-time'?: string | number;
  [key: string]: unknown;
}

interface BRouterFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: Coordinate[];
  };
  properties: BRouterProperties;
}

interface BRouterResponse {
  type?: 'FeatureCollection';
  features?: BRouterFeature[];
  error?: string;
}

interface ParsedMessage {
  coordinate: [number, number];
  distanceMetres: number;
  costPerKm: number;
  wayTags: string;
}

interface ComparisonResult {
  route?: BRouterFeature['geometry'];
  summary?: {
    distance_m: number;
    time_ms: number;
  };
  error?: string;
}

function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && value.every((part) => typeof part === 'number' && Number.isFinite(part))
    && value[0] >= -180 && value[0] <= 180
    && value[1] >= -90 && value[1] <= 90;
}

function isRoutableDataset(value: unknown): value is RoutableDataset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROUTER_URLS, value);
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ltsFromCost(costPerKm: number): number {
  if (costPerKm <= 1200) return 1;
  if (costPerKm <= 3000) return 2;
  if (costPerKm <= 9000) return 3;
  return 4;
}

function precomputedLtsFromWayTags(wayTags: string): number | null {
  const reversed = wayTags.includes('reversedirection=yes');
  const firstTag = reversed ? 8 : 4;
  for (let lts = 1; lts <= 4; lts += 1) {
    const tagNumber = String(firstTag + lts - 1).padStart(2, '0');
    if (wayTags.includes(`brouter_route_placeholder_dummy_${tagNumber}=dummy`)) return lts;
  }
  return null;
}

function hasPlaceholder(wayTags: string, number: number): boolean {
  const tagNumber = String(number).padStart(2, '0');
  return wayTags.includes(`brouter_route_placeholder_dummy_${tagNumber}=dummy`);
}

function tagValue(wayTags: string, key: string): string {
  const match = wayTags.match(new RegExp(`(?:^|[ ,])${key.replace(':', '\\:')}=([^ ,]+)`));
  return match?.[1] || '';
}

function parseMessages(properties: BRouterProperties): ParsedMessage[] {
  const messages = properties.messages;
  if (!Array.isArray(messages) || messages.length < 2) return [];

  const header = messages[0].map(String);
  const longitudeIndex = header.indexOf('Longitude');
  const latitudeIndex = header.indexOf('Latitude');
  const distanceIndex = header.indexOf('Distance');
  const costIndex = header.indexOf('CostPerKm');
  const tagsIndex = header.indexOf('WayTags');
  if ([longitudeIndex, latitudeIndex, distanceIndex, costIndex].some((index) => index < 0)) return [];

  return messages.slice(1).flatMap((row) => {
    const longitude = asNumber(row[longitudeIndex], Number.NaN) / 1_000_000;
    const latitude = asNumber(row[latitudeIndex], Number.NaN) / 1_000_000;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [{
      coordinate: [longitude, latitude] as [number, number],
      distanceMetres: asNumber(row[distanceIndex]),
      costPerKm: asNumber(row[costIndex], 5000),
      wayTags: tagsIndex >= 0 ? String(row[tagsIndex] || '') : '',
    }];
  });
}

function nearestForwardIndex(
  coordinates: Coordinate[],
  target: [number, number],
  fromIndex: number,
): number {
  let bestIndex = Math.min(fromIndex, coordinates.length - 1);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = bestIndex; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    const distance = Math.abs(coordinate[0] - target[0]) + Math.abs(coordinate[1] - target[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
    // BRouter message coordinates mark the end of each diagnostic section.
    // Only stop on an effectively exact match; a merely nearby coordinate can
    // belong to the preceding or following section at a junction.
    if (distance < 0.000001) break;
  }
  return bestIndex;
}

function buildStressOutput(feature: BRouterFeature) {
  const coordinates = feature.geometry.coordinates;
  const messages = parseMessages(feature.properties);
  const routeDistance = asNumber(feature.properties['track-length']);
  const routeTimeMilliseconds = asNumber(feature.properties['total-time']) * 1000;
  const distanceByLts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
  let knownUnsealedDistance = 0;
  let mtbCautionDistance = 0;
  let technicalMtbDistance = 0;
  let unverifiedTrailDistance = 0;
  let hikingOnlyDistance = 0;
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  if (messages.length === 0 || coordinates.length < 2) {
    distanceByLts['3'] = routeDistance;
    features.push({
      type: 'Feature',
      properties: { lts: 3, cost_per_km: 5000, confidence: 'low' },
      geometry: { type: 'LineString', coordinates },
    });
  } else {
    const anchors: number[] = [];
    let searchFrom = 0;
    for (const message of messages) {
      const index = nearestForwardIndex(coordinates, message.coordinate, searchFrom);
      anchors.push(index);
      searchFrom = index;
    }

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const lts = precomputedLtsFromWayTags(message.wayTags) ?? ltsFromCost(message.costPerKm);
      const isUnsealed = hasPlaceholder(message.wayTags, 13);
      const mtbRouting = hasPlaceholder(message.wayTags, 15)
        ? 'avoid'
        : hasPlaceholder(message.wayTags, 14) ? 'caution' : 'normal';
      const surface = tagValue(message.wayTags, 'surface');
      const trailRouting = hasPlaceholder(message.wayTags, 17)
        ? 'avoid'
        : hasPlaceholder(message.wayTags, 16) ? 'caution' : 'normal';
      distanceByLts[String(lts)] += message.distanceMetres;
      if (isUnsealed) knownUnsealedDistance += message.distanceMetres;
      if (mtbRouting === 'caution') mtbCautionDistance += message.distanceMetres;
      if (mtbRouting === 'avoid') technicalMtbDistance += message.distanceMetres;
      if (trailRouting === 'caution') unverifiedTrailDistance += message.distanceMetres;
      if (trailRouting === 'avoid') hikingOnlyDistance += message.distanceMetres;

      // A BRouter message describes the section ending at its coordinate, not
      // the section starting there. Using the next anchor shifts every colour
      // forward by one road, which is most visible beside short roundabouts.
      const startIndex = index === 0 ? 0 : anchors[index - 1];
      const endIndex = index === messages.length - 1 ? coordinates.length - 1 : anchors[index];
      if (endIndex <= startIndex) continue;
      const sectionCoordinates = coordinates.slice(startIndex, endIndex + 1);
      const previous = features.at(-1);
      if (
        previous?.properties?.lts === lts
        && previous.properties.is_unsealed === isUnsealed
        && previous.properties.mtb_routing === mtbRouting
        && previous.properties.surface === surface
        && previous.properties.trail_routing === trailRouting
      ) {
        previous.geometry.coordinates.push(...sectionCoordinates.slice(1));
      } else {
        features.push({
          type: 'Feature',
          properties: {
            lts,
            cost_per_km: message.costPerKm,
            way_tags: message.wayTags,
            surface,
            is_unsealed: isUnsealed,
            mtb_routing: mtbRouting,
            trail_routing: trailRouting,
          },
          geometry: { type: 'LineString', coordinates: sectionCoordinates },
        });
      }
    }
  }

  const measuredDistance = Object.values(distanceByLts).reduce((sum, value) => sum + value, 0);
  const percentages = Object.fromEntries(
    Object.entries(distanceByLts).map(([lts, metres]) => [
      lts,
      measuredDistance > 0 ? Math.round((metres / measuredDistance) * 1000) / 10 : 0,
    ]),
  );

  return {
    segments: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection<GeoJSON.LineString>,
    summary: {
      distance_m: routeDistance || measuredDistance,
      time_ms: routeTimeMilliseconds,
      distance_by_lts_m: Object.fromEntries(
        Object.entries(distanceByLts).map(([lts, metres]) => [lts, Math.round(metres)]),
      ),
      percentage_by_lts: percentages,
      highest_lts: Math.max(
        ...Object.entries(distanceByLts).filter(([, metres]) => metres > 0).map(([lts]) => Number(lts)),
        1,
      ),
      known_unsealed_distance_m: Math.round(knownUnsealedDistance),
      mtb_caution_distance_m: Math.round(mtbCautionDistance),
      technical_mtb_distance_m: Math.round(technicalMtbDistance),
      unverified_trail_distance_m: Math.round(unverifiedTrailDistance),
      hiking_only_distance_m: Math.round(hikingOnlyDistance),
    },
  };
}

async function requestComparisonRoute(
  points: Array<[number, number]>,
  allowGravel: boolean,
): Promise<ComparisonResult> {
  try {
    const upstreamUrl = new URL(COMPARISON_BROUTER_ROUTE_URL);
    upstreamUrl.searchParams.set(
      'lonlats',
      points.map(([longitude, latitude]) => `${longitude},${latitude}`).join('|'),
    );
    upstreamUrl.searchParams.set('profile', COMPARISON_PROFILE);
    upstreamUrl.searchParams.set('alternativeidx', '0');
    upstreamUrl.searchParams.set('format', 'geojson');
    if (!allowGravel) upstreamUrl.searchParams.set('profile:avoid_unpaved', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      cache: 'no-store',
    }).finally(() => clearTimeout(timeout));
    const raw = await upstream.text();
    let response: BRouterResponse;
    try {
      response = JSON.parse(raw) as BRouterResponse;
    } catch {
      return { error: raw.trim() || `BRouter comparison returned HTTP ${upstream.status}.` };
    }

    const feature = response.features?.[0];
    if (!upstream.ok || response.error || !feature?.geometry?.coordinates?.length) {
      return { error: response.error || 'The AusBUG Bike Paths comparison was unavailable.' };
    }

    return {
      route: feature.geometry,
      summary: {
        distance_m: asNumber(feature.properties['track-length']),
        time_ms: asNumber(feature.properties['total-time']) * 1000,
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error && error.name === 'AbortError'
        ? 'The AusBUG Bike Paths comparison timed out.'
        : error instanceof Error ? error.message : 'The AusBUG Bike Paths comparison failed.',
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { points?: unknown; allow_gravel?: unknown; dataset?: unknown };
    if (!Array.isArray(body.points) || body.points.length < 2 || body.points.length > 26 || !body.points.every(isCoordinate)) {
      return NextResponse.json(
        { error: 'Provide between two and 26 valid [longitude, latitude] points.' },
        { status: 400 },
      );
    }

    const points = body.points as Array<[number, number]>;
    const allowGravel = body.allow_gravel !== false;
    const dataset: RoutableDataset = body.dataset === undefined
      ? 'victoria'
      : isRoutableDataset(body.dataset) ? body.dataset : 'victoria';
    if (body.dataset !== undefined && !isRoutableDataset(body.dataset)) {
      return NextResponse.json({ error: 'Low-stress routing is not enabled for that dataset.' }, { status: 400 });
    }
    const comparisonPromise = requestComparisonRoute(points, allowGravel);

    const upstreamUrl = new URL(ROUTER_URLS[dataset]);
    upstreamUrl.searchParams.set(
      'lonlats',
      points.map(([longitude, latitude]) => `${longitude},${latitude}`).join('|'),
    );
    upstreamUrl.searchParams.set('profile', 'cyalts');
    upstreamUrl.searchParams.set('alternativeidx', '0');
    upstreamUrl.searchParams.set('format', 'geojson');
    if (!allowGravel) {
      upstreamUrl.searchParams.set('profile:avoid_unpaved', '1');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      cache: 'no-store',
    }).finally(() => clearTimeout(timeout));

    const raw = await upstream.text();
    let brouter: BRouterResponse;
    try {
      brouter = JSON.parse(raw) as BRouterResponse;
    } catch {
      return NextResponse.json(
        { error: raw.trim() || `BRouter returned HTTP ${upstream.status}.` },
        { status: 502 },
      );
    }

    const feature = brouter.features?.[0];
    if (!upstream.ok || brouter.error || !feature?.geometry?.coordinates?.length) {
      return NextResponse.json(
        { error: brouter.error || 'BRouter did not return a route.' },
        { status: upstream.ok ? 422 : 502 },
      );
    }

    const comparison = await comparisonPromise;

    return NextResponse.json({
      classifier_version: ROUTING_CLASSIFIER_VERSION,
      dataset,
      engine: 'BRouter',
      profile: 'cyalts',
      route: feature.geometry,
      instructions: [],
      comparison: comparison.route && comparison.summary ? {
        label: 'AusBUG Bike Paths',
        profile: COMPARISON_PROFILE,
        route: comparison.route,
        summary: comparison.summary,
      } : null,
      comparison_error: comparison.error,
      ...buildStressOutput(feature),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'The LTS router timed out.'
      : error instanceof Error ? error.message : 'The LTS router failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
