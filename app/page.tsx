'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl, { MapMouseEvent, MapboxGeoJSONFeature } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Bike, ExternalLink, Info, MapPin, Route as RouteIcon, RotateCcw, X } from 'lucide-react';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const PMTILES_SCRIPT_URL = '/vendor/mapbox-pmtiles.iife.js';
const DATASET_VERSION = 'au-lts-v0.5-trail-suitability';
const USING_LOCAL_ENRICHED_ROUTER = process.env.NODE_ENV === 'development';
const DATASETS = {
  victoria: {
    label: 'Victoria',
    title: 'Australian LTS Lab · Victoria',
    dataUrl: process.env.NEXT_PUBLIC_VICTORIA_PMTILES_URL || '/data/lts/victoria-lts.pmtiles',
    metadataUrl: `/data/lts/victoria-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [145.15, -36.75] as [number, number],
    zoom: 7.1,
    routable: true,
  },
  nsw: {
    label: 'New South Wales',
    title: 'Australian LTS Lab · NSW',
    dataUrl: process.env.NEXT_PUBLIC_NSW_PMTILES_URL || '/data/lts/nsw-lts.pmtiles',
    metadataUrl: `/data/lts/nsw-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [147.2, -32.7] as [number, number],
    zoom: 7,
    routable: false,
  },
} as const;
type DatasetKey = keyof typeof DATASETS;
const LTS_COLOURS: Record<number, string> = {
  1: '#16a34a',
  2: '#2563eb',
  3: '#f59e0b',
  4: '#dc2626',
};
const LTS_LABELS: Record<number, string> = {
  1: 'Very low stress',
  2: 'Low stress',
  3: 'Higher stress',
  4: 'High stress',
};

interface MapboxPmTilesGlobal {
  SOURCE_TYPE: string;
  PmTilesSource: unknown;
}

interface LtsMetadata {
  classifier_version: string;
  generated_at: string;
  source_pbf_modified_at: string;
  segments: number;
  crossings: number;
  segment_counts: Record<string, number>;
  segment_distance_km: Record<string, number>;
  crossing_counts: Record<string, number>;
  confidence_counts: Record<string, number>;
  traffic_volume?: {
    available_directional_records: number;
    matched_segments: number;
    matched_distance_km: number;
    uplifted_segments: number;
    methodology_counts: Record<string, number>;
    source_counts: Record<string, number>;
    volume_band_counts: Record<string, number>;
  };
  supplemental_roads?: {
    available_records: Record<string, number>;
    official_speed_segments?: number;
    official_speed_directions?: number;
    bicycle_infrastructure_segments?: number;
    parking_segments?: number;
    matched_distance_km: Record<string, number>;
  };
  nsw_speed_zones?: {
    source_audit: {
      source_features: number;
      accepted_records: number;
      rejected: Record<string, number>;
    };
    status_counts: Record<string, number>;
    reason_counts: Record<string, number>;
    matched_distance_km: number;
  };
  surface?: {
    counts: Record<string, number>;
    distance_km: Record<string, number>;
  };
  mtb?: {
    route_relations: number;
    route_member_ways: number;
    counts: Record<string, number>;
    distance_km: Record<string, number>;
  };
  trails?: {
    bicycle_route_relations: number;
    bicycle_route_member_ways: number;
    hiking_route_relations: number;
    hiking_route_member_ways: number;
    counts: Record<string, number>;
    distance_km: Record<string, number>;
  };
}

type FeatureProperties = Record<string, string | number | boolean | null | undefined>;
type Coordinate = [number, number];

interface LtsRouteSummary {
  distance_m: number;
  time_ms: number;
  distance_by_lts_m: Record<string, number>;
  percentage_by_lts: Record<string, number>;
  highest_lts: number;
  known_unsealed_distance_m: number;
  mtb_caution_distance_m: number;
  technical_mtb_distance_m: number;
  unverified_trail_distance_m: number;
  hiking_only_distance_m: number;
}

interface LtsRouteResponse {
  classifier_version: string;
  route: GeoJSON.LineString;
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  summary: LtsRouteSummary;
  error?: string;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function routePointsGeoJson(points: Coordinate[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((coordinate, index) => ({
      type: 'Feature',
      properties: { role: index === 0 ? 'start' : 'finish', label: index === 0 ? 'A' : 'B' },
      geometry: { type: 'Point', coordinates: coordinate },
    })),
  };
}

function formatRouteDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

function formatRouteTime(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function loadPmTilesPlugin(): Promise<MapboxPmTilesGlobal | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  (window as unknown as { mapboxgl?: typeof mapboxgl }).mapboxgl = mapboxgl;
  const existing = (window as unknown as { mapboxPmTiles?: MapboxPmTilesGlobal }).mapboxPmTiles;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const prior = document.querySelector(`script[src="${PMTILES_SCRIPT_URL}"]`);
    if (prior) {
      prior.addEventListener('load', () => resolve(
        (window as unknown as { mapboxPmTiles?: MapboxPmTilesGlobal }).mapboxPmTiles || null,
      ));
      prior.addEventListener('error', () => resolve(null));
      return;
    }
    const script = document.createElement('script');
    script.src = PMTILES_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(
      (window as unknown as { mapboxPmTiles?: MapboxPmTilesGlobal }).mapboxPmTiles || null,
    );
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

function simplifyBaseMap(map: mapboxgl.Map) {
  for (const layer of map.getStyle()?.layers || []) {
    try {
      if (layer.type === 'line' && /road|street|motorway|trunk|primary|secondary|tertiary/.test(layer.id)) {
        map.setPaintProperty(layer.id, 'line-opacity', 0.22);
      }
      if (layer.type === 'symbol' && /road-number|shield|route-label/.test(layer.id)) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    } catch {
      // Base styles differ slightly between Mapbox releases.
    }
  }
}

function selectedGeoJson(feature?: MapboxGeoJSONFeature): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: feature ? [{
      type: 'Feature',
      properties: {},
      geometry: feature.geometry,
    } as GeoJSON.Feature] : [],
  };
}

function osmUrl(properties: FeatureProperties): string | null {
  const raw = String(properties.osm_id || '');
  const match = raw.match(/^([wnr])(\d+)$/);
  if (!match) return null;
  const type = match[1] === 'w' ? 'way' : match[1] === 'n' ? 'node' : 'relation';
  return `https://www.openstreetmap.org/${type}/${match[2]}`;
}

function propertyIsTrue(value: FeatureProperties[string]): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function trafficFreshness(value: FeatureProperties[string]): { label: string; className: string } | null {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900) return null;
  const age = Math.max(0, new Date().getFullYear() - year);
  if (age <= 2) return { label: 'Recent count', className: 'border-emerald-300/30 bg-emerald-300/15 text-emerald-200' };
  if (age <= 5) return { label: `${age} years old`, className: 'border-amber-300/30 bg-amber-300/15 text-amber-200' };
  return { label: `Historical · ${age} years old`, className: 'border-rose-300/30 bg-rose-300/15 text-rose-200' };
}

