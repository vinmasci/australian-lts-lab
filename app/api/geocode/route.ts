import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface PhotonFeature {
  properties?: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
    extent?: number[];
  };
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface GeocodeResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  bounds: [number, number, number, number] | null;
}

const PHOTON_URL = process.env.PHOTON_GEOCODER_URL || 'https://photon.komoot.io/api/';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const memoryCache = new Map<string, { expiresAt: number; results: GeocodeResult[] }>();
let requestQueue: Promise<void> = Promise.resolve();
let lastUpstreamRequest = 0;

function rateLimited<T>(operation: () => Promise<T>): Promise<T> {
  const pending = requestQueue.then(async () => {
    const delay = Math.max(0, 350 - (Date.now() - lastUpstreamRequest));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastUpstreamRequest = Date.now();
    return operation();
  });
  requestQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

function resultName(properties: NonNullable<PhotonFeature['properties']>): string {
  const street = [properties.housenumber, properties.street].filter(Boolean).join(' ');
  return [properties.name, street, properties.district, properties.city || properties.county, properties.state, properties.postcode, properties.country]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(', ')
    .slice(0, 240);
}

function normaliseResult(feature: PhotonFeature): GeocodeResult | null {
  const properties = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  if (!properties || properties.countrycode?.toUpperCase() !== 'AU' || !coordinates || coordinates.length < 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const extent = properties.extent?.map(Number);
  const bounds = extent?.length === 4 && extent.every(Number.isFinite)
    ? [extent[0], Math.min(extent[1], extent[3]), extent[2], Math.max(extent[1], extent[3])] as [number, number, number, number]
    : null;
  return {
    id: properties.osm_type && properties.osm_id
      ? `${properties.osm_type}-${properties.osm_id}-${properties.osm_key || 'place'}-${properties.osm_value || 'result'}`
      : `place-${longitude}-${latitude}`,
    name: resultName(properties) || 'Unnamed place',
    latitude,
    longitude,
    bounds,
  };
}

function expandRoadAbbreviations(value: string): string {
  return value
    .replace(/\bRd\b/gi, 'Road')
    .replace(/\bSt\b/gi, 'Street')
    .replace(/\bAve\b/gi, 'Avenue')
    .replace(/\bHwy\b/gi, 'Highway')
    .replace(/\s*[/&]\s*/g, ' / ');
}

function normaliseResults(features: PhotonFeature[], query: string): GeocodeResult[] {
  const pairs = features
    .map((feature) => ({ feature, result: normaliseResult(feature) }))
    .filter((pair): pair is { feature: PhotonFeature; result: GeocodeResult } => pair.result !== null);
  const intersectionQuery = /[/&]|\band\b/i.test(query.split(',')[0] || '');
  const consumed = new Set<PhotonFeature>();
  const merged: GeocodeResult[] = [];

  if (intersectionQuery) {
    const groups = new Map<string, PhotonFeature[]>();
    for (const { feature } of pairs) {
      const name = feature.properties?.name;
      if (!name || !/[/&]/.test(name)) continue;
      const key = name.toLocaleLowerCase('en-AU').replace(/\s+/g, ' ').trim();
      groups.set(key, [...(groups.get(key) || []), feature]);
    }
    for (const group of groups.values()) {
      const points = group
        .map((feature) => feature.geometry?.coordinates)
        .filter((coordinates): coordinates is number[] => Boolean(coordinates?.length && coordinates.length >= 2));
      if (!points.length) continue;
      group.forEach((feature) => consumed.add(feature));
      const longitude = points.reduce((sum, point) => sum + Number(point[0]), 0) / points.length;
      const latitude = points.reduce((sum, point) => sum + Number(point[1]), 0) / points.length;
      const first = group[0].properties!;
      const districts = [...new Set(group.map((feature) => feature.properties?.district).filter(Boolean))] as string[];
      const locality = districts.length ? districts.join(' / ') : first.city || first.county;
      const label = [
        `${expandRoadAbbreviations(first.name || query.split(',')[0])} intersection`,
        locality,
        first.city && first.city !== locality ? first.city : null,
        first.state,
        first.country,
      ].filter(Boolean).join(', ');
      const longitudes = points.map((point) => Number(point[0]));
      const latitudes = points.map((point) => Number(point[1]));
      const padding = 0.00035;
      merged.push({
        id: `intersection-${group.map((feature) => feature.properties?.osm_id).join('-')}`,
        name: label,
        latitude,
        longitude,
        bounds: [
          Math.min(...longitudes) - padding,
          Math.min(...latitudes) - padding,
          Math.max(...longitudes) + padding,
          Math.max(...latitudes) + padding,
        ],
      });
    }
  }

  const seen = new Set<string>();
  return [...merged, ...pairs.filter(({ feature }) => !consumed.has(feature)).map(({ result }) => result)]
    .filter((value) => {
      const key = `${value.name}\0${value.longitude}\0${value.latitude}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json({ error: 'Enter between 2 and 120 characters.' }, { status: 400 });
  }

  const focusLatitude = Number(request.nextUrl.searchParams.get('lat'));
  const focusLongitude = Number(request.nextUrl.searchParams.get('lon'));
  const focusZoom = Math.min(18, Math.max(3, Number(request.nextUrl.searchParams.get('zoom')) || 12));
  const hasFocus = Number.isFinite(focusLatitude) && focusLatitude >= -44 && focusLatitude <= -10
    && Number.isFinite(focusLongitude) && focusLongitude >= 112 && focusLongitude <= 154;
  const focusKey = hasFocus ? `${focusLatitude.toFixed(2)},${focusLongitude.toFixed(2)},${Math.round(focusZoom)}` : 'australia';
  const cacheKey = `${query.toLocaleLowerCase('en-AU')}|${focusKey}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ results: cached.results }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  }

  try {
    const url = new URL(PHOTON_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('lang', 'en');
    url.searchParams.set('bbox', '112,-44,154,-10');
    url.searchParams.set('countrycode', 'AU');
    if (hasFocus) {
      url.searchParams.set('lat', String(focusLatitude));
      url.searchParams.set('lon', String(focusLongitude));
      url.searchParams.set('zoom', String(focusZoom));
      url.searchParams.set('location_bias_scale', '0.2');
    }

    const upstream = await rateLimited(() => fetch(url, {
      headers: { 'User-Agent': 'AustralianLTSLab/0.1 (https://ausbug.org.au)' },
      next: { revalidate: 21_600 },
    }));
    if (!upstream.ok) throw new Error(`Place search returned ${upstream.status}.`);
    const payload = await upstream.json() as PhotonResponse;
    const results = normaliseResults(payload.features || [], query);
    memoryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, results });
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    console.error('[Place search]', error);
    return NextResponse.json({ error: 'Place search is temporarily unavailable.' }, { status: 502 });
  }
}
