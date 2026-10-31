'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { LngLatBounds, type GeoJSONSource, type Map, type MapMouseEvent } from 'maplibre-gl';
import { ArrowDownUp, Loader2, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { ltsAppPath } from '@/lib/client-path';
import { LTS_VOTE_COLOURS } from '@/lib/lts-voting';
import { routeHistoryReducer, initialRouteHistory, MAX_ROUTE_POINTS } from '@/lib/route-history';

type Coordinate = [number, number];
type RouteResult = {
  route: GeoJSON.LineString;
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  summary: {
    distance_m: number; time_ms: number; percentage_by_lts: Record<string, number>;
    known_unsealed_distance_m: number; mtb_caution_distance_m: number;
  };
  comparison?: { route: GeoJSON.LineString; summary: { distance_m: number; time_ms: number } } | null;
  comparison_error?: string;
};
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LAYERS = ['planner-waypoint-labels', 'planner-waypoints', 'planner-route', 'planner-route-casing', 'planner-comparison'];
const SOURCES = ['planner-points', 'planner-primary', 'planner-alternative'];
const distance = (metres: number) => metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
const duration = (milliseconds: number) => {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
};
function setData(map: Map | null, id: string, data: GeoJSON.GeoJSON) {
  if (map?.getStyle()) (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

export function RoutePlanner({ map, dataset, open, onClose }: {
  map: Map | null; dataset: string; open: boolean; onClose: () => void;
}) {
  const [history, dispatch] = useReducer(routeHistoryReducer, initialRouteHistory);
  const points = history.snapshots[history.index];
  const [allowGravel, setAllowGravel] = useState(true);
  const [showComparison, setShowComparison] = useState(true);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fitNextResult = useRef(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dispatch({ type: 'reset' });
    setResult(null);
    setError(null);
    if (!map?.getStyle()) return;
    for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'planner-comparison', type: 'line', source: 'planner-alternative',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#475569', 'line-width': 6, 'line-opacity': 0.6, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'planner-route-casing', type: 'line', source: 'planner-primary',
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
    map.addLayer({ id: 'planner-route', type: 'line', source: 'planner-primary',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-width': 5, 'line-color': ['match', ['to-string', ['get', 'lts']],
        '1', LTS_VOTE_COLOURS[1], '1.5', LTS_VOTE_COLOURS[1.5], '2', LTS_VOTE_COLOURS[2],
        '3', LTS_VOTE_COLOURS[3], '4', LTS_VOTE_COLOURS[4], '4.5', LTS_VOTE_COLOURS[4.5], '#5d696c'] } });
    map.addLayer({ id: 'planner-waypoints', type: 'circle', source: 'planner-points', paint: {
      'circle-radius': 13, 'circle-color': '#293c32', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3,
    } });
    map.addLayer({ id: 'planner-waypoint-labels', type: 'symbol', source: 'planner-points', layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-allow-overlap': true,
    }, paint: { 'text-color': '#fff' } });
    return () => {
      if (!map.getStyle()) return;
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, dataset]);

  useEffect(() => {
    if (!map || !open) return;
    const zoomEnabled = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    const addPoint = (event: MapMouseEvent) => {
      // A double-click's second click must not add an identical extra waypoint.
      if (event.originalEvent.detail > 1) return;
      fitNextResult.current = true;
      dispatch({ type: 'add', point: [event.lngLat.lng, event.lngLat.lat] });
    };
    map.on('click', addPoint);
    return () => {
      map.off('click', addPoint);
      if (map.getStyle()) {
        map.getCanvas().style.cursor = '';
        if (zoomEnabled) map.doubleClickZoom.enable();
      }
    };
  }, [map, open]);

  useEffect(() => {
    setData(map, 'planner-points', { type: 'FeatureCollection', features: points.map((point, index) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { label: String.fromCharCode(65 + index) },
    })) });
  }, [map, points]);

  useEffect(() => {
    const abort = new AbortController();
    setResult(null);
    setError(null);
    setLoading(false);
    setData(map, 'planner-primary', EMPTY);
    setData(map, 'planner-alternative', EMPTY);
    if (!map || points.length < 2) return;
    setLoading(true);
    // Debounce quick waypoint edits; cancelled responses cannot replace a newer route.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(ltsAppPath('/api/lts-route'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
          body: JSON.stringify({ points, dataset, allow_gravel: allowGravel }),
        });
        const data = await response.json();
        if (!response.ok || !data.route || !data.segments || !data.summary) throw new Error(data.error || 'Unable to plan this route. Try moving a waypoint closer to a road or path.');
        if (abort.signal.aborted) return;
        setResult(data);
        if (fitNextResult.current) {
          const coordinates = data.route.coordinates as Coordinate[];
          const bounds = coordinates.reduce((value, point) => value.extend(point), new LngLatBounds(coordinates[0], coordinates[0]));
          map.fitBounds(bounds, { padding: 45, maxZoom: 16, duration: 450 });
          fitNextResult.current = false;
        }
      } catch (caught) {
        if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to plan this route. Please try again.');
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [map, points, dataset, allowGravel]);

  useEffect(() => {
    setData(map, 'planner-primary', result?.segments ?? EMPTY);
    setData(map, 'planner-alternative', showComparison && result?.comparison ? {
      type: 'Feature', geometry: result.comparison.route, properties: {},
    } : EMPTY);
  }, [map, result, showComparison]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close route planner"]')?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return <aside ref={panelRef} className="lts-surface lts-tool-panel lts-panel-open lts-route-planner" aria-label="Route planner" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div className="lts-panel-heading"><h2>Plan a route</h2><button type="button" onClick={onClose} aria-label="Close route planner"><X size={20} /></button></div>
    <div className="lts-panel-body">
      <div className="lts-route-intro"><span className="lts-route-eyebrow">STRESS FREE</span><p>{points.length === 0 ? 'Click the map to choose your start, then your destination.' : points.length === 1 ? 'Now click the map to choose your destination.' : 'Click the map to add another stop. Close this panel to inspect roads.'}</p></div>
      <div className="lts-route-actions" aria-label="Edit route">
        <button type="button" disabled={history.index === 0} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo waypoint change" title="Undo"><Undo2 size={18} /><span>Undo</span></button>
        <button type="button" disabled={history.index === history.snapshots.length - 1} onClick={() => dispatch({ type: 'redo' })} aria-label="Redo waypoint change" title="Redo"><Redo2 size={18} /><span>Redo</span></button>
        <button type="button" disabled={points.length < 2} onClick={() => dispatch({ type: 'reverse' })} aria-label="Reverse route" title="Reverse route"><ArrowDownUp size={18} /><span>Reverse</span></button>
        <button type="button" disabled={!points.length} onClick={() => dispatch({ type: 'clear' })} aria-label="Clear route" title="Clear route"><Trash2 size={18} /><span>Clear</span></button>
      </div>
      {points.length > 0 && <ol className="lts-route-stops" aria-label="Route waypoints">{points.map((point, index) => <li key={`${index}-${point.join(',')}`}>
        <span className="lts-waypoint-letter">{String.fromCharCode(65 + index)}</span>
        <div><strong>{index === 0 ? 'Start' : index === points.length - 1 ? 'Destination' : `Stop ${index}`}</strong><span>{point[1].toFixed(5)}, {point[0].toFixed(5)}</span></div>
        <button type="button" aria-label={`Remove waypoint ${String.fromCharCode(65 + index)}`} onClick={() => dispatch({ type: 'remove', index })}><X size={17} /></button>
      </li>)}</ol>}
      {points.length === MAX_ROUTE_POINTS && <p className="lts-route-note">26 waypoints selected. Remove a stop to add another.</p>}
      <div aria-live="polite" aria-atomic="true" aria-busy={loading}>
        {loading && <p className="lts-route-status"><Loader2 size={18} className="animate-spin" />Finding a lower-stress route…</p>}
        {error && <p className="lts-route-error" role="alert">{error}</p>}
        {result && <section className="lts-route-result" aria-label="Planned route">
          <div className="lts-route-result-heading"><h3>Stress Free route</h3><span>Coloured by LTS</span></div>
          <div className="lts-route-totals"><strong>{distance(result.summary.distance_m)}</strong><span>About {duration(result.summary.time_ms)}</span></div>
          {result.comparison && <div className="lts-route-comparison"><label><input type="checkbox" checked={showComparison} onChange={event => setShowComparison(event.target.checked)} /><span><strong>Compare Bike Paths</strong><span>{distance(result.comparison.summary.distance_m)} · About {duration(result.comparison.summary.time_ms)}</span></span><i aria-hidden="true" /></label></div>}
          {result.comparison_error && <p className="lts-route-note">Bike Paths comparison is temporarily unavailable.</p>}
          <details className="lts-disclosure"><summary>Route details</summary>
            <div className="lts-route-breakdown">{Object.entries(result.summary.percentage_by_lts).filter(([, percent]) => percent > 0).map(([level, percent]) => <div key={level}><span><i style={{ background: LTS_VOTE_COLOURS[Number(level) as keyof typeof LTS_VOTE_COLOURS] ?? '#5d696c' }} />LTS {level}</span><strong>{percent}%</strong></div>)}</div>
            {result.summary.known_unsealed_distance_m > 0 && <p className="lts-route-note">Known unsealed surface: {distance(result.summary.known_unsealed_distance_m)}.</p>}
            {result.summary.mtb_caution_distance_m > 0 && <p className="lts-route-note">Trail sections needing extra care: {distance(result.summary.mtb_caution_distance_m)}.</p>}
            <p className="lts-route-note">Travel time is an estimate. Check local conditions and signs before riding.</p>
          </details>
        </section>}
      </div>
      <details className="lts-disclosure"><summary>Routing options</summary><label className="lts-route-option"><input type="checkbox" checked={allowGravel} onChange={event => setAllowGravel(event.target.checked)} /><span>Allow gravel and unsealed paths</span></label><p className="lts-route-note">Stress Free routing excludes approved LTS 4.5 links, even for a short connection. Surface suitability is assessed separately from traffic stress.</p></details>
    </div>
  </aside>;
}