export default function LtsLabPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const routeModeRef = useRef(false);
  const routePointsRef = useRef<Coordinate[]>([]);
  const routeClickRef = useRef<(coordinate: Coordinate) => void>(() => undefined);
  const routeRequestIdRef = useRef(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<LtsMetadata | null>(null);
  const [selected, setSelected] = useState<FeatureProperties | null>(null);
  const [visibleLts, setVisibleLts] = useState<Set<number>>(new Set([1, 2, 3, 4]));
  const [showCrossings, setShowCrossings] = useState(true);
  const [showLowConfidence, setShowLowConfidence] = useState(true);
  const [showMtbTrails, setShowMtbTrails] = useState(true);
  const [showUnverifiedTrails, setShowUnverifiedTrails] = useState(true);
  const [allowGravel, setAllowGravel] = useState(true);
  const [routeMode, setRouteMode] = useState(false);
  const [routePoints, setRoutePoints] = useState<Coordinate[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeSummary, setRouteSummary] = useState<LtsRouteSummary | null>(null);
  const [routeClassifier, setRouteClassifier] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [datasetKey, setDatasetKey] = useState<DatasetKey>('victoria');
  const activeDataset = DATASETS[datasetKey];

  const setRoutePointSource = (points: Coordinate[]) => {
    const source = mapRef.current?.getSource('lts-route-points') as mapboxgl.GeoJSONSource | undefined;
    source?.setData(routePointsGeoJson(points));
  };

  const clearRoute = (keepPoints: Coordinate[] = []) => {
    routeRequestIdRef.current += 1;
    routePointsRef.current = keepPoints;
    setRoutePoints(keepPoints);
    setRouteSummary(null);
    setRouteClassifier(null);
    setRouteError(null);
    setRouteLoading(false);
    setRoutePointSource(keepPoints);
    const source = mapRef.current?.getSource('lts-route') as mapboxgl.GeoJSONSource | undefined;
    source?.setData(emptyFeatureCollection());
  };

  const requestRoute = async (points: Coordinate[], gravelAllowed = allowGravel) => {
    const requestId = ++routeRequestIdRef.current;
    setRouteLoading(true);
    setRouteError(null);
    setRouteSummary(null);
    try {
      const response = await fetch('/api/lts-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points, allow_gravel: gravelAllowed }),
      });
      const result = await response.json() as LtsRouteResponse;
      if (!response.ok || result.error) throw new Error(result.error || `Router returned ${response.status}`);
      if (requestId !== routeRequestIdRef.current) return;

      const source = mapRef.current?.getSource('lts-route') as mapboxgl.GeoJSONSource | undefined;
      source?.setData(result.segments);
      setRouteSummary(result.summary);
      setRouteClassifier(result.classifier_version);

      if (result.route.coordinates.length > 1 && mapRef.current) {
        const bounds = result.route.coordinates.reduce(
          (value, coordinate) => value.extend(coordinate as Coordinate),
          new mapboxgl.LngLatBounds(result.route.coordinates[0] as Coordinate, result.route.coordinates[0] as Coordinate),
        );
        mapRef.current.fitBounds(bounds, { padding: { top: 100, right: 80, bottom: 80, left: 360 }, maxZoom: 15 });
      }
    } catch (error) {
      if (requestId !== routeRequestIdRef.current) return;
      setRouteError(error instanceof Error ? error.message : 'The LTS route could not be calculated.');
    } finally {
      if (requestId === routeRequestIdRef.current) setRouteLoading(false);
    }
  };

  useEffect(() => {
    routeModeRef.current = routeMode;
    routeClickRef.current = (coordinate: Coordinate) => {
      const current = routePointsRef.current;
      const next = current.length === 1 ? [current[0], coordinate] : [coordinate];
      clearRoute(next);
      if (next.length === 2) void requestRoute(next);
    };
  });

  useEffect(() => {
    fetch(activeDataset.metadataUrl, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Metadata returned ${response.status}`);
        return response.json();
      })
      .then(setMetadata)
      .catch((error) => setMapError(`LTS metadata is unavailable: ${error.message}`));
  }, [activeDataset.metadataUrl]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;

    loadPmTilesPlugin().then((plugin) => {
      if (cancelled || !mapContainerRef.current) return;
      if (!plugin) {
        setMapError('The PMTiles map reader failed to load.');
        return;
      }

      try {
        (mapboxgl as unknown as { Style: { setSourceType: (name: string, ctor: unknown) => void } })
          .Style.setSourceType(plugin.SOURCE_TYPE, plugin.PmTilesSource);
      } catch {
        // The source type can already be registered after hot reload.
      }

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: activeDataset.center,
        zoom: activeDataset.zoom,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      map.on('error', (event) => {
        const message = event.error?.message || '';
        if (message.includes(activeDataset.dataUrl) || message.includes('pmtile')) {
          setMapError(`The LTS tile archive could not be loaded: ${message}`);
        }
      });

      map.on('load', () => {
        simplifyBaseMap(map);
        map.addSource('lts-network', {
          type: 'pmtile-source',
          url: activeDataset.dataUrl,
        } as unknown as mapboxgl.SourceSpecification);
        map.addSource('lts-selected', { type: 'geojson', data: selectedGeoJson() });
        map.addSource('lts-route', { type: 'geojson', data: emptyFeatureCollection() });
        map.addSource('lts-route-points', { type: 'geojson', data: routePointsGeoJson(routePointsRef.current) });

        const colourExpression: mapboxgl.Expression = [
          'match', ['get', 'lts'],
          1, LTS_COLOURS[1],
          2, LTS_COLOURS[2],
          3, LTS_COLOURS[3],
          4, LTS_COLOURS[4],
          '#6b7280',
        ];

        map.addLayer({
          id: 'lts-segments',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['all', ['==', ['get', 'feature_kind'], 'segment'], ['!=', ['get', 'is_unsealed'], true], ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]], ['!=', ['get', 'confidence'], 'low']],
          minzoom: 7,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': colourExpression,
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 12, 1.5, 15, 3.5, 18, 7],
            'line-opacity': 0.92,
          },
        });
        map.addLayer({
          id: 'lts-segments-low-confidence',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['all', ['==', ['get', 'feature_kind'], 'segment'], ['!=', ['get', 'is_unsealed'], true], ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]], ['==', ['get', 'confidence'], 'low']],
          minzoom: 8,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': colourExpression,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.8, 16, 4],
            'line-opacity': 0.7,
            'line-dasharray': [2, 1.5],
          },
        });
        map.addLayer({
          id: 'lts-unsealed-casing',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['all', ['==', ['get', 'feature_kind'], 'segment'], ['==', ['get', 'is_unsealed'], true], ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]]],
          minzoom: 7,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.8, 12, 3.5, 15, 7, 18, 12],
            'line-opacity': 0.92,
          },
        });
        map.addLayer({
          id: 'lts-unsealed',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['all', ['==', ['get', 'feature_kind'], 'segment'], ['==', ['get', 'is_unsealed'], true], ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]]],
          minzoom: 7,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': colourExpression,
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 1.7, 15, 3.8, 18, 7],
            'line-opacity': ['case', ['==', ['get', 'confidence'], 'low'], 0.65, 0.95],
            'line-dasharray': [2, 1.5],
          },
        });
        map.addLayer({
          id: 'lts-mtb-trails',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['==', ['get', 'is_mtb'], true],
          minzoom: 9,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': '#a855f7',
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.3, 12, 2.7, 15, 5.2, 18, 9],
            'line-opacity': 0.9,
            'line-dasharray': [2, 1.5],
          },
        });
        map.addLayer({
          id: 'lts-unverified-trails',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]],
          minzoom: 11,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': '#22d3ee',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 14, 4.2, 18, 9],
            'line-opacity': 0.92,
            'line-dasharray': [2, 1.5],
          },
        });
        map.addLayer({
          id: 'lts-crossings',
          type: 'circle',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['==', ['get', 'feature_kind'], 'crossing'],
          minzoom: 14,
          paint: {
            'circle-color': colourExpression,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 5.5],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
            'circle-opacity': 0.95,
          },
        });
        map.addLayer({
          id: 'lts-route-casing',
          type: 'line',
          source: 'lts-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 10, 18, 16],
            'line-opacity': 0.94,
          },
        });
        map.addLayer({
          id: 'lts-route-line',
          type: 'line',
          source: 'lts-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': colourExpression,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 11],
            'line-opacity': 1,
          },
        });
        map.addLayer({
          id: 'lts-route-point-circles',
          type: 'circle',
          source: 'lts-route-points',
          paint: {
            'circle-color': ['match', ['get', 'role'], 'start', '#16a34a', '#dc2626'],
            'circle-radius': 12,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          },
        });
        map.addLayer({
          id: 'lts-route-point-labels',
          type: 'symbol',
          source: 'lts-route-points',
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 12,
            'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          },
          paint: { 'text-color': '#ffffff' },
        });
        map.addLayer({
          id: 'lts-selected-line',
          type: 'line',
          source: 'lts-selected',
          paint: { 'line-color': '#111827', 'line-width': 8, 'line-opacity': 0.85 },
        });
        map.addLayer({
          id: 'lts-selected-point',
          type: 'circle',
          source: 'lts-selected',
          paint: { 'circle-color': '#111827', 'circle-radius': 9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        });

        const interactiveLayers = ['lts-crossings', 'lts-unverified-trails', 'lts-mtb-trails', 'lts-unsealed', 'lts-segments-low-confidence', 'lts-segments'];
        map.on('mousemove', (event) => {
          map.getCanvas().style.cursor = routeModeRef.current || map.queryRenderedFeatures(event.point, { layers: interactiveLayers }).length
            ? 'pointer'
            : '';
        });
        map.on('click', (event: MapMouseEvent) => {
          if (routeModeRef.current) {
            routeClickRef.current([event.lngLat.lng, event.lngLat.lat]);
            return;
          }
          const feature = map.queryRenderedFeatures(event.point, { layers: interactiveLayers })[0];
          setSelected(feature ? feature.properties as FeatureProperties : null);
          (map.getSource('lts-selected') as mapboxgl.GeoJSONSource)
            .setData(selectedGeoJson(feature));
        });
      });
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [activeDataset.center, activeDataset.dataUrl, activeDataset.zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('lts-segments')) return;
    const levels = [...visibleLts];
    const baseFilter: mapboxgl.FilterSpecification = [
      'all',
      ['==', ['get', 'feature_kind'], 'segment'],
      ['in', ['get', 'lts'], ['literal', levels]],
    ];
    map.setFilter('lts-segments-low-confidence', [
      ...baseFilter,
      ['!=', ['get', 'is_unsealed'], true],
      ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]],
      ['==', ['get', 'confidence'], 'low'],
    ] as mapboxgl.FilterSpecification);
    map.setFilter('lts-segments', [
      ...baseFilter,
      ['!=', ['get', 'is_unsealed'], true],
      ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]],
      ['!=', ['get', 'confidence'], 'low'],
    ] as mapboxgl.FilterSpecification);
    const unsealedFilter: mapboxgl.FilterSpecification = [
      ...baseFilter,
      ['==', ['get', 'is_unsealed'], true],
      ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]],
      ...(showLowConfidence ? [] : [['!=', ['get', 'confidence'], 'low']]),
    ] as mapboxgl.FilterSpecification;
    map.setFilter('lts-unsealed-casing', unsealedFilter);
    map.setFilter('lts-unsealed', unsealedFilter);
    map.setLayoutProperty('lts-segments-low-confidence', 'visibility', showLowConfidence ? 'visible' : 'none');
    map.setFilter('lts-crossings', [
      'all',
      ['==', ['get', 'feature_kind'], 'crossing'],
      ['in', ['get', 'lts'], ['literal', levels]],
    ]);
    map.setLayoutProperty('lts-crossings', 'visibility', showCrossings ? 'visible' : 'none');
    map.setLayoutProperty('lts-mtb-trails', 'visibility', showMtbTrails ? 'visible' : 'none');
    map.setLayoutProperty('lts-unverified-trails', 'visibility', showUnverifiedTrails ? 'visible' : 'none');
  }, [showCrossings, showLowConfidence, showMtbTrails, showUnverifiedTrails, visibleLts]);

  useEffect(() => {
    if (!showAbout) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAbout(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showAbout]);

  const selectedLts = selected ? Number(selected.lts) : null;
  const selectedOsmUrl = selected ? osmUrl(selected) : null;
  const selectedTrafficFreshness = selected ? trafficFreshness(selected.traffic_year) : null;

  return (
    <main className="relative h-screen overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

      <header className="absolute left-3 right-3 top-3 z-10 flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur md:left-4 md:right-auto md:min-w-[440px]">
        <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400"><Bike className="h-5 w-5" /></div>
        <div>
          <h1 className="font-bold">{activeDataset.title}</h1>
          <p className="text-xs text-slate-400">{activeDataset.routable ? 'Experimental low-stress map and routing' : 'Experimental statewide diagnostic map'}</p>
        </div>
        <select
          value={datasetKey}
          onChange={(event) => {
            setMetadata(null);
            setMapError(null);
            setDatasetKey(event.target.value as DatasetKey);
            setRouteMode(false);
            clearRoute();
            setSelected(null);
          }}
          aria-label="LTS dataset"
          className="ml-auto rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-100"
        >
          {Object.entries(DATASETS).map(([key, dataset]) => <option key={key} value={key}>{dataset.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setShowAbout(true)}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
        >
          <Info className="h-4 w-4" />
          <span className="hidden sm:inline">About</span>
        </button>
      </header>

      <aside className="absolute bottom-3 left-3 z-10 max-h-[calc(100vh-7rem)] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur md:bottom-auto md:left-4 md:top-24 md:w-80">
        {activeDataset.routable ? <button
          type="button"
          onClick={() => {
            const next = !routeMode;
            setRouteMode(next);
            setSelected(null);
            (mapRef.current?.getSource('lts-selected') as mapboxgl.GeoJSONSource | undefined)?.setData(selectedGeoJson());
            clearRoute();
          }}
          className={`mb-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${routeMode ? 'bg-emerald-400 text-slate-950' : 'bg-white text-slate-950 hover:bg-emerald-100'}`}
        >
          <RouteIcon className="h-4 w-4" />
          {routeMode ? 'LTS routing active' : 'Plan a low-stress route'}
        </button> : (
          <div className="mb-4 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2.5 text-xs leading-relaxed text-sky-100">
            NSW is map-only while its routing graph is audited. Victoria includes experimental LTS routing.
          </div>
        )}

        {routeMode && (
          <section className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-300">
                  {routePoints.length === 0 && 'Click your starting point'}
                  {routePoints.length === 1 && 'Now click your destination'}
                  {routePoints.length === 2 && !routeLoading && !routeError && 'Low-stress route calculated'}
                  {routeLoading && 'Finding the lowest-stress route…'}
                  {routeError && 'Route failed'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Higher-stress roads remain available only where needed to keep the journey connected.
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-amber-300/80">
                  {USING_LOCAL_ENRICHED_ROUTER
                    ? 'This local test router is using the shared directional road scores, traffic counts and crossing stress now; production routing is unchanged.'
                    : 'Traffic counts refine the background map; BRouter will use them after its enriched segment switch.'}
                </p>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-200">
                  <input
                    type="checkbox"
                    checked={allowGravel}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setAllowGravel(next);
                      if (routePointsRef.current.length === 2) void requestRoute(routePointsRef.current, next);
                    }}
                    className="h-4 w-4"
                  />
                  Gravel / known unsealed surfaces
                </label>
              </div>
              {(routePoints.length > 0 || routeSummary) && (
                <button
                  type="button"
                  onClick={() => clearRoute()}
                  className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"
                  aria-label="Reset route"
                ><RotateCcw className="h-4 w-4" /></button>
              )}
            </div>

            {routeLoading && <div className="mt-3 h-1 overflow-hidden rounded bg-white/10"><div className="h-full w-1/2 animate-pulse rounded bg-emerald-400" /></div>}
            {routeError && <p className="mt-3 rounded-lg bg-red-500/15 p-2 text-xs text-red-300">{routeError}</p>}

            {routeSummary && (
              <div className="mt-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-lg font-bold">{formatRouteDistance(routeSummary.distance_m)}</span>
                  <span className="text-sm text-slate-300">{formatRouteTime(routeSummary.time_ms)}</span>
                  {routeClassifier && <span className="ml-auto text-[9px] text-slate-500">{routeClassifier}</span>}
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10">
                  {[1, 2, 3, 4].map((level) => (
                    <span
                      key={level}
                      style={{
                        width: `${routeSummary.percentage_by_lts[String(level)] || 0}%`,
                        backgroundColor: LTS_COLOURS[level],
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px] text-slate-400">
                  {[1, 2, 3, 4].map((level) => (
                    <div key={level}>
                      <span className="font-semibold" style={{ color: LTS_COLOURS[level] }}>L{level}</span>
                      <br />{routeSummary.percentage_by_lts[String(level)] || 0}%
                    </div>
                  ))}
                </div>
                {routeSummary.known_unsealed_distance_m > 0 && (
                  <p className="mt-3 rounded-lg bg-white/10 px-2.5 py-2 text-xs text-slate-200">
                    Known unsealed: <strong>{formatRouteDistance(routeSummary.known_unsealed_distance_m)}</strong>
                  </p>
                )}
                {routeSummary.mtb_caution_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-purple-400/25 bg-purple-400/10 px-2.5 py-2 text-xs text-purple-100">
                    Includes {formatRouteDistance(routeSummary.mtb_caution_distance_m)} carrying easy or unspecified MTB evidence. This terrain may not suit a commuter bike.
                  </p>
                )}
                {routeSummary.technical_mtb_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-2 text-xs text-red-100">
                    Warning: {formatRouteDistance(routeSummary.technical_mtb_distance_m)} is explicitly technical MTB terrain.
                  </p>
                )}
                {routeSummary.unverified_trail_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-stone-400/25 bg-stone-400/10 px-2.5 py-2 text-xs text-stone-100">
                    Includes {formatRouteDistance(routeSummary.unverified_trail_distance_m)} of path/track without explicit cycling evidence. Check local signs and conditions.
                  </p>
                )}
                {routeSummary.hiking_only_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-2 text-xs text-red-100">
                    Warning: {formatRouteDistance(routeSummary.hiking_only_distance_m)} carries hiking-difficulty evidence without cycling evidence.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Stress levels</h2>
            <p className="text-xs text-slate-400">{routeMode ? 'The background network remains inspectable after routing.' : 'Click a road or crossing to inspect the rule.'}</p>
          </div>
          {metadata && <span className="rounded bg-white/10 px-2 py-1 text-[10px] text-slate-300">{metadata.classifier_version}</span>}
        </div>
        <div className="space-y-1.5">
          {[1, 2, 3, 4].map((level) => (
            <label key={level} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <input
                type="checkbox"
                checked={visibleLts.has(level)}
                onChange={() => setVisibleLts((previous) => {
                  const next = new Set(previous);
                  if (next.has(level)) next.delete(level); else next.add(level);
                  return next;
                })}
                className="h-4 w-4"
              />
              <span className="h-1.5 w-8 rounded-full" style={{ background: LTS_COLOURS[level] }} />
              <span className="flex-1 text-sm">LTS {level} · {LTS_LABELS[level]}</span>
              {metadata && <span className="text-xs text-slate-500">{metadata.segment_distance_km[String(level)].toLocaleString()} km</span>}
            </label>
          ))}
        </div>
        <div className="my-3 h-px bg-white/10" />
        <label className="flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showCrossings} onChange={(event) => setShowCrossings(event.target.checked)} className="h-4 w-4" />
          <MapPin className="h-4 w-4 text-slate-400" /> Crossings (zoom 14+)
        </label>
        <label className="flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showLowConfidence} onChange={(event) => setShowLowConfidence(event.target.checked)} className="h-4 w-4" />
          <span className="w-4 border-t-2 border-dashed border-slate-400" /> Inferred / low-confidence roads
        </label>
        <div className="grid grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm text-slate-200">
          <span className="h-4 w-4" aria-hidden="true" />
          <span className="relative h-3 w-8 rounded bg-white"><span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-blue-500" /></span>
          <span>Known unsealed (LTS-coloured dashes)</span>
        </div>
        <label className="grid cursor-pointer grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showMtbTrails} onChange={(event) => setShowMtbTrails(event.target.checked)} className="h-4 w-4" />
          <span className="w-8 border-t-[3px] border-dashed border-purple-500" />
          <span>OSM-tagged MTB trail</span>
        </label>
        <label className="grid cursor-pointer grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showUnverifiedTrails} onChange={(event) => setShowUnverifiedTrails(event.target.checked)} className="h-4 w-4" />
          <span className="w-8 border-t-[3px] border-dashed border-cyan-400" />
          <span>Cycling suitability not confirmed</span>
        </label>
        {metadata && (
          <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
            <p>{metadata.segments.toLocaleString()} segments · {metadata.crossings.toLocaleString()} crossings · OSM snapshot {new Date(metadata.source_pbf_modified_at).toLocaleDateString('en-AU')}</p>
            {metadata.traffic_volume && (
              <p className="mt-1 text-sky-300/75">
                Traffic volume matched to {metadata.traffic_volume.matched_segments.toLocaleString()} segments ({metadata.traffic_volume.matched_distance_km.toLocaleString()} km) · {metadata.traffic_volume.uplifted_segments.toLocaleString()} raised
              </p>
            )}
          </div>
        )}
        {mapError && <p className="mt-3 rounded-lg bg-red-500/15 p-2 text-xs text-red-300">{mapError}</p>}
      </aside>

      {!routeMode && selected && (selectedLts || propertyIsTrue(selected.is_mtb)) && (
        <aside className="absolute bottom-3 right-3 top-auto z-20 max-h-[70vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl backdrop-blur md:bottom-auto md:right-4 md:top-4 md:w-96">
          <button
            onClick={() => {
              setSelected(null);
              const source = mapRef.current?.getSource('lts-selected') as mapboxgl.GeoJSONSource | undefined;
              source?.setData(selectedGeoJson());
            }}
            className="absolute right-3 top-3 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close details"
          ><X className="h-5 w-5" /></button>
          <div className="mb-4 flex items-center gap-3 pr-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-black text-white" style={{ background: selectedLts ? LTS_COLOURS[selectedLts] : '#a855f7' }}>{selectedLts ? `L${selectedLts}` : 'MTB'}</span>
            <div>
              <h2 className="font-bold">{String(selected.name || (selected.feature_kind === 'crossing' ? 'Crossing' : 'Unnamed road/path'))}</h2>
              <p className="text-sm" style={{ color: selectedLts ? LTS_COLOURS[selectedLts] : '#c084fc' }}>{selectedLts ? LTS_LABELS[selectedLts] : 'MTB trail shown for context'}</p>
            </div>
          </div>
          <div className="rounded-lg bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why this score</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-200">{String(selected.reason || 'No explanation available')}</p>
          </div>
          {selected.traffic_aadt && (
            <div className="mt-3 rounded-lg border border-sky-400/20 bg-sky-400/10 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto text-xs font-semibold uppercase tracking-wide text-sky-300">Motor traffic evidence</p>
                {selected.traffic_year && <span className="rounded-full border border-sky-300/30 bg-sky-300/15 px-2 py-0.5 text-[10px] font-bold text-sky-100">{String(selected.traffic_year)} count</span>}
                {selectedTrafficFreshness && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${selectedTrafficFreshness.className}`}>{selectedTrafficFreshness.label}</span>}
              </div>
              <p className="mt-1 text-sm font-semibold text-white">Approximately {Number(selected.traffic_aadt).toLocaleString()} vehicles/day</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                {String(selected.traffic_period || selected.traffic_year)} {String(selected.traffic_source || 'DTP historical AADT')} · {String(selected.traffic_methodology).toLowerCase()}
                {selected.traffic_heavy_pct !== undefined && selected.traffic_heavy_pct !== null ? ` · ${Number(selected.traffic_heavy_pct).toFixed(1)}% heavy vehicles` : ''}
                {selected.traffic_match_confidence ? ` · ${String(selected.traffic_match_confidence)} match confidence` : ''}
              </p>
              {Boolean(selected.traffic_raised_lts) && <p className="mt-1 text-xs font-semibold text-amber-300">Traffic volume raised this road’s stress score.</p>}
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-slate-500">Feature</dt><dd className="mt-0.5 capitalize">{String(selected.feature_kind)}</dd></div>
            <div><dt className="text-xs text-slate-500">Confidence</dt><dd className="mt-0.5 capitalize">{String(selected.confidence)}</dd></div>
            {selected.highway && <div><dt className="text-xs text-slate-500">OSM highway</dt><dd className="mt-0.5">{String(selected.highway)}</dd></div>}
            {selected.surface && <div><dt className="text-xs text-slate-500">Surface</dt><dd className="mt-0.5 capitalize">{String(selected.surface).replaceAll('_', ' ')}</dd></div>}
            {selected.surface_class && <div><dt className="text-xs text-slate-500">Surface evidence</dt><dd className="mt-0.5 capitalize">{String(selected.surface_class)}</dd></div>}
            {propertyIsTrue(selected.is_mtb) && <div><dt className="text-xs text-slate-500">MTB routing</dt><dd className="mt-0.5 capitalize">{String(selected.mtb_routing).replaceAll('_', ' ')}</dd></div>}
            {selected.mtb_scale && <div><dt className="text-xs text-slate-500">MTB scale</dt><dd className="mt-0.5">{String(selected.mtb_scale)}</dd></div>}
            {selected.mtb_scale_imba && <div><dt className="text-xs text-slate-500">IMBA scale</dt><dd className="mt-0.5">{String(selected.mtb_scale_imba)}</dd></div>}
            {selected.mtb_type && <div><dt className="text-xs text-slate-500">MTB type</dt><dd className="mt-0.5 capitalize">{String(selected.mtb_type)}</dd></div>}
            {selected.trail_routing && selected.trail_routing !== 'normal' && <div><dt className="text-xs text-slate-500">Trail routing</dt><dd className="mt-0.5 capitalize">{String(selected.trail_routing)}</dd></div>}
            {propertyIsTrue(selected.is_bicycle_route) && <div><dt className="text-xs text-slate-500">Bicycle route</dt><dd className="mt-0.5">OSM relation member</dd></div>}
            {propertyIsTrue(selected.is_hiking_route) && <div><dt className="text-xs text-slate-500">Walking route</dt><dd className="mt-0.5">OSM hiking/foot relation member</dd></div>}
            {selected.maxspeed && <div><dt className="text-xs text-slate-500">Speed used</dt><dd className="mt-0.5">{String(selected.maxspeed)} km/h{selected.speed_inferred ? ' (inferred)' : ''}</dd></div>}
            {selected.lanes_each_direction && <div><dt className="text-xs text-slate-500">Lanes/direction</dt><dd className="mt-0.5">{String(selected.lanes_each_direction)}{selected.lanes_inferred ? ' (inferred)' : ''}</dd></div>}
            {selected.bike_infra_forward && <div><dt className="text-xs text-slate-500">Forward facility</dt><dd className="mt-0.5">{String(selected.bike_infra_forward).replaceAll('_', ' ')}</dd></div>}
            {selected.lts_backward && <div><dt className="text-xs text-slate-500">Directional LTS</dt><dd className="mt-0.5">Forward {String(selected.lts_forward)} · Back {String(selected.lts_backward)}</dd></div>}
            {selected.distance_km && <div><dt className="text-xs text-slate-500">Segment length</dt><dd className="mt-0.5">{(Number(selected.distance_km) * 1000).toFixed(0)} m</dd></div>}
            {selected.traffic_directional_aadt && <div><dt className="text-xs text-slate-500">Measured direction</dt><dd className="mt-0.5">{Number(selected.traffic_directional_aadt).toLocaleString()}/day</dd></div>}
            {selected.traffic_volume_basis === 'two_way' && selected.traffic_source_aadt && <div><dt className="text-xs text-slate-500">Source road total</dt><dd className="mt-0.5">{Number(selected.traffic_source_aadt).toLocaleString()}/day (two-way)</dd></div>}
            {selected.traffic_source_road && <div><dt className="text-xs text-slate-500">Traffic road match</dt><dd className="mt-0.5">{String(selected.traffic_source_road)}</dd></div>}
            {selected.speed_source && <div><dt className="text-xs text-slate-500">Speed source</dt><dd className="mt-0.5">{String(selected.speed_source)}{selected.speed_period ? ` · ${String(selected.speed_period)}` : ''}{selected.speed_zone_type ? ` · ${String(selected.speed_zone_type)}` : ''}</dd></div>}
            {selected.speed_match_max_offset_m !== undefined && <div><dt className="text-xs text-slate-500">Speed match</dt><dd className="mt-0.5">{Number(selected.speed_match_max_offset_m).toFixed(1)} m max offset · {String(selected.speed_match_confidence)} confidence</dd></div>}
            {selected.bicycle_infrastructure_source && <div><dt className="text-xs text-slate-500">Bike data source</dt><dd className="mt-0.5">{String(selected.bicycle_infrastructure_source)}</dd></div>}
            {selected.parking_source && <div><dt className="text-xs text-slate-500">Parking source</dt><dd className="mt-0.5">{String(selected.parking_source)}</dd></div>}
          </dl>
          {propertyIsTrue(selected.is_mtb) && selected.mtb_reason && (
            <p className="mt-4 rounded-lg border border-purple-400/20 bg-purple-400/10 p-3 text-xs leading-relaxed text-purple-100">{String(selected.mtb_reason)}</p>
          )}
          {selected.trail_routing && selected.trail_routing !== 'normal' && selected.trail_reason && (
            <p className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs leading-relaxed text-cyan-100">{String(selected.trail_reason)}</p>
          )}
          {selectedOsmUrl && <a href={selectedOsmUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-sm font-semibold text-sky-400 hover:text-sky-300">Inspect this feature in OpenStreetMap →</a>}
        </aside>
      )}

      {showAbout && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm md:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lts-about-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowAbout(false);
          }}
        >
          <section className="relative max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/10 bg-slate-950/95 px-5 py-4 backdrop-blur md:px-7">
              <div className="rounded-xl bg-emerald-400/15 p-2.5 text-emerald-300"><Info className="h-5 w-5" /></div>
              <div className="pr-10">
                <h2 id="lts-about-title" className="text-xl font-bold">About the {activeDataset.title}</h2>
                <p className="mt-1 text-sm text-slate-400">How the stress map and experimental router are built, what data they use, and what they cannot claim yet.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAbout(false)}
                className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Close about panel"
              ><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-8 px-5 py-6 text-sm leading-relaxed text-slate-300 md:px-7 md:py-7">
              <section>
                <h3 className="text-base font-bold text-white">What this map is</h3>
                <p className="mt-2">
                  This is an experimental Bicycle Level of Traffic Stress map. It classifies each rideable road or path from LTS 1 to LTS 4, aiming to describe how comfortable the link is likely to feel—not merely whether cycling is legally permitted.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {[1, 2, 3, 4].map((level) => (
                    <div key={level} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-black text-white" style={{ background: LTS_COLOURS[level] }}>L{level}</span>
                      <div><p className="font-semibold text-white">{LTS_LABELS[level]}</p><p className="text-xs text-slate-400">{level === 1 ? 'Traffic-free or child-suitable conditions' : level === 2 ? 'Generally tolerable to most adults' : level === 3 ? 'More confident riders and moderate interaction' : 'High-speed, high-volume or otherwise hostile conditions'}</p></div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-base font-bold text-white">Data being used</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">OpenStreetMap road network</p>
                    <p className="mt-1 text-xs text-slate-400">Road and path geometry, bicycle access, directional cycleways, separation, painted lanes, buffers, parking, speed limits, lane counts, explicit surfaces, MTB difficulty and route tags, one-way rules, roundabouts and crossings.</p>
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">OpenStreetMap attribution <ExternalLink className="h-3 w-3" /></a>
                  </div>
                  <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-4">
                    <p className="font-semibold text-white">{datasetKey === 'victoria' ? 'Victorian traffic-volume evidence' : 'NSW traffic-volume evidence'}</p>
                    <p className="mt-1 text-xs text-slate-300">{datasetKey === 'victoria' ? <>The historical directional AADT network is supplemented by 2026 TIRTL and telemetry sensor averages, SCATS signal-loop observations, City of Casey surveys, and City of Melbourne&apos;s 2014–17 classified counts. Fresh direct counts take precedence; the older Melbourne counts only fill gaps.</> : <>Published Transport for NSW all-day, all-vehicle station counts are matched conservatively by road identity, projected distance and travel direction. Every accepted count is pinned to one audited OSM way; ambiguous and rejected observations do not enter the map. Dates vary by station and remain visible when a road is inspected.</>}</p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                      {datasetKey === 'victoria' ? <>
                        <a href="https://discover.data.vic.gov.au/dataset/historical-annual-average-daily-traffic-volume" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">AADT <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://opendata.transport.vic.gov.au/dataset/tirtl-traffic-counts" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">TIRTL <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://discover.data.vic.gov.au/dataset/telemetry-traffic-counts-and-classification" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">Telemetry <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://opendata.transport.vic.gov.au/dataset/traffic-signal-volume-data" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">SCATS <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://discover.data.vic.gov.au/en_AU/dataset/traffic-volume-survey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">Casey surveys <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://discover.data.vic.gov.au/dataset/traffic-count-vehicle-classification-2014-2017" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">Melbourne counts <ExternalLink className="h-3 w-3" /></a>
                      </> : <a href="https://data.nsw.gov.au/data/en/dataset/2-nsw-roads-traffic-volume-counts-api" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">TfNSW traffic counts <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <p className="font-semibold text-white">Official road details</p>
                    <p className="mt-1 text-xs text-slate-300">{datasetKey === 'victoria' ? <>DTP normal-operation speed zones fill missing OSM speeds. DTP bicycle infrastructure fills missing directional lane, buffer and protection details. City of Melbourne parking zones fill otherwise unknown kerbside parking. Explicit OSM tags always win.</> : <>TfNSW fixed, all-day speed-zone lines fill only missing OSM speeds when the geometry strongly covers the same road. Conditional, school and variable zones are excluded; conflicting or one-way-ambiguous matches are quarantined. Explicit OSM speeds always win.</>}</p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                      {datasetKey === 'victoria' ? <>
                        <a href="https://discover.data.vic.gov.au/en_AU/dataset/speed-zones" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">Speed zones <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://opendata.transport.vic.gov.au/dataset/bicycle-infrastructure-network" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">Bike infrastructure <ExternalLink className="h-3 w-3" /></a>
                        <a href="https://discover.data.vic.gov.au/dataset/parking-zones-linked-to-street-segments" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">Parking zones <ExternalLink className="h-3 w-3" /></a>
                      </> : <a href="https://data.nsw.gov.au/data/en/dataset/2-speed-zones" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">TfNSW speed zones <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Map delivery</p>
                    <p className="mt-1 text-xs text-slate-400">The classified network is packaged with Tippecanoe into PMTiles and rendered over a simplified Mapbox base map. White-backed LTS-coloured dashes indicate an explicitly tagged unsealed surface. Purple dashes identify OSM-tagged MTB trails. Cyan dashes identify paths and tracks whose ordinary bicycle access or suitability is not confirmed; cyan takes visual precedence when both meanings apply. Off-road paths and tracks are already LTS 1 because traffic stress is separate from trail access and difficulty, so they do not repeat a green LTS foreground. Where an MTB relation follows an ordinary road, the road&apos;s normal LTS colour remains visible beneath the purple dashes.</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Experimental routing</p>
                    <p className="mt-1 text-xs text-slate-400">{USING_LOCAL_ENRICHED_ROUTER ? <>Routes in this local Lab come from a separate traffic-enriched BRouter test instance using <code className="text-emerald-300">cyalts</code>. The production router and existing iOS and Android profiles remain unchanged.</> : <>Routes come from the live BRouter service using the additive <code className="text-emerald-300">cyalts</code> profile. Existing iOS and Android profiles remain unchanged.</>}</p>
                    <a href="https://brouter.de/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">About BRouter <ExternalLink className="h-3 w-3" /></a>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-base font-bold text-white">How a road receives its score</h3>
                <div className="mt-3 space-y-2 text-slate-300">
                  <p>Each OSM way is assessed separately for the forward and backward cycling directions using Australian left-hand traffic. The map displays the more stressful permitted direction.</p>
                  <p>Direction matters because the two sides of a road can have different painted or protected cycle lanes, buffers, parking, lane counts and speed tags. For Australian left-hand traffic, the classifier selects the cycling treatment on the side used in each direction.</p>
                  <p>The background line deliberately shows the worse of the two permitted directions, while an active route shows the LTS for the direction being ridden. A route may therefore change a yellow background segment to blue when its side is safer, but the same shared classification should never change a blue background segment to yellow.</p>
                  <p>Traffic-free paths and physically protected facilities are normally LTS 1. Mixed streets, painted lanes, shoulders and roundabouts are assessed using their speed, road class, lane count, parking and cycling treatment. Missing speed and lane values are inferred conservatively and identified through the confidence field.</p>
                  <p>Traffic records are matched to OSM geometry using road name or route reference, projected distance, local direction and line overlap. Directional counts are doubled for a two-way OSM centreline to approximate conventional two-way daily traffic.</p>
                  {datasetKey === 'victoria' ? <>
                    <p>Direct TIRTL, telemetry and recent council observations outrank historical AADT. SCATS is useful where no better count matches, but its public export does not identify road approaches: the Lab conservatively estimates one direction from the intersection total, labels it low confidence, and permits it to raise a road by only one LTS level.</p>
                    <p>Where OSM is missing a speed, the classifier uses DTP&apos;s June 2026 normal-operation speed zone for that direction. School, shopping and other conditional limits are excluded because this all-day map cannot yet know when they apply. Official bicycle and parking layers similarly fill only missing details.</p>
                  </> : <>
                    <p>The NSW importer keeps the latest published all-day/all-vehicle observation for each exact station direction, but the latest available year varies substantially by station. Counts are never copied along a corridor: the audit accepts one OSM way or rejects the observation.</p>
                    <p>Where OSM is missing a speed, the classifier may use a strongly coincident TfNSW fixed all-day speed zone. Conditional and variable limits are excluded, explicit OSM speed tags are protected, and competing strong matches are left unresolved.</p>
                  </>}
                  <p>Surface, trail suitability and MTB evidence are separate from traffic stress. A road is called unsealed only when OSM has an explicit value such as gravel, dirt, ground or compacted; a missing surface is not guessed. Generic <code>path</code>, <code>track</code> and <code>bridleway</code> links need explicit bicycle access or bicycle-route evidence before they are treated as verified cycling links. Every explicit MTB tag or MTB route membership remains visible, even when routing rules exclude it.</p>
                </div>
                <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/10 text-slate-300"><tr><th className="px-3 py-2">Approximate daily motor traffic</th><th className="px-3 py-2">Mixed-traffic floor</th></tr></thead>
                    <tbody className="divide-y divide-white/10">
                      <tr><td className="px-3 py-2">Up to 2,000</td><td className="px-3 py-2 text-green-400">LTS 1</td></tr>
                      <tr><td className="px-3 py-2">2,001–6,000</td><td className="px-3 py-2 text-blue-400">LTS 2</td></tr>
                      <tr><td className="px-3 py-2">6,001–14,000</td><td className="px-3 py-2 text-amber-400">LTS 3</td></tr>
                      <tr><td className="px-3 py-2">Above 14,000</td><td className="px-3 py-2 text-red-400">LTS 4</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-slate-400">Traffic volume may only raise a mixed/shared/shoulder score. It never lowers an existing score and never penalises a separated path or protected lane.</p>
              </section>

              <section>
                <h3 className="text-base font-bold text-white">{activeDataset.routable ? 'How BRouter chooses a route' : 'Routing status'}</h3>
                {!activeDataset.routable && <p className="mt-2 rounded-xl border border-sky-400/20 bg-sky-400/10 p-4 text-sky-100">The statewide NSW map is map-only. Its visual classification, traffic matches and speed-zone matches are being audited before any NSW BRouter segment build. It cannot change production navigation.</p>}
                {activeDataset.routable && <>
                <p className="mt-2">The <code className="text-emerald-300">cyalts</code> profile assigns widely separated routing costs: 1.0 for LTS 1, 1.8 for LTS 2, 5.0 for LTS 3 and 15.0 for LTS 4. This strongly prefers low-stress links while allowing a higher-stress connection when otherwise necessary.</p>
                {USING_LOCAL_ENRICHED_ROUTER && <p className="mt-2">The local enriched segments carry the map classifier&apos;s forward and backward LTS values directly. BRouter uses the value for the travel direction; it does not independently reinterpret the road&apos;s lane or cycleway tags. The background line deliberately uses the worse direction, so a routed line can be safer—but not more stressful—when the lane or cycleway on the ridden side is better.</p>}
                {USING_LOCAL_ENRICHED_ROUTER && <p className="mt-2">Crossing dots are classified by the same rules and add point penalties equivalent to a 0 m, 20 m, 80 m or 250 m detour for LTS 1–4. This encourages the router to prefer signals, refuges and calmer crossings without making a difficult crossing an absolute barrier.</p>}
                {USING_LOCAL_ENRICHED_ROUTER && <p className="mt-2">The Gravel switch applies only to explicitly known unsealed surfaces. With Gravel off, those links receive a strong additional cost; unknown surfaces are not assumed unsealed. MTB trails with easy or unspecified difficulty remain connected but carry a strong commuter penalty. Trails tagged <code>mtb:scale=2</code> or higher, IMBA 2 or higher, downhill, freeride or trial are treated as clearly technical and excluded from commuter routing.</p>}
                {USING_LOCAL_ENRICHED_ROUTER && <p className="mt-2">A generic path, track or bridleway without explicit bicycle access or normal bicycle-route membership remains available only with an additional unverified-trail penalty. Hiking/foot route membership makes that warning more specific but does not prohibit cycling by itself. A <code>sac_scale</code> hiking-difficulty tag without positive cycling or MTB evidence is excluded from commuter routing.</p>}
                <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/10 p-4">
                  <h4 className="font-semibold text-white">Handling unavoidable high-stress gaps</h4>
                  <p className="mt-2 text-xs text-violet-50">The values 1.0, 1.8, 5.0 and 15.0 are deliberately separated experimental preference weights, not measured speeds, crash risks or final calibrated constants. Before other routing costs are considered, one kilometre at LTS 2, 3 or 4 therefore contributes roughly the same route cost as 1.8, 5 or 15 kilometres at LTS 1. The spacing makes the router mildly prefer LTS 1 over LTS 2, strongly avoid LTS 3 and treat LTS 4 as a last resort, while keeping every legal cycling connection available where the network has no practical alternative. These values still need comparison against routes chosen by riders.</p>
                  <p className="mt-2 text-xs text-violet-50">This model assumes the rider remains on the bicycle when a route uses a high-stress link. It does not silently switch to walking, change travel speed or instruct the rider to dismount. Afshin&apos;s “walking at three times slower” method represents a different behaviour: an uncomfortable but walkable gap is costed approximately like travelling three times its distance by bicycle because the rider is assumed to walk it. Our current LTS 4 weight is intentionally much stronger than that time penalty because it represents reluctance to ride the link, not the time required to walk it. A future hybrid model could offer dismounting as an explicit alternative, but it should not be implied by the present route.</p>
                </div>
                <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs text-amber-100">
                  {USING_LOCAL_ENRICHED_ROUTER
                    ? 'This local test uses separately built BRouter segments containing matched AADT classes, lane counts, parking, buffers, normalised cycleway tags, crossing scores and real elevation. Each directional road and crossing LTS value is precomputed by the same classifier that paints the map; ways excluded from the visible cycling network are also unavailable to the router. It has not been switched into production.'
                    : 'Traffic volume currently refines the background map only. The live BRouter segment files do not yet contain the matched AADT fields, parking, buffers, lane counts or every newer OSM cycleway tag. Those inputs will affect route selection after a separately built segment set is validated and switched in without disrupting the current service.'}
                </div>
                </>}
              </section>

              <section>
                <h3 className="text-base font-bold text-white">Current {activeDataset.label} coverage</h3>
                {metadata ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold text-white">{metadata.segments.toLocaleString()}</p><p className="text-xs text-slate-400">road/path segments</p></div>
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold text-white">{metadata.crossings.toLocaleString()}</p><p className="text-xs text-slate-400">crossing points</p></div>
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold text-white">{metadata.traffic_volume?.matched_segments.toLocaleString() || '—'}</p><p className="text-xs text-slate-400">traffic-matched segments</p></div>
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xl font-bold text-white">{metadata.traffic_volume?.uplifted_segments.toLocaleString() || '—'}</p><p className="text-xs text-slate-400">scores raised by volume</p></div>
                  </div>
                ) : <p className="mt-2 text-slate-400">Coverage metadata is loading.</p>}
                {metadata?.traffic_volume && (
                  <p className="mt-3 text-xs text-slate-400">
                    {metadata.traffic_volume.available_directional_records.toLocaleString()} traffic observations in this build · {metadata.traffic_volume.matched_distance_km.toLocaleString()} matched kilometres · {Object.entries(metadata.traffic_volume.source_counts || {}).map(([source, count]) => `${source.replace('DTP ', '')}: ${count.toLocaleString()}`).join(' · ')}
                  </p>
                )}
                {metadata?.nsw_speed_zones && (
                  <p className="mt-2 text-xs text-slate-400">
                    {(metadata.nsw_speed_zones.status_counts.matched || 0).toLocaleString()} segments received TfNSW speed evidence across {metadata.nsw_speed_zones.matched_distance_km.toLocaleString()} km · {(metadata.nsw_speed_zones.status_counts.ambiguous || 0).toLocaleString()} ambiguous matches quarantined
                  </p>
                )}
                {metadata?.supplemental_roads && (
                  <p className="mt-2 text-xs text-slate-400">
                    {(metadata.supplemental_roads.official_speed_segments || 0).toLocaleString()} segments received official speed evidence · {(metadata.supplemental_roads.bicycle_infrastructure_segments || 0).toLocaleString()} received missing bicycle-infrastructure details · {(metadata.supplemental_roads.parking_segments || 0).toLocaleString()} received parking evidence
                  </p>
                )}
                {metadata?.surface && metadata?.mtb && (
                  <p className="mt-2 text-xs text-slate-400">
                    {(metadata.surface.distance_km.unsealed || 0).toLocaleString()} known-unsealed kilometres · {((metadata.mtb.counts.shown_routable || 0) + (metadata.mtb.counts.shown_not_routable || 0)).toLocaleString()} MTB-tagged ways shown · {metadata.mtb.route_relations.toLocaleString()} MTB route relations
                  </p>
                )}
                {metadata?.trails && (
                  <p className="mt-2 text-xs text-slate-400">
                    {(metadata.trails.counts.routing_caution || 0).toLocaleString()} unverified paths/tracks remain connected with a penalty · {(metadata.trails.counts.routing_avoid || 0).toLocaleString()} hiking-difficulty ways excluded · {metadata.trails.bicycle_route_relations.toLocaleString()} bicycle route relations · {metadata.trails.hiking_route_relations.toLocaleString()} hiking/foot route relations
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-base font-bold text-white">Important limitations</h3>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
                  <li>This is a diagnostic model, not a guarantee that a road is safe or presently open.</li>
                  <li>{datasetKey === 'victoria' ? <>The historical AADT layer mainly covers Victoria&apos;s declared road network. Current sensors and council surveys improve coverage, but local-road traffic evidence remains much stronger in Melbourne and Casey than elsewhere in Victoria.</> : <>TfNSW traffic-count coverage is sparse and uneven. Many stations&apos; latest published all-day observation is historical; the observation year is retained and shown rather than presented as current traffic.</>}</li>
                  <li>Sensor, survey, historical and derived SCATS values are distinguished by source, period and confidence. Unmatched roads continue to use OSM-based inference.</li>
                  <li>Only normal-operation speed zones are used. Time-dependent school, shopping and variable limits are not applied until the router can evaluate their active times.</li>
                  {datasetKey === 'victoria' && <li>The DTP bicycle layer is itself OSM-linked and may lag recent edits; it fills missing fields but never overwrites an explicit current OSM value.</li>}
                  <li>Surface, trail and MTB styling reflects OSM tags, which can be incomplete or wrong. Unknown surface stays unknown; unverified trails receive a warning/penalty; visual context is not a claim that a trail is suitable, legal, open or safe.</li>
                  <li>{USING_LOCAL_ENRICHED_ROUTER ? 'Crossings influence the local test router through experimental point penalties; the values still need rider testing and calibration.' : 'Crossing dots are diagnostic in production until the enriched LTS segment service is switched in.'}</li>
                  <li>Temporary works, congestion at a particular time, driver behaviour, sight distance and pavement condition may not be represented.</li>
                </ul>
              </section>

              <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-4 text-xs text-slate-500">
                <span>Map classifier: {metadata?.classifier_version || 'loading'}</span>
                <span>Router classifier: {activeDataset.routable ? (USING_LOCAL_ENRICHED_ROUTER ? 'au-lts-v0.5-trail-suitability-test' : 'au-lts-brouter-v0.1') : 'not enabled for this pilot'}</span>
                {metadata?.source_pbf_modified_at && <span>OSM snapshot: {new Date(metadata.source_pbf_modified_at).toLocaleDateString('en-AU')}</span>}
                {metadata?.generated_at && <span>Built: {new Date(metadata.generated_at).toLocaleString('en-AU')}</span>}
              </footer>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
