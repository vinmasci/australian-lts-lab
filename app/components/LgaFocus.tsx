'use client';

import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as LtsMap } from 'maplibre-gl';
import { ltsAppPath } from '@/lib/client-path';
import { findLga, lgaBoundary, lgaBounds, lgaFocusUrl, lgaMask, type LgaCollection, type LgaFeature } from '@/lib/lga-focus';

const maskSource = 'lga-focus-mask', boundarySource = 'lga-focus-boundary';
let collection: Promise<LgaCollection> | null = null;
function loadLgas() {
  if (!collection) collection = fetch(ltsAppPath('/data/lga/victoria.geojson')).then(async response => {
    if (!response.ok) throw new Error('Council boundaries could not load.');
    return response.json() as Promise<LgaCollection>;
  }).catch(error => { collection = null; throw error; });
  return collection;
}
function fitLga(map: LtsMap, feature: LgaFeature, duration: number) {
  if (!map.getCanvas().isConnected) return;
  map.resize();
  const b = lgaBounds(feature);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 60, right: 45, left: 45, bottom: 50 }, maxZoom: 14, duration });
}
export function useLgaFocus(map: LtsMap | null, enabled: boolean, ready: boolean) {
  const [data, setData] = useState<LgaCollection | null>(null);
  const [selected, setSelected] = useState<LgaFeature | null>(null);
  const [error, setError] = useState('');
  const previousEnabled = useRef(enabled);
  useEffect(() => {
    let disposed = false;
    if (!enabled) {
      if (previousEnabled.current) window.history.replaceState(null, '', lgaFocusUrl(window.location.href, ''));
      previousEnabled.current = enabled; return;
    }
    previousEnabled.current = enabled;
    loadLgas().then(result => {
      if (disposed) return;
      setData(result);
      const requested = new URLSearchParams(window.location.search).get('lga') || '';
      const match = findLga(result, requested); setSelected(match);
      setError(requested && !match ? 'That council was not found. Choose a Victorian council below.' : '');
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Council boundaries could not load.'); });
    return () => { disposed = true; };
  }, [enabled]);
  useEffect(() => {
    if (!map || !enabled || !ready) return;
    const empty = { type: 'FeatureCollection' as const, features: [] };
    map.addSource(maskSource, { type: 'geojson', data: empty });
    map.addSource(boundarySource, { type: 'geojson', data: empty });
    map.addLayer({ id: maskSource, type: 'fill', source: maskSource, paint: { 'fill-color': '#f5f5f1', 'fill-opacity': .88 } });
    map.addLayer({ id: boundarySource, type: 'line', source: boundarySource, paint: { 'line-color': '#345946', 'line-width': 2, 'line-opacity': .9 } });
    return () => {
      if (!map.getCanvas().isConnected) return;
      for (const id of [boundarySource, maskSource]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [boundarySource, maskSource]) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, enabled, ready]);
  const fit = () => {
    if (!map || !selected) return;
    requestAnimationFrame(() => fitLga(map, selected, 350));
  };
  useEffect(() => {
    if (!map || !enabled || !ready || !map.getSource(maskSource)) return;
    const empty = { type: 'FeatureCollection' as const, features: [] };
    (map.getSource(maskSource) as GeoJSONSource).setData(selected ? lgaMask(selected) : empty);
    (map.getSource(boundarySource) as GeoJSONSource).setData(selected ? lgaBoundary(selected) : empty);
    if (selected) {
      const frame = requestAnimationFrame(() => fitLga(map, selected, 0));
      return () => cancelAnimationFrame(frame);
    }
  }, [map, enabled, ready, selected]);
  const select = (id: string) => {
    const feature = data ? findLga(data, id) : null;
    setSelected(feature); setError('');
    window.history.replaceState(null, '', lgaFocusUrl(window.location.href, feature?.properties.name || ''));
  };
  return { data, selected: enabled ? selected : null, error, select, fit, loading: enabled && !data && !error };
}

export function LgaFocusControl({ focus, disabled, onSelect, onFit }: { focus: ReturnType<typeof useLgaFocus>; disabled: boolean; onSelect: (id: string) => void; onFit: () => void }) {
  return <section className="lts-lga-control" aria-label="Focus on a council area">
    <label htmlFor="lts-lga-select">Council area (LGA)</label>
    <select id="lts-lga-select" value={focus.selected?.properties.id || ''} disabled={disabled || focus.loading || !focus.data} onChange={event => onSelect(event.target.value)}>
      <option value="">{focus.loading ? 'Loading councils…' : 'All Victorian councils'}</option>
      {focus.data?.features.map(f => <option key={f.properties.id} value={f.properties.id}>{f.properties.name}</option>)}
    </select>
    <p>Choose a council to focus on its roads and fade surrounding areas.</p>
    {focus.selected && <div className="lts-lga-actions"><button type="button" onClick={onFit}>Fit council</button><button type="button" disabled={disabled} onClick={() => onSelect('')}>Clear area</button></div>}
    {focus.error && <p role="status">{focus.error}</p>}
    <a href="https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/Planning/VicPlan_Other/MapServer/1" target="_blank" rel="noreferrer">Boundaries: Vicmap / VicPlan ↗</a>
  </section>;
}
