'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LtsMap } from 'maplibre-gl';
import { loadWorkshopScc, WORKSHOP_SCC_COLOUR, WORKSHOP_SCC_SOURCE } from '@/lib/workshop-scc';

const source = 'workshop-scc';
const casing = 'workshop-scc-casing';
const line = 'workshop-scc-lines';

export function useWorkshopScc(map: LtsMap | null, enabled: boolean, visible: boolean) {
  const [error, setError] = useState('');
  const visibility = useRef(visible);
  useEffect(() => { visibility.current = visible; }, [visible]);
  useEffect(() => {
    if (!map || !enabled) return;
    let disposed = false;
    loadWorkshopScc().then(data => {
      if (disposed || !map.getCanvas().isConnected) return;
      map.addSource(source, { type: 'geojson', data });
      const before = map.getLayer('workshop-numbers') ? 'workshop-numbers' : undefined;
      const layout = { 'line-cap': 'round' as const, 'line-join': 'round' as const, visibility: visibility.current ? 'visible' as const : 'none' as const };
      map.addLayer({ id: casing, type: 'line', source, layout, paint: {
        'line-color': '#ffffff', 'line-opacity': .8,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 4.5, 17, 6.5],
      } }, before);
      map.addLayer({ id: line, type: 'line', source, layout, paint: {
        'line-color': WORKSHOP_SCC_COLOUR, 'line-opacity': .9,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 12, 2.5, 17, 4.5],
      } }, before);
      setError('');
    }).catch(() => { if (!disposed) setError('SCC corridors could not load.'); });
    return () => {
      disposed = true;
      if (!map.getCanvas().isConnected) return;
      for (const id of [line, casing]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(source)) map.removeSource(source);
    };
  }, [map, enabled]);
  useEffect(() => {
    if (map && enabled) for (const id of [line, casing]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }, [map, enabled, visible]);
  return error;
}

export function useGoogleWorkshopScc(map: google.maps.Map | null, visible: boolean, panorama: boolean) {
  const layers = useRef<google.maps.Data[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!map) return;
    let disposed = false;
    const underlay = new google.maps.Data();
    const overlay = new google.maps.Data();
    layers.current = [underlay, overlay];
    const style = () => {
      const width = Math.max(1.2, Math.min(4.5, 1.2 + ((map.getZoom() || 7) - 7) * .33));
      underlay.setStyle({ clickable: false, strokeColor: '#ffffff', strokeOpacity: .8, strokeWeight: width + 2, zIndex: 19 });
      overlay.setStyle({ clickable: false, strokeColor: WORKSHOP_SCC_COLOUR, strokeOpacity: .9, strokeWeight: width, zIndex: 20 });
    };
    style();
    const listener = map.addListener('zoom_changed', style);
    loadWorkshopScc().then(data => {
      if (disposed) return;
      underlay.addGeoJson(data); overlay.addGeoJson(data); setError('');
    }).catch(() => { if (!disposed) setError('SCC corridors could not load.'); });
    return () => { disposed = true; listener.remove(); underlay.setMap(null); overlay.setMap(null); layers.current = []; };
  }, [map]);
  useEffect(() => { layers.current.forEach(layer => layer.setMap(visible && !panorama ? map : null)); }, [map, visible, panorama]);
  return error;
}

export function WorkshopSccControl({ visible, onChange, error }: { visible: boolean; onChange: (visible: boolean) => void; error: string }) {
  return <div className="workshop-scc-control">
    <label><input type="checkbox" checked={visible} onChange={event => onChange(event.target.checked)} />
      <span className="workshop-scc-swatch" aria-hidden="true" /> SCC corridors</label>
    {visible && <p className="workshop-hint">Strategic Cycling Corridors · <a href={WORKSHOP_SCC_SOURCE} target="_blank" rel="noreferrer">DTP source ↗</a>. Check LTS for current riding conditions.</p>}
    {error && visible && <p role="status" className="workshop-hint">{error}</p>}
  </div>;
}
