'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapMouseEvent, MapGeoJSONFeature, addProtocol, removeProtocol } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Bike, ChevronDown, ChevronUp, ExternalLink, Info, Layers3, Loader2, LocateFixed, MapPin, Redo2, Route as RouteIcon, Search, Trash2, Undo2, X } from 'lucide-react';
import { Protocol } from 'pmtiles';
import { DismountReport } from '@/app/components/DismountReport';
import { SegmentVote } from '@/app/components/SegmentVote';
import { MAX_SELECTED_SEGMENTS, toggleSegment } from '@/lib/lts-multi-select';
import { CommunityActivity } from '@/app/components/CommunityActivity';
import { ltsAppPath } from '@/lib/client-path';
import type { DismountReportSegment } from '@/lib/dismount-reporting';
import { googleStreetViewUrl } from '@/lib/google-maps';
import { LTS_VOTE_COLOURS, type VoteSegment } from '@/lib/lts-voting';
import { assessBikeAccess, orderedOsmTags, type OsmFeatureDetails } from '@/lib/osm-tags';


const DATASET_VERSION = 'au-lts-v0.5-council-traffic';
const USING_LOCAL_ENRICHED_ROUTER = process.env.NODE_ENV === 'development'
  && process.env.NEXT_PUBLIC_LTS_USE_LOCAL_ROUTER === 'true';
interface PlaceSearchResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  bounds: [number, number, number, number] | null;
}


function placeSearchUrl(query: string, map: maplibregl.Map | null): string {
  const params = new URLSearchParams({ q: query });
  if (map) {
    const centre = map.getCenter();
    params.set('lat', centre.lat.toFixed(5));
    params.set('lon', centre.lng.toFixed(5));
    params.set('zoom', String(Math.round(map.getZoom())));
  }
  return ltsAppPath(`/api/geocode?${params}`);
}

const DATASETS = {
  victoria: {
    label: 'Victoria',
    title: 'AusBUG LTS Map · Victoria',
    dataUrl: process.env.NEXT_PUBLIC_VICTORIA_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/victoria-lts-5a1325e7.pmtiles',
    metadataUrl: `/data/lts/victoria-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [144.9631, -37.8136] as [number, number],
    zoom: 12,
    routable: true,
  },
  nsw: {
    label: 'New South Wales',
    title: 'AusBUG LTS Map · NSW',
    dataUrl: process.env.NEXT_PUBLIC_NSW_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/nsw-lts-d4fdc970.pmtiles',
    metadataUrl: `/data/lts/nsw-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [151.2093, -33.8688] as [number, number],
    zoom: 12,
    routable: true,
  },
  queensland: {
    label: 'Queensland',
    title: 'AusBUG LTS Map · Queensland',
    dataUrl: process.env.NEXT_PUBLIC_QUEENSLAND_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/queensland-lts-c0dd9f26.pmtiles',
    metadataUrl: `/data/lts/queensland-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [153.03, -27.47] as [number, number],
    zoom: 12,
    routable: true,
  },
  western_australia: {
    label: 'Western Australia',
    title: 'AusBUG LTS Map · Western Australia',
    dataUrl: process.env.NEXT_PUBLIC_WA_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/western-australia-lts-64573cc9.pmtiles',
    metadataUrl: `/data/lts/western-australia-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [115.86, -31.95] as [number, number],
    zoom: 12,
    routable: true,
  },
  south_australia: {
    label: 'South Australia',
    title: 'AusBUG LTS Map · South Australia',
    dataUrl: process.env.NEXT_PUBLIC_SA_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/south-australia-lts-d579551c.pmtiles',
    metadataUrl: `/data/lts/south-australia-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [138.60, -34.93] as [number, number],
    zoom: 12,
    routable: true,
  },
  act: {
    label: 'Australian Capital Territory',
    title: 'AusBUG LTS Map · ACT',
    dataUrl: process.env.NEXT_PUBLIC_ACT_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/act-lts-166671dc.pmtiles',
    metadataUrl: `/data/lts/act-lts-metadata.json?v=${DATASET_VERSION}-166671dc`,
    center: [149.13, -35.28] as [number, number],
    zoom: 12,
    routable: true,
  },
  tasmania: {
    label: 'Tasmania',
    title: 'AusBUG LTS Map · Tasmania',
    dataUrl: process.env.NEXT_PUBLIC_TASMANIA_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/tasmania-lts-ee99da23.pmtiles',
    metadataUrl: `/data/lts/tasmania-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [147.33, -42.88] as [number, number],
    zoom: 12,
    routable: true,
  },
  northern_territory: {
    label: 'Northern Territory',
    title: 'AusBUG LTS Map · Northern Territory',
    dataUrl: process.env.NEXT_PUBLIC_NT_PMTILES_URL || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/northern-territory-lts-e6f8e235.pmtiles',
    metadataUrl: `/data/lts/northern-territory-lts-metadata.json?v=${DATASET_VERSION}`,
    center: [130.85, -12.46] as [number, number],
    zoom: 12,
    routable: true,
  },
} as const;
type DatasetKey = keyof typeof DATASETS;

interface SourceLink { label: string; href: string }
interface StateSourceCopy {
  trafficTitle: string;
  trafficDescription: string;
  trafficLinks: SourceLink[];
  roadDescription: string;
  roadLinks: SourceLink[];
  methodology: string[];
  trafficLimitation: string;
  speedLimitation: string;
}
const STATE_SOURCE_COPY: Record<DatasetKey, StateSourceCopy> = {
  victoria: {
    trafficTitle: 'Victorian traffic-volume evidence',
    trafficDescription: 'The historical directional AADT network is supplemented by 2026 TIRTL and telemetry sensor averages, SCATS signal-loop observations, City of Casey surveys, and City of Melbourne’s 2014–17 classified counts. Fresh direct counts take precedence; the older Melbourne counts only fill gaps.',
    trafficLinks: [
      { label: 'AADT', href: 'https://discover.data.vic.gov.au/dataset/historical-annual-average-daily-traffic-volume' },
      { label: 'TIRTL', href: 'https://opendata.transport.vic.gov.au/dataset/tirtl-traffic-counts' },
      { label: 'Telemetry', href: 'https://discover.data.vic.gov.au/dataset/telemetry-traffic-counts-and-classification' },
      { label: 'SCATS', href: 'https://opendata.transport.vic.gov.au/dataset/traffic-signal-volume-data' },
      { label: 'Casey surveys', href: 'https://discover.data.vic.gov.au/en_AU/dataset/traffic-volume-survey' },
      { label: 'Melbourne counts', href: 'https://discover.data.vic.gov.au/dataset/traffic-count-vehicle-classification-2014-2017' },
    ],
    roadDescription: 'DTP normal-operation speed zones fill missing OSM speeds. DTP bicycle infrastructure fills missing directional lane, buffer and protection details. City of Melbourne parking zones fill otherwise unknown kerbside parking. Explicit OSM tags always win.',
    roadLinks: [
      { label: 'Speed zones', href: 'https://discover.data.vic.gov.au/en_AU/dataset/speed-zones' },
      { label: 'Bike infrastructure', href: 'https://opendata.transport.vic.gov.au/dataset/bicycle-infrastructure-network' },
      { label: 'Parking zones', href: 'https://discover.data.vic.gov.au/dataset/parking-zones-linked-to-street-segments' },
    ],
    methodology: [
      'Direct TIRTL, telemetry and recent council observations outrank historical AADT. SCATS is useful where no better count matches, but its public export does not identify road approaches: the Lab conservatively estimates one direction from the intersection total, labels it low confidence, and permits it to raise a road by only one LTS level.',
      'Where OSM is missing a speed, the classifier uses DTP’s June 2026 normal-operation speed zone for that direction. School, shopping and other conditional limits are excluded because this all-day map cannot yet know when they apply. Official bicycle and parking layers similarly fill only missing details.',
    ],
    trafficLimitation: 'The historical AADT layer mainly covers Victoria’s declared road network. Current sensors and council surveys improve coverage, but local-road traffic evidence remains much stronger in Melbourne and Casey than elsewhere in Victoria.',
    speedLimitation: 'Only normal-operation speed zones are used. Time-dependent school, shopping and variable limits are not applied until the router can evaluate their active times.',
  },
  nsw: {
    trafficTitle: 'NSW traffic-volume evidence',
    trafficDescription: 'Published Transport for NSW all-day, all-vehicle station counts are matched conservatively by road identity, projected distance and travel direction. Every accepted count is pinned to one audited OSM way; ambiguous and rejected observations do not enter the map. Dates vary by station and remain visible when a road is inspected.',
    trafficLinks: [{ label: 'TfNSW traffic counts', href: 'https://data.nsw.gov.au/data/en/dataset/2-nsw-roads-traffic-volume-counts-api' }],
    roadDescription: 'TfNSW fixed, all-day speed-zone lines fill only missing OSM speeds when the geometry strongly covers the same road. Conditional, school and variable zones are excluded; conflicting or one-way-ambiguous matches are quarantined. Explicit OSM speeds always win. Cycling treatments, lane detail, buffers and parking currently come from OSM.',
    roadLinks: [{ label: 'TfNSW speed zones', href: 'https://data.nsw.gov.au/data/en/dataset/2-speed-zones' }],
    methodology: [
      'The NSW importer keeps the latest published all-day/all-vehicle observation for each exact station direction, but the latest available year varies substantially by station. Counts are never copied along a corridor: the audit accepts one OSM way or rejects the observation.',
      'Where OSM is missing a speed, the classifier may use a strongly coincident TfNSW fixed all-day speed zone. Conditional and variable limits are excluded, explicit OSM speed tags are protected, and competing strong matches are left unresolved.',
    ],
    trafficLimitation: 'TfNSW traffic-count coverage is sparse and uneven. Many stations’ latest published all-day observation is historical; the observation year is retained and shown rather than presented as current traffic.',
    speedLimitation: 'Only fixed all-day speed zones are used. Time-dependent school and variable limits are not applied until the router can evaluate their active times.',
  },
  queensland: {
    trafficTitle: 'Queensland traffic-volume evidence',
    trafficDescription: 'Queensland TMR’s 2025 traffic census is supplemented by published City of Gold Coast and Logan road counts and Brisbane key-corridor weekday volumes. Every accepted observation retains its source, year, method and direction where supplied; future-dated, incomplete and ambiguous records are rejected rather than guessed.',
    trafficLinks: [
      { label: 'TMR traffic census', href: 'https://www.data.qld.gov.au/dataset/traffic-census-for-the-queensland-state-declared-road-network' },
      { label: 'TMR road-location data', href: 'https://www.data.qld.gov.au/dataset/road-location-and-traffic-data' },
      { label: 'Gold Coast traffic counts', href: 'https://services.arcgis.com/3vStCH7NDoBOZ5zn/arcgis/rest/services/Traffic_Count/FeatureServer/0' },
      { label: 'Logan traffic counts', href: 'https://services5.arcgis.com/ZUCWDRj8F77Xo351/arcgis/rest/services/Logan_City_Council_Traffic_Counts/FeatureServer/0' },
      { label: 'Brisbane key corridors', href: 'https://data.brisbane.qld.gov.au/explore/dataset/traffic-management-key-corridor-monthly-performance-report/' },
    ],
    roadDescription: 'Queensland’s public point-in-time speed-sign surveys are historical observations, not a current statewide speed-zone line layer, so this build does not use them to overwrite or fill OSM speeds. Cycling treatments, lane details, buffers and parking currently come from OSM.',
    roadLinks: [{ label: 'Historical speed-sign survey (not used)', href: 'https://www.data.qld.gov.au/dataset/speed-limits-for-state-and-local-roads' }],
    methodology: [
      'The Queensland importer uses 2025 TMR AADT for each published representative segment. Combined counts are applied to undivided carriageways; directional counts are kept on the matching divided carriageway. Geometry is split at genuine carriageway transitions rather than interpolated across gaps.',
      'Gold Coast and Logan observations are reduced to the latest valid count at each published site. Brisbane publishes corridor descriptions rather than road geometry, so only corridors that resolve unambiguously along the named OSM road graph and agree with the published corridor length are included; unresolved corridors are quarantined.',
      'Queensland’s historical speed-sign survey is not treated as a current speed-zone network. Where OSM has no explicit speed, the shared road-class fallback is used and marked as inferred.',
    ],
    trafficLimitation: 'TMR provides statewide declared-road coverage, while the new local-road evidence is concentrated in Brisbane, Gold Coast and Logan. Roads elsewhere without a matched count continue to use OSM road class, speed, lanes and cycling-facility evidence.',
    speedLimitation: 'Queensland’s historical point-in-time speed-sign survey is not used as if it were a current speed-zone layer. Missing OSM speeds use clearly labelled classifier fallbacks.',
  },
  western_australia: {
    trafficTitle: 'Western Australian traffic-volume evidence',
    trafficDescription: 'Main Roads WA Traffic Digest observations are supplemented by City of Perth road counts. Metropolitan records use the published Monday–Friday volume and regional records use Monday–Sunday volume; permanent-counter records take precedence over sample counts. Source year, method, direction and confidence remain attached to inspected roads.',
    trafficLinks: [
      { label: 'Main Roads WA Traffic Digest', href: 'https://catalogue.data.wa.gov.au/dataset/mrwa-traffic-digest' },
      { label: 'City of Perth traffic counts', href: 'https://services7.arcgis.com/v8XBa2naYNQGOjlG/arcgis/rest/services/TRN_RD_TRAFFICCOUNT_TVW_PV/FeatureServer/0' },
    ],
    roadDescription: 'Main Roads WA Legal Speed Limit lines fill a missing OSM speed only where the public record contains one explicit numeric all-day value and strongly matches the same road. Ambiguous “50 built-up / 110 outside” records are rejected rather than guessed. Cycling treatments and parking come from OSM.',
    roadLinks: [{ label: 'Main Roads WA legal speed limits', href: 'https://catalogue.data.wa.gov.au/dataset/mrwa-legal-speed-limits' }],
    methodology: [
      'Traffic Digest records preserve their metropolitan or regional averaging period and permanent or sample-count methodology. Geometry, road identity and direction must support a conservative OSM match before volume can raise LTS.',
      'City of Perth rows are deduplicated by site and survey period. Complementary directions are combined for a two-way centreline; a lone directional observation remains directional instead of being silently treated as a whole-road total.',
      'Only an explicit all-day numeric legal speed can fill a missing OSM value. Ambiguous default records, weak geometry matches and conflicting strong matches remain unresolved and use the labelled classifier fallback.',
    ],
    trafficLimitation: 'Traffic Digest coverage is strongest on the Main Roads network; City of Perth improves central-city local-road coverage but does not represent every metropolitan council. Unmatched local roads continue to use OSM and transparent road-class inference.',
    speedLimitation: 'Many WA legal-speed records describe a context-dependent default rather than one explicit value. Those rows are deliberately excluded instead of assigning a potentially wrong speed.',
  },
  south_australia: {
    trafficTitle: 'South Australian traffic-volume evidence',
    trafficDescription: 'The Department for Infrastructure and Transport’s current Traffic Volumes layer supplies published AADT estimates. Valid records are matched conservatively by road geometry and identity, with source year, method and confidence retained for inspection.',
    trafficLinks: [{ label: 'DIT Traffic Volumes', href: 'https://data.sa.gov.au/data/dataset/traffic-volumes' }],
    roadDescription: 'This build has no separate current statewide speed-line supplement. Explicit OSM speed, lane, cycling-facility and parking tags are used where present; otherwise the shared classifier’s labelled road-class fallbacks apply.',
    roadLinks: [],
    methodology: [
      'The published DIT traffic-volume estimate is accepted only when it can be associated with the same OSM road geometry. Invalid or ambiguous records are rejected rather than spread along a corridor.',
      'No external speed layer overwrites OSM. A missing speed remains visibly inferred from road class, using the same fallback rules as every other state.',
    ],
    trafficLimitation: 'DIT volume coverage is concentrated on monitored roads. Local streets without a match continue to use OSM road class, speed, lanes and cycling-facility evidence.',
    speedLimitation: 'No current reusable statewide speed-zone line layer is included, so missing OSM speeds use clearly labelled classifier fallbacks.',
  },
  act: {
    trafficTitle: 'ACT traffic-volume evidence',
    trafficDescription: 'No maintained, reusable territory-wide geospatial AADT feed was suitable for a conservative road-level join. The ACT map therefore uses OSM and transparent road-class inference rather than presenting tabular summaries as exact street counts.',
    trafficLinks: [],
    roadDescription: 'The public ACT speed-zone layer located during this audit was dated November 2020, so it is not used as if it represented current legal speeds. Explicit OSM details remain authoritative and missing values use labelled fallbacks. ACT rules permit cycling on ordinary paths unless signed otherwise, but legal access is not treated as evidence that a footpath is purpose-built or comfortable cycling infrastructure.',
    roadLinks: [{ label: 'ACT active-travel path guidance', href: 'https://www.cityservices.act.gov.au/__data/assets/pdf_file/0010/1382383/Municipal-Infrastructure-Standards-05-Active-Travel-Facilities-Design.pdf' }],
    methodology: [
      'ACT routing uses the same classifier and penalties as the other live states, but no official traffic volume is attached unless a reusable observation can be spatially audited to the road.',
      'The stale public speed snapshot is deliberately omitted. This avoids creating false precision from a layer that may not reflect subsequent speed-zone changes.',
      'An ordinary ACT path or forestry track may remain available to routing where OSM does not prohibit bicycles, but receives the unconfirmed-path penalty. Because bicycle=yes often restates territory-wide legal access, that tag alone does not prove a purpose-built cycling facility in the ACT. These access-only links are hidden by default; designated cycleways, shared paths and bicycle-route links remain visible.',
    ],
    trafficLimitation: 'No official territory-wide road-level AADT supplement is included. Results rely more heavily on OSM road class, explicit speed, lanes and cycling facilities.',
    speedLimitation: 'The located ACT speed dataset is historical and is not used to fill current speeds; missing OSM values use clearly labelled fallbacks.',
  },
  tasmania: {
    trafficTitle: 'Tasmanian traffic-volume evidence',
    trafficDescription: 'The national Harmonised Traffic Counts calendar-year layer is grouped by station, road and year, with directional or lane totals combined and normalised by observation coverage. The latest available annual record for each station is matched conservatively to OSM and keeps its year visible.',
    trafficLinks: [{ label: 'Harmonised Traffic Counts', href: 'https://catalogue.data.infrastructure.gov.au/dataset/harmonised-traffic-counts' }],
    roadDescription: 'State Growth Speed Limits lines fill missing OSM speeds only when the published directions resolve to one safe all-day value. Conflicting directional values that cannot be expressed safely on the OSM way are rejected.',
    roadLinks: [{ label: 'State Growth speed limits', href: 'https://data.stategrowth.tas.gov.au/ags/rest/services/PUBLIC/SPEEDLIMITS/FeatureServer' }],
    methodology: [
      'Annual traffic observations are grouped at the station before matching, so separate lanes or directions are not mistaken for independent whole-road AADT values. The latest available station year is retained rather than labelled current.',
      'A State Growth speed match must be geometrically strong and directionally unambiguous. Explicit OSM speeds win, while unresolved official records leave the classifier fallback visible.',
    ],
    trafficLimitation: 'Harmonised count stations are sparse outside monitored corridors and their latest year varies. Unmatched roads continue to use OSM and transparent inference.',
    speedLimitation: 'Directional speed records that cannot be represented safely on the matching OSM way are excluded rather than collapsed into one potentially wrong value.',
  },
  northern_territory: {
    trafficTitle: 'Northern Territory traffic-volume evidence',
    trafficDescription: 'The current public Annual Traffic Report is distributed as workbooks and maps without a reusable territory-wide geospatial station join. This build does not invent coordinates or copy summary values onto roads, so the current map uses OSM and transparent inference.',
    trafficLinks: [{ label: 'NT Annual Traffic Report 2023', href: 'https://data.nt.gov.au/dataset/annual-traffic-report-2023' }],
    roadDescription: 'No suitable current territory-wide speed-line source was found for audited gap filling. Explicit OSM speed, lane, cycling-facility and parking tags are used where available; missing values use the common labelled fallbacks.',
    roadLinks: [],
    methodology: [
      'NT routing uses the same directional LTS classifier, crossing penalties and trail rules as the other live states. The absence of a matched count does not block routing, but it leaves traffic confidence lower.',
      'Workbook summaries will only be added after station locations can be joined reproducibly and audited. Until then, omitting them is more accurate than presenting a territory total as road-level evidence.',
    ],
    trafficLimitation: 'No official territory-wide road-level AADT supplement is included. Results rely more heavily on OSM road class, explicit speed, lanes and cycling facilities.',
    speedLimitation: 'No current reusable territory-wide speed-zone line layer is included, so missing OSM speeds use clearly labelled classifier fallbacks.',
  },
};
const MAX_ROUTE_POINTS = 26;
const MAPBOX_PUBLIC_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
const SATELLITE_SOURCE_ID = 'mapbox-satellite';
const SATELLITE_LAYER_ID = 'mapbox-satellite-layer';
const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f5f2ed' } },
    { id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-color': '#e8f2df', 'fill-opacity': 0.65 } },
    { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', paint: { 'fill-color': '#ece8df', 'fill-opacity': 0.55 } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#b9def0' } },
    { id: 'boundaries', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': '#a8a29e', 'line-width': 0.7, 'line-dasharray': [3, 2] } },
    { id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#d6d3d1', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.2, 17, 5] } },
    { id: 'buildings', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#ded9d3', 'fill-outline-color': '#cbc5bd' } },
    {
      id: 'road-labels',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
      },
      paint: { 'text-color': '#57534e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
    {
      id: 'place-labels',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 15],
      },
      paint: { 'text-color': '#44403c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
    },
  ],
};
const LTS_COLOURS: Record<number, string> = {
  1: '#16a34a',
  1.5: '#06b6d4',
  2: '#2563eb',
  3: '#f59e0b',
  4: '#dc2626',
};
const LTS_LABELS: Record<number, string> = {
  1: 'Very low stress',
  1.5: 'Quiet trafficable road',
  2: 'Low stress',
  3: 'Higher stress',
  4: 'High stress',
};
const ROUTE_LTS_LEVELS = [1, 1.5, 2, 3, 4] as const;

function syncSatelliteOverlay(map: maplibregl.Map, enabled: boolean, opacity: number) {
  if (!enabled || !MAPBOX_PUBLIC_TOKEN) {
    if (map.getLayer(SATELLITE_LAYER_ID)) map.removeLayer(SATELLITE_LAYER_ID);
    if (map.getSource(SATELLITE_SOURCE_ID)) map.removeSource(SATELLITE_SOURCE_ID);
    return;
  }

  if (!map.getSource(SATELLITE_SOURCE_ID)) {
    map.addSource(SATELLITE_SOURCE_ID, {
      type: 'raster',
      url: `https://api.mapbox.com/v4/mapbox.satellite.json?secure&access_token=${MAPBOX_PUBLIC_TOKEN}`,
      tileSize: 256,
    });
  }
  if (!map.getLayer(SATELLITE_LAYER_ID)) {
    map.addLayer({
      id: SATELLITE_LAYER_ID,
      type: 'raster',
      source: SATELLITE_SOURCE_ID,
      paint: {
        'raster-opacity': opacity,
        'raster-fade-duration': 180,
      },
    }, map.getLayer('road-labels') ? 'road-labels' : undefined);
  } else {
    map.setPaintProperty(SATELLITE_LAYER_ID, 'raster-opacity', opacity);
  }
}

interface LtsMetadata {
  classifier_version: string;
  generated_at: string;
  source_pbf_modified_at: string;
  segments: number;
  dismount_segments?: number;
  dismount_distance_km?: number;
  crossings: number;
  segment_counts: Record<string, number>;
  segment_distance_km: Record<string, number>;
  crossing_counts: Record<string, number>;
  confidence_counts: Record<string, number>;
  implicit_footway_cycling?: boolean;
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
    available_records?: number;
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

interface BRouterComparison {
  label: string;
  profile: string;
  route: GeoJSON.LineString;
  summary: {
    distance_m: number;
    time_ms: number;
  };
  stress?: ComparisonStressResult;
}

interface ComparisonStressResult {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  summary: LtsRouteSummary;
  coverage_pct: number;
  unknown_distance_m: number;
}

interface PrimaryStressRoute {
  route: GeoJSON.LineString;
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  summary: LtsRouteSummary;
}

interface LtsRouteResponse {
  classifier_version: string;
  route: GeoJSON.LineString;
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  summary: LtsRouteSummary;
  comparison?: BRouterComparison | null;
  comparison_error?: string;
  error?: string;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function unverifiedTrailFilter(hideAccessOnlyTrails = false): maplibregl.FilterSpecification {
  const base: maplibregl.FilterSpecification = [
    'all',
    ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]],
  ];
  return hideAccessOnlyTrails
    ? ['all', base, ['!=', ['get', 'is_access_only_trail'], true]]
    : base;
}

const ACT_ACCESS_ONLY_TRAIL_FILTER: maplibregl.FilterSpecification = [
  '==', ['get', 'is_access_only_trail'], true,
];

function routeLineGeoJson(route?: GeoJSON.LineString): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return route ? {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: route }],
  } : emptyFeatureCollection() as GeoJSON.FeatureCollection<GeoJSON.LineString>;
}

function routePointsGeoJson(points: Coordinate[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((coordinate, index) => ({
      type: 'Feature',
      properties: {
        role: index === 0 ? 'start' : index === points.length - 1 ? 'finish' : 'via',
        label: String.fromCharCode(65 + index),
      },
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

function simplifyBaseMap(map: maplibregl.Map) {
  for (const layer of map.getStyle()?.layers || []) {
    try {
      if (layer.type === 'line' && /road|street|motorway|trunk|primary|secondary|tertiary/.test(layer.id)) {
        map.setPaintProperty(layer.id, 'line-opacity', 0.22);
      }
      if (layer.type === 'symbol' && /road-number|shield|route-label/.test(layer.id)) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    } catch {
      // Basemap styles differ slightly between releases.
    }
  }
}

function selectedGeoJson(feature?: MapGeoJSONFeature): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: feature ? [{
      type: 'Feature',
      properties: {},
      geometry: feature.geometry,
    } as GeoJSON.Feature] : [],
  };
}

function geometryFingerprint(geometry: GeoJSON.Geometry): string {
  const source = JSON.stringify(geometry);
  let value = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function voteSegmentFromFeature(feature: MapGeoJSONFeature, dataset: DatasetKey, metadata?: LtsMetadata | null): VoteSegment | null {
  const properties = feature.properties as FeatureProperties;
  const currentLts = Number(properties.lts);
  if (!Number.isInteger(currentLts) || currentLts < 1 || currentLts > 4) return null;
  const featureKind = String(properties.feature_kind || 'segment');
  if (featureKind !== 'segment') return null;
  const osmId = properties.osm_id ? String(properties.osm_id) : undefined;
  const sourceId = String(properties.segment_id || osmId || feature.id || geometryFingerprint(feature.geometry as GeoJSON.Geometry));
  const direction = properties.lts_direction || properties.direction;
  const segmentId = `${featureKind}:${sourceId}${direction ? `:${String(direction)}` : ''}`
    .replace(/[^a-zA-Z0-9:._-]/g, '_')
    .slice(0, 160);
  const maxspeed = Number(properties.maxspeed);
  const trafficAadt = Number(properties.traffic_aadt);
  return {
    dataset,
    segmentId,
    name: String(properties.name || 'Unnamed road/path').slice(0, 160),
    featureKind,
    currentLts,
    geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJSON.Geometry,
    osmId,
    direction: direction ? String(direction).slice(0, 30) : undefined,
    maxspeed: Number.isFinite(maxspeed) ? maxspeed : undefined,
    trafficAadt: Number.isFinite(trafficAadt) ? trafficAadt : undefined,
    datasetVersion: metadata ? `${metadata.source_pbf_modified_at}:${metadata.classifier_version}`.slice(0, 160) : undefined,
    classifierVersion: metadata?.classifier_version,
    osmSnapshotDate: metadata?.source_pbf_modified_at,
  };
}

function dismountReportSegmentFromFeature(
  feature: MapGeoJSONFeature,
  dataset: DatasetKey,
  metadata?: LtsMetadata | null,
): DismountReportSegment | null {
  const properties = feature.properties as FeatureProperties;
  if (String(properties.feature_kind || '') !== 'dismount') return null;
  const osmId = properties.osm_id ? String(properties.osm_id) : undefined;
  const sourceId = String(properties.segment_id || osmId || feature.id || geometryFingerprint(feature.geometry as GeoJSON.Geometry));
  return {
    dataset,
    segmentId: `dismount:${sourceId}`.replace(/[^a-zA-Z0-9:._-]/g, '_').slice(0, 160),
    name: String(properties.name || 'Unnamed road/path').slice(0, 160),
    featureKind: 'dismount',
    geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJSON.Geometry,
    osmId,
    datasetVersion: metadata ? `${metadata.source_pbf_modified_at}:${metadata.classifier_version}`.slice(0, 160) : undefined,
    classifierVersion: metadata?.classifier_version,
    osmSnapshotDate: metadata?.source_pbf_modified_at,
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

function routeCoordinateDistance(a: GeoJSON.Position, b: GeoJSON.Position): number {
  const latitude1 = a[1] * Math.PI / 180;
  const latitude2 = b[1] * Math.PI / 180;
  const latitudeDelta = latitude2 - latitude1;
  const longitudeDelta = (b[0] - a[0]) * Math.PI / 180;
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function scoreComparisonAgainstMap(
  route: GeoJSON.LineString,
  sourceFeatures: maplibregl.GeoJSONFeature[],
  distanceMetres: number,
  timeMilliseconds: number,
): ComparisonStressResult | null {
  if (route.coordinates.length < 2) return null;

  const referenceLatitude = route.coordinates.reduce((sum, coordinate) => sum + coordinate[1], 0)
    / route.coordinates.length;
  const metresPerLongitudeDegree = 111_320 * Math.cos(referenceLatitude * Math.PI / 180);
  const toMetres = (coordinate: GeoJSON.Position): [number, number] => [
    coordinate[0] * metresPerLongitudeDegree,
    coordinate[1] * 111_320,
  ];

  interface NetworkSegment {
    start: [number, number];
    end: [number, number];
    properties: FeatureProperties;
  }

  const networkSegments: NetworkSegment[] = [];
  const grid = new Map<string, number[]>();
  const gridSize = 80;
  const addLine = (coordinates: GeoJSON.Position[], properties: FeatureProperties) => {
    for (let index = 1; index < coordinates.length; index += 1) {
      const start = toMetres(coordinates[index - 1]);
      const end = toMetres(coordinates[index]);
      if (start[0] === end[0] && start[1] === end[1]) continue;
      const segmentIndex = networkSegments.push({ start, end, properties }) - 1;
      const minX = Math.floor(Math.min(start[0], end[0]) / gridSize);
      const maxX = Math.floor(Math.max(start[0], end[0]) / gridSize);
      const minY = Math.floor(Math.min(start[1], end[1]) / gridSize);
      const maxY = Math.floor(Math.max(start[1], end[1]) / gridSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const values = grid.get(key);
          if (values) values.push(segmentIndex); else grid.set(key, [segmentIndex]);
        }
      }
    }
  };

  for (const feature of sourceFeatures) {
    const properties = feature.properties as FeatureProperties;
    if (properties.feature_kind !== 'segment') continue;
    if (feature.geometry.type === 'LineString') {
      addLine(feature.geometry.coordinates, properties);
    } else if (feature.geometry.type === 'MultiLineString') {
      for (const line of feature.geometry.coordinates) addLine(line, properties);
    }
  }
  if (networkSegments.length === 0) return null;

  const distanceByLts: Record<string, number> = { '1': 0, '1.5': 0, '2': 0, '3': 0, '4': 0 };
  let knownDistance = 0;
  let unknownDistance = 0;
  let knownUnsealedDistance = 0;
  let mtbCautionDistance = 0;
  let technicalMtbDistance = 0;
  let unverifiedTrailDistance = 0;
  let hikingOnlyDistance = 0;
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  const pointSegmentDistanceSquared = (
    point: [number, number],
    start: [number, number],
    end: [number, number],
  ) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    ));
    const offsetX = point[0] - (start[0] + ratio * dx);
    const offsetY = point[1] - (start[1] + ratio * dy);
    return offsetX * offsetX + offsetY * offsetY;
  };

  for (let index = 1; index < route.coordinates.length; index += 1) {
    const routeStartCoordinate = route.coordinates[index - 1];
    const routeEndCoordinate = route.coordinates[index];
    const sectionDistance = routeCoordinateDistance(routeStartCoordinate, routeEndCoordinate);
    if (sectionDistance < 0.05) continue;
    const routeStart = toMetres(routeStartCoordinate);
    const routeEnd = toMetres(routeEndCoordinate);
    const midpoint: [number, number] = [
      (routeStart[0] + routeEnd[0]) / 2,
      (routeStart[1] + routeEnd[1]) / 2,
    ];
    const cellX = Math.floor(midpoint[0] / gridSize);
    const cellY = Math.floor(midpoint[1] / gridSize);
    const candidateIndexes = new Set<number>();
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        for (const candidate of grid.get(`${x}:${y}`) || []) candidateIndexes.add(candidate);
      }
    }

    const routeDx = routeEnd[0] - routeStart[0];
    const routeDy = routeEnd[1] - routeStart[1];
    const routeLength = Math.hypot(routeDx, routeDy);
    let matched: NetworkSegment | null = null;
    let matchedScore = Number.POSITIVE_INFINITY;
    for (const candidateIndex of candidateIndexes) {
      const candidate = networkSegments[candidateIndex];
      const candidateDx = candidate.end[0] - candidate.start[0];
      const candidateDy = candidate.end[1] - candidate.start[1];
      const candidateLength = Math.hypot(candidateDx, candidateDy);
      const directionSimilarity = routeLength && candidateLength
        ? Math.abs((routeDx * candidateDx + routeDy * candidateDy) / (routeLength * candidateLength))
        : 0;
      const distance = Math.sqrt(pointSegmentDistanceSquared(midpoint, candidate.start, candidate.end));
      const score = distance + (1 - directionSimilarity) * 18;
      if (distance <= 35 && score < matchedScore) {
        matched = candidate;
        matchedScore = score;
      }
    }

    let lts = 0;
    let matchedProperties: FeatureProperties = { confidence: 'unmatched' };
    if (matched) {
      matchedProperties = matched.properties;
      const featureDx = matched.end[0] - matched.start[0];
      const featureDy = matched.end[1] - matched.start[1];
      const aligned = routeDx * featureDx + routeDy * featureDy >= 0;
      const directional = Number(aligned
        ? matched.properties.lts_forward ?? matched.properties.lts
        : matched.properties.lts_backward ?? matched.properties.lts);
      lts = directional >= 1 && directional <= 4 ? directional : Number(matched.properties.lts || 0);
    }

    if (lts >= 1 && lts <= 4) {
      distanceByLts[String(lts)] += sectionDistance;
      knownDistance += sectionDistance;
      if (propertyIsTrue(matchedProperties.is_unsealed)) knownUnsealedDistance += sectionDistance;
      if (matchedProperties.mtb_routing === 'caution') mtbCautionDistance += sectionDistance;
      if (matchedProperties.mtb_routing === 'avoid') technicalMtbDistance += sectionDistance;
      if (matchedProperties.trail_routing === 'caution') unverifiedTrailDistance += sectionDistance;
      if (matchedProperties.trail_routing === 'avoid') hikingOnlyDistance += sectionDistance;
    } else {
      unknownDistance += sectionDistance;
    }

    const featureProperties = {
      lts,
      confidence: matchedProperties.confidence || 'unmatched',
      is_unsealed: propertyIsTrue(matchedProperties.is_unsealed),
      mtb_routing: matchedProperties.mtb_routing || 'normal',
      trail_routing: matchedProperties.trail_routing || 'normal',
    };
    const previous = features.at(-1);
    if (
      previous
      && previous.properties?.lts === featureProperties.lts
      && previous.properties?.is_unsealed === featureProperties.is_unsealed
      && previous.properties?.mtb_routing === featureProperties.mtb_routing
      && previous.properties?.trail_routing === featureProperties.trail_routing
    ) {
      previous.geometry.coordinates.push(routeEndCoordinate);
    } else {
      features.push({
        type: 'Feature',
        properties: featureProperties,
        geometry: { type: 'LineString', coordinates: [routeStartCoordinate, routeEndCoordinate] },
      });
    }
  }

  const measuredDistance = knownDistance + unknownDistance;
  const denominator = distanceMetres || measuredDistance;
  const percentages = Object.fromEntries(
    Object.entries(distanceByLts).map(([lts, metres]) => [
      lts,
      denominator > 0 ? Math.round((metres / denominator) * 1000) / 10 : 0,
    ]),
  );

  return {
    segments: { type: 'FeatureCollection', features },
    coverage_pct: measuredDistance > 0 ? Math.round((knownDistance / measuredDistance) * 1000) / 10 : 0,
    unknown_distance_m: Math.round(unknownDistance),
    summary: {
      distance_m: distanceMetres || measuredDistance,
      time_ms: timeMilliseconds,
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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const placeSearchRequestIdRef = useRef(0);
  const routeModeRef = useRef(false);
  const routePointsRef = useRef<Coordinate[]>([]);
  const routeClickRef = useRef<(coordinate: Coordinate) => void>(() => undefined);
  const routeRequestIdRef = useRef(0);
  const routeHistoryRef = useRef<Coordinate[][]>([[]]);
  const routeHistoryIndexRef = useRef(0);
  const satelliteEnabledRef = useRef(false);
  const satelliteOpacityRef = useRef(0.55);
  const metadataRef = useRef<LtsMetadata | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [metadata, setMetadata] = useState<LtsMetadata | null>(null);
  const [selected, setSelected] = useState<FeatureProperties | null>(null);
  const [selectedVoteSegment, setSelectedVoteSegment] = useState<VoteSegment | null>(null);
  const selectionRef = useRef<{ segment: VoteSegment; feature: MapGeoJSONFeature }[]>([]);
  const [voteSelection, setVoteSelection] = useState<VoteSegment[]>([]);
  const selectionSavingRef = useRef(false);
  const [selectionSaving, setSelectionSaving] = useState(false);
  const multiSelectRef = useRef(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedDismountSegment, setSelectedDismountSegment] = useState<DismountReportSegment | null>(null);
  const [selectedStreetViewPoint, setSelectedStreetViewPoint] = useState<Coordinate | null>(null);
  const [osmFeatureDetails, setOsmFeatureDetails] = useState<OsmFeatureDetails | null>(null);
  const [osmFeatureError, setOsmFeatureError] = useState<{ osmId: string; message: string } | null>(null);
  const [visibleLts, setVisibleLts] = useState<Set<number>>(new Set([1, 2, 3, 4]));
  const [showCrossings, setShowCrossings] = useState(true);
  const [showLowConfidence, setShowLowConfidence] = useState(true);
  const [showMtbTrails, setShowMtbTrails] = useState(true);
  const [showDismountLinks, setShowDismountLinks] = useState(true);
  const [showUnverifiedTrails, setShowUnverifiedTrails] = useState(true);
  const [showActAccessOnlyTrails, setShowActAccessOnlyTrails] = useState(false);
  const [satelliteEnabled, setSatelliteEnabled] = useState(false);
  const [satelliteOpacity, setSatelliteOpacity] = useState(0.55);
  const [allowGravel, setAllowGravel] = useState(true);
  const [routeMode, setRouteMode] = useState(false);
  const [routePoints, setRoutePoints] = useState<Coordinate[]>([]);
  const [routeHistoryIndex, setRouteHistoryIndex] = useState(0);
  const [routeHistoryLength, setRouteHistoryLength] = useState(1);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeSummary, setRouteSummary] = useState<LtsRouteSummary | null>(null);
  const [primaryStressRoute, setPrimaryStressRoute] = useState<PrimaryStressRoute | null>(null);
  const [routeComparison, setRouteComparison] = useState<BRouterComparison | null>(null);
  const [routeComparisonError, setRouteComparisonError] = useState<string | null>(null);
  const [comparisonScoring, setComparisonScoring] = useState(false);
  const [selectedRouteKind, setSelectedRouteKind] = useState<'low-stress' | 'bike-profile'>('low-stress');
  const [transparentRoutes, setTransparentRoutes] = useState(false);
  const [routeClassifier, setRouteClassifier] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const aboutDialogRef = useRef<HTMLDivElement>(null);
  const aboutCloseRef = useRef<HTMLButtonElement>(null);
  const [mapPanelExpanded, setMapPanelExpanded] = useState(false);
  const [panelFocus, setPanelFocus] = useState<'route' | 'layers'>('layers');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [datasetKey, setDatasetKey] = useState<DatasetKey>('victoria');
  const startupInteractionRef = useRef(false);
  const startupViewRef = useRef<{ dataset: DatasetKey; center: [number, number] } | null>(null);
  const activeDataset = DATASETS[datasetKey];
  const stateSourceCopy = STATE_SOURCE_COPY[datasetKey];
  const displayedRouteSummary = selectedRouteKind === 'bike-profile'
    ? routeComparison?.stress?.summary || null
    : routeSummary;

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    // Contact our own map host directly: the ausbug.app proxy otherwise locates
    // the proxy server instead of the visitor. No GPS permission or third-party lookup.
    const url = process.env.NODE_ENV === 'production'
      ? 'https://australian-lts-lab.vercel.app/api/start-location'
      : '/api/start-location';
    fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
      .then(response => response.ok ? response.json() : null)
      .then((hint: { dataset?: string; center?: [number, number] | null } | null) => {
        if (controller.signal.aborted || startupInteractionRef.current || !hint?.dataset
          || !Object.prototype.hasOwnProperty.call(DATASETS, hint.dataset)) return;
        const dataset = hint.dataset as DatasetKey;
        const center = hint.center && hint.center.length === 2 && hint.center.every(Number.isFinite)
          ? hint.center : DATASETS[dataset].center;
        startupViewRef.current = { dataset, center };
        if (dataset === 'victoria') {
          mapRef.current?.jumpTo({ center, zoom: 12 });
          startupViewRef.current = null;
        } else {
          setMapLoading(true);
          setDatasetKey(dataset);
        }
      })
      .catch(() => { /* Keep the city fallback; location must never block the map. */ })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);

  const refreshApprovedOverlay = useCallback(async () => {
    const params = new URLSearchParams({ dataset: datasetKey, approved: '1' });
    const response = await fetch(ltsAppPath(`/api/lts-votes?${params}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Published segments returned ${response.status}`);
    const approved = await response.json() as GeoJSON.FeatureCollection;
    (mapRef.current?.getSource('lts-approved') as maplibregl.GeoJSONSource | undefined)?.setData(approved);
  }, [datasetKey]);

  const setRoutePointSource = (points: Coordinate[]) => {
    const source = mapRef.current?.getSource('lts-route-points') as maplibregl.GeoJSONSource | undefined;
    source?.setData(routePointsGeoJson(points));
  };

  const clearRoute = (keepPoints: Coordinate[] = []) => {
    routeRequestIdRef.current += 1;
    routePointsRef.current = keepPoints;
    setRoutePoints(keepPoints);
    setRouteSummary(null);
    setPrimaryStressRoute(null);
    setRouteComparison(null);
    setRouteComparisonError(null);
    setComparisonScoring(false);
    setSelectedRouteKind('low-stress');
    setRouteClassifier(null);
    setRouteError(null);
    setRouteLoading(false);
    setRoutePointSource(keepPoints);
    const source = mapRef.current?.getSource('lts-route') as maplibregl.GeoJSONSource | undefined;
    source?.setData(emptyFeatureCollection());
    const comparisonSource = mapRef.current?.getSource('lts-comparison-route') as maplibregl.GeoJSONSource | undefined;
    comparisonSource?.setData(emptyFeatureCollection());
  };

  const displayRoute = (
    kind: 'low-stress' | 'bike-profile',
    primary = primaryStressRoute,
    comparison = routeComparison,
  ) => {
    if (!primary || (kind === 'bike-profile' && !comparison?.stress)) return;
    const colouredSource = mapRef.current?.getSource('lts-route') as maplibregl.GeoJSONSource | undefined;
    const greySource = mapRef.current?.getSource('lts-comparison-route') as maplibregl.GeoJSONSource | undefined;
    if (kind === 'bike-profile' && comparison?.stress) {
      colouredSource?.setData(comparison.stress.segments);
      greySource?.setData(routeLineGeoJson(primary.route));
    } else {
      colouredSource?.setData(primary.segments);
      greySource?.setData(routeLineGeoJson(comparison?.route));
    }
    setSelectedRouteKind(kind);
  };

  const requestRoute = async (points: Coordinate[], gravelAllowed = allowGravel) => {
    const requestId = ++routeRequestIdRef.current;
    setRouteLoading(true);
    setRouteError(null);
    setRouteSummary(null);
    setPrimaryStressRoute(null);
    setRouteComparison(null);
    setRouteComparisonError(null);
    setComparisonScoring(false);
    setSelectedRouteKind('low-stress');
    try {
      const response = await fetch(ltsAppPath('/api/lts-route'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points, allow_gravel: gravelAllowed, dataset: datasetKey }),
      });
      const result = await response.json() as LtsRouteResponse;
      if (!response.ok || result.error) throw new Error(result.error || `Router returned ${response.status}`);
      if (requestId !== routeRequestIdRef.current) return;

      const primary: PrimaryStressRoute = {
        route: result.route,
        segments: result.segments,
        summary: result.summary,
      };
      const source = mapRef.current?.getSource('lts-route') as maplibregl.GeoJSONSource | undefined;
      source?.setData(primary.segments);
      const comparisonSource = mapRef.current?.getSource('lts-comparison-route') as maplibregl.GeoJSONSource | undefined;
      comparisonSource?.setData(routeLineGeoJson(result.comparison?.route));
      setRouteSummary(result.summary);
      setPrimaryStressRoute(primary);
      setRouteComparison(result.comparison || null);
      setRouteComparisonError(result.comparison_error || null);
      setComparisonScoring(Boolean(result.comparison));
      setSelectedRouteKind('low-stress');
      setRouteClassifier(result.classifier_version);

      if (result.route.coordinates.length > 1 && mapRef.current) {
        const bounds = result.route.coordinates.reduce(
          (value, coordinate) => value.extend(coordinate as Coordinate),
          new maplibregl.LngLatBounds(result.route.coordinates[0] as Coordinate, result.route.coordinates[0] as Coordinate),
        );
        mapRef.current.fitBounds(bounds, { padding: { top: 100, right: 80, bottom: 80, left: 360 }, maxZoom: 15 });
      }

      if (result.comparison?.route && mapRef.current) {
        const map = mapRef.current;
        let completed = false;
        let bestStress: ComparisonStressResult | null = null;
        const scoreComparison = (acceptPartial = false) => {
          if (completed || requestId !== routeRequestIdRef.current) return;
          const features = map.querySourceFeatures('lts-network', { sourceLayer: 'lts' });
          const stress = scoreComparisonAgainstMap(
            result.comparison!.route,
            features,
            result.comparison!.summary.distance_m,
            result.comparison!.summary.time_ms,
          );
          if (!stress) return;
          if (!bestStress || stress.coverage_pct > bestStress.coverage_pct) bestStress = stress;
          if (bestStress.coverage_pct === 0) return;
          if (!acceptPartial && bestStress.coverage_pct < 80) return;
          completed = true;
          setRouteComparison({ ...result.comparison!, stress: bestStress });
          setComparisonScoring(false);
        };
        map.once('idle', () => scoreComparison());
        window.setTimeout(() => scoreComparison(), 2_000);
        window.setTimeout(() => scoreComparison(true), 7_000);
        window.setTimeout(() => {
          if (completed || requestId !== routeRequestIdRef.current) return;
          setComparisonScoring(false);
          setRouteComparisonError('The AusBUG Bike Paths route loaded, but its LTS map tiles were not available for scoring.');
        }, 9_000);
      }
    } catch (error) {
      if (requestId !== routeRequestIdRef.current) return;
      setRouteError(error instanceof Error ? error.message : 'The LTS route could not be calculated.');
    } finally {
      if (requestId === routeRequestIdRef.current) setRouteLoading(false);
    }
  };

  const applyRoutePoints = (points: Coordinate[]) => {
    clearRoute(points);
    if (points.length >= 2) void requestRoute(points);
  };

  const commitRoutePoints = (points: Coordinate[]) => {
    const nextHistory = routeHistoryRef.current
      .slice(0, routeHistoryIndexRef.current + 1)
      .concat([[...points]]);
    routeHistoryRef.current = nextHistory;
    routeHistoryIndexRef.current = nextHistory.length - 1;
    setRouteHistoryIndex(routeHistoryIndexRef.current);
    setRouteHistoryLength(nextHistory.length);
    applyRoutePoints(points);
  };

  const undoRouteEdit = () => {
    if (routeHistoryIndexRef.current === 0) return;
    routeHistoryIndexRef.current -= 1;
    setRouteHistoryIndex(routeHistoryIndexRef.current);
    applyRoutePoints(routeHistoryRef.current[routeHistoryIndexRef.current]);
  };

  const redoRouteEdit = () => {
    if (routeHistoryIndexRef.current >= routeHistoryRef.current.length - 1) return;
    routeHistoryIndexRef.current += 1;
    setRouteHistoryIndex(routeHistoryIndexRef.current);
    applyRoutePoints(routeHistoryRef.current[routeHistoryIndexRef.current]);
  };

  const resetRouteHistory = () => {
    routeHistoryRef.current = [[]];
    routeHistoryIndexRef.current = 0;
    setRouteHistoryIndex(0);
    setRouteHistoryLength(1);
    clearRoute();
  };

  useEffect(() => {
    routeModeRef.current = routeMode;
    routeClickRef.current = (coordinate: Coordinate) => {
      const current = routePointsRef.current;
      if (current.length >= MAX_ROUTE_POINTS) {
        setRouteError(`A route can contain up to ${MAX_ROUTE_POINTS} points.`);
        return;
      }
      commitRoutePoints([...current, coordinate]);
    };
  });

  useEffect(() => {
    fetch(ltsAppPath(activeDataset.metadataUrl), { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Metadata returned ${response.status}`);
        return response.json();
      })
      .then(setMetadata)
      .catch((error) => setMapError(`LTS metadata is unavailable: ${error.message}`));
  }, [activeDataset.metadataUrl]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: BASEMAP_STYLE,
        boxZoom: false,
        center: startupViewRef.current?.dataset === datasetKey ? startupViewRef.current.center : activeDataset.center,
        zoom: activeDataset.zoom,
      });
      mapRef.current = map;
      startupViewRef.current = null;
      map.addControl(new maplibregl.NavigationControl({ showZoom: window.innerWidth >= 768 }), 'top-right');

      map.on('error', (event) => {
        const message = event.error?.message || '';
        console.error('[Australian LTS map]', message, event.error);
        if (message.includes(activeDataset.dataUrl) || message.includes('pmtile')) {
          setMapLoading(false);
          setMapError(`The LTS tile archive could not be loaded: ${message}`);
        }
      });

      map.on('load', () => {
        simplifyBaseMap(map);
        map.addSource('lts-network', {
          type: 'vector',
          url: `pmtiles://${ltsAppPath(activeDataset.dataUrl)}`,
        });
        map.addSource('lts-approved', { type: 'geojson', data: emptyFeatureCollection() });
        map.addSource('lts-selected', { type: 'geojson', data: selectedGeoJson() });
        map.addSource('lts-comparison-route', { type: 'geojson', data: emptyFeatureCollection() });
        map.addSource('lts-route', { type: 'geojson', data: emptyFeatureCollection() });
        map.addSource('lts-route-points', { type: 'geojson', data: routePointsGeoJson(routePointsRef.current) });

        const colourExpression: maplibregl.ExpressionSpecification = [
          'case',
          ['==', ['get', 'lts'], 1], LTS_COLOURS[1],
          ['==', ['get', 'lts'], 1.5], LTS_COLOURS[1.5],
          ['==', ['get', 'lts'], 2], LTS_COLOURS[2],
          ['==', ['get', 'lts'], 3], LTS_COLOURS[3],
          ['==', ['get', 'lts'], 4], LTS_COLOURS[4],
          '#6b7280',
        ];
        const approvedColourExpression: maplibregl.ExpressionSpecification = [
          'case',
          ['==', ['get', 'lts'], 1], LTS_VOTE_COLOURS[1],
          ['==', ['get', 'lts'], 1.5], LTS_VOTE_COLOURS[1.5],
          ['==', ['get', 'lts'], 2], LTS_VOTE_COLOURS[2],
          ['==', ['get', 'lts'], 3], LTS_VOTE_COLOURS[3],
          ['==', ['get', 'lts'], 4], LTS_VOTE_COLOURS[4],
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
            'line-opacity': 0.45,
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
            'line-opacity': 0.35,
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
            'line-opacity': 0.45,
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
            'line-opacity': ['case', ['==', ['get', 'confidence'], 'low'], 0.35, 0.45],
            'line-dasharray': [2, 1.5],
          },
        });
        map.addLayer({
          id: 'lts-mtb-trails-casing',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['==', ['get', 'is_mtb'], true],
          minzoom: 9,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.8, 12, 3.6, 15, 6.4, 18, 10.2],
            'line-opacity': 0.45,
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
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 1.7, 15, 3.2, 18, 5.5],
            'line-opacity': 0.45,
            'line-dasharray': [1.1, 1.25],
          },
        });
        map.addLayer({
          id: 'lts-unverified-trails-casing',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: unverifiedTrailFilter(datasetKey === 'act'),
          minzoom: 11,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 5, 18, 10],
            'line-opacity': 0.45,
          },
        });
        map.addLayer({
          id: 'lts-unverified-trails',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: unverifiedTrailFilter(datasetKey === 'act'),
          minzoom: 11,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': '#ec4899',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 14, 2.4, 18, 5.5],
            'line-opacity': 0.45,
            'line-dasharray': [1.1, 1.25],
          },
        });
        map.addLayer({
          id: 'lts-act-access-only-trails-casing',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ACT_ACCESS_ONLY_TRAIL_FILTER,
          minzoom: 11,
          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 5, 18, 10],
            'line-opacity': 0.45,
          },
        });
        map.addLayer({
          id: 'lts-act-access-only-trails',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ACT_ACCESS_ONLY_TRAIL_FILTER,
          minzoom: 11,
          layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
          paint: {
            'line-color': '#475569',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 14, 2.4, 18, 5.5],
            'line-opacity': 0.55,
            'line-dasharray': [1.1, 1.25],
          },
        });
        map.addLayer({
          id: 'lts-dismount-casing',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['==', ['get', 'feature_kind'], 'dismount'],
          minzoom: 10,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 14, 5.5, 18, 11],
            'line-opacity': 0.9,
          },
        });
        map.addLayer({
          id: 'lts-dismount',
          type: 'line',
          source: 'lts-network',
          'source-layer': 'lts',
          filter: ['==', ['get', 'feature_kind'], 'dismount'],
          minzoom: 10,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': '#6b7280',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, 3.2, 18, 7],
            'line-opacity': 0.98,
            'line-dasharray': [1.5, 1],
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
          id: 'lts-approved-casing',
          type: 'line',
          source: 'lts-approved',
          filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 14, 7, 18, 13],
            'line-opacity': 0.9,
          },
        });
        map.addLayer({
          id: 'lts-approved-line',
          type: 'line',
          source: 'lts-approved',
          filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': approvedColourExpression,
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 14, 4.5, 18, 9],
            'line-opacity': 0.98,
          },
        });
        map.addLayer({
          id: 'lts-approved-point',
          type: 'circle',
          source: 'lts-approved',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': approvedColourExpression,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 7],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        map.addLayer({
          id: 'lts-comparison-route-line',
          type: 'line',
          source: 'lts-comparison-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#475569',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 10],
            'line-opacity': 0.62,
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
            'circle-color': ['match', ['get', 'role'], 'start', '#16a34a', 'finish', '#dc2626', '#2563eb'],
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

        const interactiveLayers = ['lts-crossings', 'lts-dismount', 'lts-act-access-only-trails', 'lts-unverified-trails', 'lts-mtb-trails', 'lts-unsealed', 'lts-segments-low-confidence', 'lts-segments'];
        const availableInteractiveLayers = () => interactiveLayers.filter((layerId) => Boolean(map.getLayer(layerId)));
        map.on('mousemove', (event) => {
          const layers = availableInteractiveLayers();
          map.getCanvas().style.cursor = routeModeRef.current || (layers.length > 0 && map.queryRenderedFeatures(event.point, { layers }).length > 0)
            ? 'pointer'
            : '';
        });
        map.on('click', (event: MapMouseEvent) => {
          if (routeModeRef.current) {
            routeClickRef.current([event.lngLat.lng, event.lngLat.lat]);
            return;
          }
          if (selectionSavingRef.current) return;
          const layers = availableInteractiveLayers();
          const extending = event.originalEvent.shiftKey || multiSelectRef.current;
          // Endpoint circles sit above roads. In multi-select, ignore these
          // non-votable hits and use a small forgiving road hit area instead.
          const exactHits = layers.length > 0 ? map.queryRenderedFeatures(event.point, { layers }) : [];
          const nearbyHits = layers.length > 0 ? map.queryRenderedFeatures([
            [event.point.x - 7, event.point.y - 7],
            [event.point.x + 7, event.point.y + 7],
          ], { layers }) : [];
          const candidates = [...exactHits, ...nearbyHits];
          let feature = extending
            ? candidates.find((candidate) => voteSegmentFromFeature(candidate, datasetKey, metadataRef.current) !== null)
            : exactHits[0] ?? nearbyHits[0];
          let segment = feature ? voteSegmentFromFeature(feature, datasetKey, metadataRef.current) : null;
          if (feature && segment) {
            // Vector tiles clip the same OSM way into multiple features. Gather
            // every loaded fragment, not just the one under the pointer.
            const parts = map.querySourceFeatures('lts-network', { sourceLayer: 'lts' })
              .filter((part) => voteSegmentFromFeature(part, datasetKey, metadataRef.current)?.segmentId === segment!.segmentId);
            const lines = parts.flatMap((part) => part.geometry.type === 'LineString' ? [part.geometry.coordinates]
              : part.geometry.type === 'MultiLineString' ? part.geometry.coordinates : []);
            if (lines.length) {
              const unique = [...new Map(lines.map((line) => [JSON.stringify(line), line])).values()];
              feature = { ...feature, geometry: { type: 'MultiLineString', coordinates: unique } } as MapGeoJSONFeature;
              segment = { ...segment, geometry: feature.geometry };
            }
          }
          if (extending) {
            if (!feature || !segment) return;
            selectionRef.current = toggleSegment(selectionRef.current, { segment, feature });
            feature = selectionRef.current[0]?.feature;
          } else {
            selectionRef.current = feature && segment ? [{ segment, feature }] : [];
          }
          setVoteSelection(selectionRef.current.map((entry) => entry.segment));
          setSelected(feature ? feature.properties as FeatureProperties : null);
          setSelectedVoteSegment(selectionRef.current[0]?.segment ?? null);
          setSelectedDismountSegment(feature ? dismountReportSegmentFromFeature(feature, datasetKey, metadataRef.current) : null);
          setSelectedStreetViewPoint(feature ? [event.lngLat.lng, event.lngLat.lat] : null);
          (map.getSource('lts-selected') as maplibregl.GeoJSONSource)
            .setData(selectionRef.current.length ? {
              type: 'FeatureCollection',
              features: selectionRef.current.flatMap((entry) => selectedGeoJson(entry.feature).features),
            } : selectedGeoJson(feature));
        });
        const approvedParams = new URLSearchParams({ dataset: datasetKey, approved: '1' });
        fetch(ltsAppPath(`/api/lts-votes?${approvedParams}`), { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`Approved segments returned ${response.status}`);
            return response.json();
          })
          .then((approved: GeoJSON.FeatureCollection) => {
            (map.getSource('lts-approved') as maplibregl.GeoJSONSource | undefined)?.setData(approved);
          })
          .catch((error) => console.warn('[LTS approved overlay]', error));
        syncSatelliteOverlay(map, satelliteEnabledRef.current, satelliteOpacityRef.current);
        setMapLoading(false);
    });

    return () => {
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      removeProtocol('pmtiles');
    };
  }, [activeDataset.center, activeDataset.dataUrl, activeDataset.zoom, datasetKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('lts-segments')) return;
    const levels = [...visibleLts];
    const baseFilter: maplibregl.FilterSpecification = [
      'all',
      ['==', ['get', 'feature_kind'], 'segment'],
      ['in', ['get', 'lts'], ['literal', levels]],
    ];
    map.setFilter('lts-segments-low-confidence', [
      ...baseFilter,
      ['!=', ['get', 'is_unsealed'], true],
      ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]],
      ['==', ['get', 'confidence'], 'low'],
    ] as maplibregl.FilterSpecification);
    map.setFilter('lts-segments', [
      ...baseFilter,
      ['!=', ['get', 'is_unsealed'], true],
      ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]],
      ['!=', ['get', 'confidence'], 'low'],
    ] as maplibregl.FilterSpecification);
    const unsealedFilter: maplibregl.FilterSpecification = [
      ...baseFilter,
      ['==', ['get', 'is_unsealed'], true],
      ['!', ['all', ['in', ['get', 'highway'], ['literal', ['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway']]], ['any', ['==', ['get', 'is_mtb'], true], ['in', ['get', 'trail_routing'], ['literal', ['caution', 'avoid']]]]]],
      ...(showLowConfidence ? [] : [['!=', ['get', 'confidence'], 'low']]),
    ] as maplibregl.FilterSpecification;
    map.setFilter('lts-unsealed-casing', unsealedFilter);
    map.setFilter('lts-unsealed', unsealedFilter);
    map.setLayoutProperty('lts-segments-low-confidence', 'visibility', showLowConfidence ? 'visible' : 'none');
    map.setFilter('lts-crossings', [
      'all',
      ['==', ['get', 'feature_kind'], 'crossing'],
      ['in', ['get', 'lts'], ['literal', levels]],
    ]);
    map.setLayoutProperty('lts-crossings', 'visibility', showCrossings ? 'visible' : 'none');
    map.setLayoutProperty('lts-mtb-trails-casing', 'visibility', showMtbTrails ? 'visible' : 'none');
    map.setLayoutProperty('lts-mtb-trails', 'visibility', showMtbTrails ? 'visible' : 'none');
    const trailFilter = unverifiedTrailFilter(datasetKey === 'act');
    map.setFilter('lts-unverified-trails-casing', trailFilter);
    map.setFilter('lts-unverified-trails', trailFilter);
    map.setLayoutProperty('lts-unverified-trails-casing', 'visibility', showUnverifiedTrails ? 'visible' : 'none');
    map.setLayoutProperty('lts-unverified-trails', 'visibility', showUnverifiedTrails ? 'visible' : 'none');
    const showActAccessOnly = datasetKey === 'act' && showActAccessOnlyTrails;
    map.setLayoutProperty('lts-act-access-only-trails-casing', 'visibility', showActAccessOnly ? 'visible' : 'none');
    map.setLayoutProperty('lts-act-access-only-trails', 'visibility', showActAccessOnly ? 'visible' : 'none');
    map.setLayoutProperty('lts-dismount-casing', 'visibility', showDismountLinks ? 'visible' : 'none');
    map.setLayoutProperty('lts-dismount', 'visibility', showDismountLinks ? 'visible' : 'none');
  }, [datasetKey, showActAccessOnlyTrails, showCrossings, showDismountLinks, showLowConfidence, showMtbTrails, showUnverifiedTrails, visibleLts]);

  useEffect(() => {
    satelliteEnabledRef.current = satelliteEnabled;
    satelliteOpacityRef.current = satelliteOpacity;
    const map = mapRef.current;
    if (!map?.getLayer('road-labels')) return;
    syncSatelliteOverlay(map, satelliteEnabled, satelliteOpacity);
  }, [satelliteEnabled, satelliteOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('lts-route-line')) return;
    map.setPaintProperty('lts-route-line', 'line-opacity', transparentRoutes ? 0.48 : 1);
    map.setPaintProperty('lts-route-casing', 'line-opacity', transparentRoutes ? 0.26 : 0.94);
    map.setPaintProperty('lts-comparison-route-line', 'line-opacity', transparentRoutes ? 0.34 : 0.62);
  }, [transparentRoutes]);

  useEffect(() => {
    if (!showAbout) return undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    aboutCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowAbout(false);
      }
      if (event.key === 'Tab') {
        const controls = Array.from(aboutDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ) || []).filter((element) => element.getClientRects().length > 0);
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus();
    };
  }, [showAbout]);

  useEffect(() => {
    const query = placeQuery.trim();
    const requestId = ++placeSearchRequestIdRef.current;
    if (query.length < 3) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPlaceSearchLoading(true);
      setPlaceSearchError(null);
      setLocationError(null);
      try {
        const response = await fetch(placeSearchUrl(query, mapRef.current), { signal: controller.signal });
        const result = await response.json() as { results?: PlaceSearchResult[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Place search failed.');
        if (requestId !== placeSearchRequestIdRef.current) return;
        const results = result.results || [];
        setPlaceResults(results);
        setPlaceSearchError(results.length ? null : 'No Australian places matched that search.');
      } catch (error) {
        if (controller.signal.aborted || requestId !== placeSearchRequestIdRef.current) return;
        setPlaceResults([]);
        setPlaceSearchError(error instanceof Error ? error.message : 'Place search failed.');
      } finally {
        if (requestId === placeSearchRequestIdRef.current) setPlaceSearchLoading(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [placeQuery]);

  const selectedOsmId = selected?.osm_id ? String(selected.osm_id) : null;

  useEffect(() => {
    if (!selectedOsmId) return;

    const controller = new AbortController();
    fetch(ltsAppPath(`/api/osm-feature?osmId=${encodeURIComponent(selectedOsmId)}`), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as OsmFeatureDetails & { error?: string };
        if (!response.ok) throw new Error(body.error || `OSM lookup returned ${response.status}`);
        return body;
      })
      .then((details) => {
        setOsmFeatureDetails(details);
        setOsmFeatureError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOsmFeatureError({
          osmId: selectedOsmId,
          message: error instanceof Error ? error.message : 'Could not load OSM tags.',
        });
      });

    return () => controller.abort();
  }, [selectedOsmId]);

  const selectedLtsValue = selected ? Number(selected.lts) : Number.NaN;
  const selectedLts = Number.isFinite(selectedLtsValue) ? selectedLtsValue : null;
  const selectedIsDismount = selected?.feature_kind === 'dismount';
  const selectedOsmUrl = selected ? osmUrl(selected) : null;
  const selectedTrafficFreshness = selected ? trafficFreshness(selected.traffic_year) : null;
  const selectedOsmFeatureDetails = osmFeatureDetails?.osmId === selectedOsmId ? osmFeatureDetails : null;
  const selectedOsmFeatureError = osmFeatureError?.osmId === selectedOsmId ? osmFeatureError.message : null;
  const osmFeatureLoading = Boolean(selectedOsmId && !selectedOsmFeatureDetails && !selectedOsmFeatureError);
  const selectedBikeAccess = selected && selectedOsmFeatureDetails
    ? assessBikeAccess(selectedOsmFeatureDetails.tags, String(selected.highway || ''))
    : null;
  const selectedBikeAccessClass = selectedIsDismount
    ? 'border-slate-300/30 bg-slate-300/10 text-slate-100'
    : selectedBikeAccess?.kind === 'designated'
    ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
    : selectedBikeAccess?.kind === 'permitted'
      ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
      : selectedBikeAccess?.kind === 'prohibited'
        ? 'border-red-300/30 bg-red-300/10 text-red-100'
        : 'border-amber-300/30 bg-amber-300/10 text-amber-100';
  const mobileRouteStatus = routeLoading
    ? 'Finding the lowest-stress route…'
    : routeError
      ? 'Route failed — open controls for details'
      : routePoints.length === 0
        ? 'Tap the map to place starting point A'
        : routePoints.length === 1
          ? 'Tap the map to place destination B'
          : displayedRouteSummary
            ? `${formatRouteDistance(displayedRouteSummary.distance_m)} · ${formatRouteTime(displayedRouteSummary.time_ms)}`
            : `${routePoints.length}-point route calculated`;

  const toggleRoutePlanning = () => {
    if (selectionSavingRef.current) return;
    multiSelectRef.current = false;
    setMultiSelect(false);
    setPanelFocus('route');
    const next = !routeMode;
    setRouteMode(next);
    setMapPanelExpanded(false);
    setSelected(null);
    selectionRef.current = [];
    setVoteSelection([]);
    setSelectedVoteSegment(null);
    setSelectedDismountSegment(null);
    setSelectedStreetViewPoint(null);
    (mapRef.current?.getSource('lts-selected') as maplibregl.GeoJSONSource | undefined)?.setData(selectedGeoJson());
    resetRouteHistory();
  };

  const searchPlaces = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = placeQuery.trim();
    if (query.length < 2) {
      setPlaceSearchError('Enter at least two characters.');
      setPlaceResults([]);
      return;
    }
    const requestId = ++placeSearchRequestIdRef.current;
    setPlaceSearchLoading(true);
    setPlaceSearchError(null);
    setLocationError(null);
    try {
      const response = await fetch(placeSearchUrl(query, mapRef.current));
      const result = await response.json() as { results?: PlaceSearchResult[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'Place search failed.');
      if (requestId !== placeSearchRequestIdRef.current) return;
      const results = result.results || [];
      setPlaceResults(results);
      if (!results.length) setPlaceSearchError('No Australian places matched that search.');
    } catch (error) {
      if (requestId !== placeSearchRequestIdRef.current) return;
      setPlaceResults([]);
      setPlaceSearchError(error instanceof Error ? error.message : 'Place search failed.');
    } finally {
      if (requestId === placeSearchRequestIdRef.current) setPlaceSearchLoading(false);
    }
  };

  const showPlace = (place: PlaceSearchResult) => {
    const map = mapRef.current;
    if (!map) return;
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = new maplibregl.Marker({ color: '#ec4899' })
      .setLngLat([place.longitude, place.latitude])
      .addTo(map);
    if (place.bounds) {
      map.fitBounds(
        [[place.bounds[0], place.bounds[1]], [place.bounds[2], place.bounds[3]]],
        { padding: 80, maxZoom: 16, duration: 900 },
      );
    } else {
      map.flyTo({ center: [place.longitude, place.latitude], zoom: 16, duration: 900 });
    }
    setPlaceResults([]);
    setPlaceSearchError(null);
    setSearchExpanded(false);
  };

  const findCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('This browser does not provide location access.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    setPlaceSearchError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const map = mapRef.current;
        if (map) {
          locationMarkerRef.current?.remove();
          locationMarkerRef.current = new maplibregl.Marker({ color: '#22c55e' })
            .setLngLat([coords.longitude, coords.latitude])
            .addTo(map);
          map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 16, duration: 900 });
        }
        setPlaceResults([]);
        setLocating(false);
      },
      (error) => {
        const messages: Record<number, string> = {
          1: 'Location permission was not granted.',
          2: 'Your current location is unavailable.',
          3: 'Finding your location timed out.',
        };
        setLocationError(messages[error.code] || 'Your current location could not be found.');
        setSearchExpanded(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-slate-950 text-white" onPointerDownCapture={() => { startupInteractionRef.current = true; }} onWheelCapture={() => { startupInteractionRef.current = true; }} onKeyDownCapture={() => { startupInteractionRef.current = true; }}>
      <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />
      {mapLoading && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/45">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/90 px-5 py-4 text-sm font-semibold text-slate-100 shadow-2xl">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            Loading the full-resolution LTS network…
          </div>
        </div>
      )}
      {satelliteEnabled && MAPBOX_PUBLIC_TOKEN && (
        <div className="absolute right-14 top-28 z-[9] rounded-lg bg-slate-950/75 px-2 py-1.5 shadow-lg backdrop-blur-sm md:right-3 md:top-20">
          <a href="https://www.mapbox.com/about/maps" target="_blank" rel="noreferrer" className="mapbox-attribution-logo" aria-label="Mapbox" />
          <div className="mt-1 flex max-w-[210px] flex-wrap gap-x-1.5 text-[8px] leading-tight text-white/80">
            <a href="https://www.mapbox.com/about/maps" target="_blank" rel="noreferrer" className="hover:text-white">© Mapbox</a>
            <a href="https://www.openstreetmap.org/copyright/" target="_blank" rel="noreferrer" className="hover:text-white">© OpenStreetMap</a>
            <a href="https://www.mapbox.com/contribute/" target="_blank" rel="noreferrer" className="font-semibold hover:text-white">Improve this map</a>
            <a href="https://www.maxar.com/" target="_blank" rel="noreferrer" className="hover:text-white">© Maxar</a>
          </div>
        </div>
      )}

      <header className="lts-surface mobile-map-header lts-open-header absolute left-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 shadow-2xl md:left-4 md:right-4 md:flex-nowrap md:gap-3 md:px-4">
        <div className="shrink-0"><img src={process.env.NODE_ENV === 'production' ? 'https://australian-lts-lab.vercel.app/ausbug-logo-transparent.png' : '/ausbug-logo-transparent.png'} alt="AusBUG" width={40} height={40} className="h-10 w-10 object-contain" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold md:text-base" title={activeDataset.title}>AusBUG <span className="font-normal text-slate-400">LTS map</span></h1>
        </div>
        <select
          value={datasetKey}
          onChange={(event) => {
            if (selectionSavingRef.current) return;
            multiSelectRef.current = false;
            setMultiSelect(false);
            setMapLoading(true);
            setMetadata(null);
            metadataRef.current = null;
            setMapError(null);
            setDatasetKey(event.target.value as DatasetKey);
            setShowActAccessOnlyTrails(false);
            setRouteMode(false);
            setMapPanelExpanded(false);
            setSearchExpanded(false);
            resetRouteHistory();
            setSelected(null);
            selectionRef.current = [];
            setVoteSelection([]);
            setSelectedVoteSegment(null);
            setSelectedDismountSegment(null);
            setSelectedStreetViewPoint(null);
            setPlaceResults([]);
            setPlaceSearchError(null);
            setLocationError(null);
          }}
          aria-label="LTS dataset"
          className="lts-region rounded-lg border border-white/10 bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-100 md:ml-auto"
        >
          {Object.entries(DATASETS).map(([key, dataset]) => <option key={key} value={key}>{dataset.label}</option>)}
        </select>
        <CommunityActivity onShowRoad={(dataset, center) => {
          if (selectionSavingRef.current) return;
          if (!Object.prototype.hasOwnProperty.call(DATASETS, dataset)) return;
          setShowAbout(false);
          setMapPanelExpanded(false);
          setSearchExpanded(false);
          if (dataset === datasetKey) {
            mapRef.current?.flyTo({ center, zoom: 16 });
          } else {
            startupViewRef.current = { dataset: dataset as DatasetKey, center };
            setRouteMode(false);
            resetRouteHistory();
            setSelected(null);
            selectionRef.current = [];
            setVoteSelection([]);
            setMapLoading(true);
            setDatasetKey(dataset as DatasetKey);
          }
        }} />
        <button
          type="button"
          onClick={() => setShowAbout(true)}
          aria-label="About LTS levels and scoring"
          aria-haspopup="dialog"
          aria-expanded={showAbout}
          aria-controls={showAbout ? 'lts-about-dialog' : undefined}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-200 hover:bg-white/10 sm:w-auto sm:gap-1.5 sm:px-2.5"
        >
          <Info className="h-4 w-4" />
          <span className="hidden sm:inline">About</span>
        </button>
      </header>

      <nav className="lts-surface lts-action-pill" aria-label="Map actions">
        <button type="button" aria-expanded={searchExpanded} onClick={() => { setSearchExpanded(!searchExpanded); setMapPanelExpanded(false); }}><Search className="h-4 w-4" /><span>Search</span></button>
        <button type="button" aria-expanded={mapPanelExpanded && panelFocus === 'route'} disabled={!activeDataset.routable} onClick={() => { if (!routeMode) toggleRoutePlanning(); setPanelFocus('route'); setMapPanelExpanded(true); setSearchExpanded(false); }}><RouteIcon className="h-4 w-4" /><span>Plan route</span></button>
        <button type="button" aria-expanded={mapPanelExpanded && panelFocus === 'layers'} onClick={() => { setMapPanelExpanded(!(mapPanelExpanded && panelFocus === 'layers')); setPanelFocus('layers'); setSearchExpanded(false); }}><Layers3 className="h-4 w-4" /><span>Layers</span></button>
      </nav>

      <button type="button" className="lts-surface lts-locate" onClick={findCurrentLocation} disabled={locating} aria-label="Find my location">{locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}</button>

      {searchExpanded &&
      <section className={`lts-surface lts-search absolute left-3 top-[7.25rem] z-10 md:left-[22rem] md:top-24 ${searchExpanded ? 'right-14 md:right-16 md:max-w-md' : ''}`} aria-label="Find a place on the map">
        {searchExpanded ? (
          <form onSubmit={searchPlaces} className="rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-1.5">
              <Search className="ml-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <label htmlFor="map-place-search" className="sr-only">Search for an Australian place or address</label>
              <input
                id="map-place-search"
                type="search"
                value={placeQuery}
                onChange={(event) => {
                  setPlaceQuery(event.target.value);
                  setPlaceResults([]);
                  setPlaceSearchError(null);
                  setPlaceSearchLoading(false);
                }}
                placeholder="Start typing a suburb, road or place…"
                autoComplete="off"
                autoFocus
                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={placeSearchLoading || placeQuery.trim().length < 2}
                className="flex h-10 shrink-0 items-center justify-center rounded-lg bg-white px-3 text-xs font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {placeSearchLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Searching" /> : 'Search'}
              </button>
              <button
                type="button"
                onClick={findCurrentLocation}
                disabled={locating}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-300/30 bg-emerald-300/10 text-emerald-300 transition hover:bg-emerald-300/20 disabled:cursor-wait disabled:opacity-50"
                aria-label="Find my current location"
                title="Find my current location"
              >
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchExpanded(false);
                  setPlaceResults([]);
                  setPlaceSearchError(null);
                  setLocationError(null);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Minimise place search"
                title="Minimise place search"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {placeResults.length > 0 && (
              <div className="mt-1.5 overflow-hidden rounded-lg border border-white/10 bg-slate-950" role="listbox" aria-label="Place search results">
                {placeResults.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => showPlace(place)}
                    className="flex w-full items-start gap-2 border-b border-white/10 px-3 py-2.5 text-left text-xs leading-relaxed text-slate-200 transition last:border-0 hover:bg-white/10"
                    role="option"
                    aria-selected="false"
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pink-400" />
                    <span>{place.name}</span>
                  </button>
                ))}
                <p className="px-3 py-1.5 text-[9px] text-slate-500">Search © OpenStreetMap contributors</p>
              </div>
            )}
            {(placeSearchError || locationError) && (
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-rose-300" role="status">{placeSearchError || locationError}</p>
            )}
          </form>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSearchExpanded(true)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-slate-950/95 text-slate-200 shadow-2xl backdrop-blur transition hover:bg-slate-900 hover:text-white"
              aria-label="Open place search"
              aria-expanded="false"
              title="Search for a place"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={findCurrentLocation}
              disabled={locating}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-300/30 bg-slate-950/95 text-emerald-300 shadow-2xl backdrop-blur transition hover:bg-slate-900 disabled:cursor-wait disabled:opacity-50"
              aria-label="Find my current location"
              title="Find my current location"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
            </button>
          </div>
        )}
      </section>}

      {(mapPanelExpanded || routeMode) && <aside className={`lts-surface mobile-map-panel ${mapPanelExpanded ? 'lts-panel-open' : 'lts-route-chip'} absolute left-3 z-10 md:bottom-auto md:left-4 md:top-24 ${mapPanelExpanded ? 'max-h-[calc(100dvh-8rem)] w-[calc(100%-1.5rem)] max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur md:w-80 md:overflow-y-auto md:rounded-xl md:p-4' : 'w-auto rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur'}`}>
        {!mapPanelExpanded ? (
          <button
            type="button"
            onClick={() => setMapPanelExpanded(true)}
            className="flex min-h-11 max-w-[17rem] items-center gap-2 rounded-lg px-3 text-sm font-bold text-slate-100 transition hover:bg-white/10"
            aria-expanded="false"
            aria-controls="map-controls"
          >
            <Layers3 className="h-4 w-4 shrink-0 text-cyan-300" />
            <span className="truncate">{routeMode ? mobileRouteStatus : 'Layers & route'}</span>
            <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        ) : (
          <>
        <div className="md:hidden">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600" aria-hidden="true" />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            {activeDataset.routable ? (
              <button
                type="button"
                onClick={toggleRoutePlanning}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition ${routeMode ? 'bg-emerald-400 text-slate-950' : 'bg-white text-slate-950 hover:bg-emerald-100'}`}
              >
                <RouteIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{routeMode ? 'Exit routing' : 'Plan a low-stress route'}</span>
              </button>
            ) : (
              <div className="flex min-h-11 items-center rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100">{activeDataset.label} map only</div>
            )}
            <button
              type="button"
              onClick={() => setMapPanelExpanded(false)}
              aria-expanded="true"
              aria-controls="map-controls"
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              <Layers3 className="h-4 w-4" />
              Hide
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div id="map-controls" className="mt-2 block max-h-[calc(100dvh-15rem)] overflow-y-auto px-1 pb-1 md:mt-0 md:max-h-none md:overflow-visible md:px-0 md:pb-0">
        <div className="mb-3 hidden items-center justify-between gap-3 md:flex">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Map & route</p>
          <button
            type="button"
            onClick={() => setMapPanelExpanded(false)}
            className="flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Minimise map controls"
          >
            Hide <ChevronUp className="h-4 w-4" />
          </button>
        </div>
        {activeDataset.routable ? <button
          type="button"
          onClick={toggleRoutePlanning}
          className={`mb-4 hidden w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition md:flex ${routeMode ? 'bg-emerald-400 text-slate-950' : 'bg-white text-slate-950 hover:bg-emerald-100'}`}
        >
          <RouteIcon className="h-4 w-4" />
          {routeMode ? 'LTS routing active' : 'Plan a low-stress route'}
        </button> : (
          <div className="mb-4 hidden rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2.5 text-xs leading-relaxed text-sky-100 md:block">
            {activeDataset.label} is map-only while its classification is audited. Victoria and Queensland include experimental LTS routing.
          </div>
        )}

        {panelFocus === 'layers' && <section className="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-200">
              <input
                type="checkbox"
                checked={satelliteEnabled}
                disabled={!MAPBOX_PUBLIC_TOKEN}
                onChange={(event) => setSatelliteEnabled(event.target.checked)}
                className="h-4 w-4"
              />
              Satellite imagery
            </label>
            <span className="text-[11px] tabular-nums text-slate-400">{Math.round(satelliteOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={satelliteOpacity}
            disabled={!satelliteEnabled || !MAPBOX_PUBLIC_TOKEN}
            onChange={(event) => setSatelliteOpacity(Number(event.target.value))}
            aria-label="Satellite imagery opacity"
            className="mt-2 h-1.5 w-full cursor-pointer accent-sky-400 disabled:cursor-not-allowed disabled:opacity-35"
          />
          <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wide text-slate-500"><span>Transparent</span><span>Opaque</span></div>
          {!MAPBOX_PUBLIC_TOKEN && <p className="mt-2 text-[10px] text-amber-300">Satellite imagery is not configured in this environment.</p>}
        </section>}

        {routeMode && panelFocus === 'route' && (
          <section className="planner-route mb-4 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-300">
                  {routePoints.length === 0 && 'Click starting point A'}
                  {routePoints.length === 1 && 'Click destination B'}
                  {routePoints.length >= 2 && !routeLoading && !routeError && `${routePoints.length}-point route calculated`}
                  {routeLoading && 'Finding the lowest-stress route…'}
                  {routeError && 'Route failed'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {routePoints.length >= 2 && routePoints.length < MAX_ROUTE_POINTS
                    ? `Click the map to add point ${String.fromCharCode(65 + routePoints.length)}. Points are visited in order.`
                    : routePoints.length >= MAX_ROUTE_POINTS
                      ? `Maximum ${MAX_ROUTE_POINTS} points reached.`
                      : 'Higher-stress roads remain available only where needed to keep the journey connected.'}
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
                      if (routePointsRef.current.length >= 2) void requestRoute(routePointsRef.current, next);
                    }}
                    className="h-4 w-4"
                  />
                  Gravel / known unsealed surfaces
                </label>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={undoRouteEdit}
                disabled={routeHistoryIndex === 0}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
              <button
                type="button"
                onClick={redoRouteEdit}
                disabled={routeHistoryIndex >= routeHistoryLength - 1}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Redo2 className="h-3.5 w-3.5" /> Redo
              </button>
              <button
                type="button"
                onClick={() => commitRoutePoints([])}
                disabled={routePoints.length === 0}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>

            {routeLoading && <div className="mt-3 h-1 overflow-hidden rounded bg-white/10"><div className="h-full w-1/2 animate-pulse rounded bg-emerald-400" /></div>}
            {routeError && <div className="mt-3 rounded-lg bg-red-500/15 p-3 text-sm text-red-300"><p>{routeError}</p><button type="button" onClick={() => void requestRoute(routePoints)} className="mt-2 min-h-11 rounded-lg border px-3">Try again</button></div>}

            {displayedRouteSummary && (
              <div className="mt-3">
                <div className="mb-3 rounded-lg border border-white/10 bg-slate-950/45 p-2.5 text-[11px]">
                  <p className="font-semibold text-slate-100">Route comparison</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => displayRoute('low-stress')}
                      className={`rounded-lg border p-2 text-left transition ${selectedRouteKind === 'low-stress' ? 'border-emerald-300/50 bg-emerald-300/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    >
                      {selectedRouteKind === 'low-stress'
                        ? <span className="block h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, #16a34a, #2563eb, #f59e0b, #dc2626)' }} />
                        : <span className="block border-t-[3px] border-slate-400 opacity-75" />}
                      <span className="mt-1.5 block font-semibold text-slate-100">Low-stress</span>
                      <span className="block text-slate-400">{routeSummary ? formatRouteDistance(routeSummary.distance_m) : '—'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => displayRoute('bike-profile')}
                      disabled={!routeComparison?.stress}
                      className={`rounded-lg border p-2 text-left transition disabled:cursor-wait disabled:opacity-55 ${selectedRouteKind === 'bike-profile' ? 'border-slate-300/60 bg-slate-300/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    >
                      {selectedRouteKind === 'bike-profile'
                        ? <span className="block h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, #16a34a, #2563eb, #f59e0b, #dc2626)' }} />
                        : <span className="block border-t-[3px] border-slate-400 opacity-75" />}
                      <span className="mt-1.5 block font-semibold text-slate-100">AusBUG Bike Paths</span>
                      <span className="block text-slate-400">
                        {comparisonScoring ? 'Scoring against map…' : routeComparison ? formatRouteDistance(routeComparison.summary.distance_m) : 'Unavailable'}
                      </span>
                    </button>
                  </div>
                  <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-slate-200">
                    <span>
                      <span className="block font-semibold">Transparent route lines</span>
                      <span className="block text-[10px] leading-relaxed text-slate-500">Reveal the stress network underneath.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={transparentRoutes}
                      onChange={(event) => setTransparentRoutes(event.target.checked)}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
                  <p className="mt-2 leading-relaxed text-slate-500">Select either route to colour it by LTS and show its stress breakdown. The other route becomes grey; overlapping streets sit underneath the selected route.</p>
                  {selectedRouteKind === 'bike-profile' && routeComparison?.stress && (
                    <p className="mt-2 text-slate-400">Matched to {routeComparison.stress.coverage_pct}% of the visible LTS network.</p>
                  )}
                  {routeComparisonError && <p className="mt-2 text-amber-300/80">Comparison unavailable: {routeComparisonError}</p>}
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-lg font-bold">{formatRouteDistance(displayedRouteSummary.distance_m)}</span>
                  <span className="text-sm text-slate-300">{formatRouteTime(displayedRouteSummary.time_ms)}</span>
                  {routeClassifier && <span className="ml-auto text-[9px] text-slate-500">{routeClassifier}</span>}
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10">
                  {ROUTE_LTS_LEVELS.map((level) => (
                    <span
                      key={level}
                      style={{
                        width: `${displayedRouteSummary.percentage_by_lts[String(level)] || 0}%`,
                        backgroundColor: LTS_COLOURS[level],
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px] text-slate-400">
                  {ROUTE_LTS_LEVELS.map((level) => (
                    <div key={level}>
                      <span className="font-semibold" style={{ color: LTS_COLOURS[level] }}>L{level}</span>
                      <br />{displayedRouteSummary.percentage_by_lts[String(level)] || 0}%
                    </div>
                  ))}
                </div>
                {selectedRouteKind === 'bike-profile' && (routeComparison?.stress?.unknown_distance_m || 0) > 0 && (
                  <p className="mt-3 rounded-lg border border-slate-400/20 bg-slate-400/10 px-2.5 py-2 text-xs text-slate-300">
                    {formatRouteDistance(routeComparison!.stress!.unknown_distance_m)} could not be matched confidently to the loaded LTS map and remains grey rather than being assigned a guessed stress level.
                  </p>
                )}
                {displayedRouteSummary.known_unsealed_distance_m > 0 && (
                  <p className="mt-3 rounded-lg bg-white/10 px-2.5 py-2 text-xs text-slate-200">
                    Known unsealed: <strong>{formatRouteDistance(displayedRouteSummary.known_unsealed_distance_m)}</strong>
                  </p>
                )}
                {displayedRouteSummary.mtb_caution_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-purple-400/25 bg-purple-400/10 px-2.5 py-2 text-xs text-purple-100">
                    Includes {formatRouteDistance(displayedRouteSummary.mtb_caution_distance_m)} carrying easy or unspecified MTB evidence. This terrain may not suit a commuter bike.
                  </p>
                )}
                {displayedRouteSummary.technical_mtb_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-2 text-xs text-red-100">
                    Warning: {formatRouteDistance(displayedRouteSummary.technical_mtb_distance_m)} is explicitly technical MTB terrain.
                  </p>
                )}
                {displayedRouteSummary.unverified_trail_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-stone-400/25 bg-stone-400/10 px-2.5 py-2 text-xs text-stone-100">
                    Includes {formatRouteDistance(displayedRouteSummary.unverified_trail_distance_m)} of path/track without explicit cycling evidence. Check local signs and conditions.
                  </p>
                )}
                {displayedRouteSummary.hiking_only_distance_m > 0 && (
                  <p className="mt-2 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-2 text-xs text-red-100">
                    Warning: {formatRouteDistance(displayedRouteSummary.hiking_only_distance_m)} carries hiking-difficulty evidence without cycling evidence.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <button type="button" onClick={() => setShowAbout(true)} className="mb-3 min-h-11 text-sm font-semibold text-cyan-300">What do these colours mean?</button>
        {panelFocus === 'layers' && <>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Stress levels</h2>
            <p className="text-xs text-slate-400">{routeMode ? 'The background network remains inspectable after routing.' : 'Click a road to inspect and vote; crossings remain inspectable.'}</p>
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
        <div className="grid grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm text-slate-200">
          <span className="h-4 w-4" aria-hidden="true" />
          <span className="h-1.5 w-8 rounded-full" style={{ background: LTS_VOTE_COLOURS[1.5] }} />
          <span>Community LTS 1.5 · quiet trafficable road</span>
        </div>
        <label className="flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showCrossings} onChange={(event) => setShowCrossings(event.target.checked)} className="h-4 w-4" />
          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-white bg-blue-500" /> Crossings (LTS-coloured, zoom 14+)
        </label>
        <label className="flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showLowConfidence} onChange={(event) => setShowLowConfidence(event.target.checked)} className="h-4 w-4" />
          <span className="w-8 shrink-0 rounded-full border-t-[6px] border-dashed border-green-500" /> Inferred / low-confidence roads
        </label>
        <label className="flex cursor-pointer items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showDismountLinks} onChange={(event) => setShowDismountLinks(event.target.checked)} className="h-4 w-4" />
          <span className="relative h-1.5 w-8 shrink-0 rounded-full bg-white"><span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-slate-500" /></span>
          <span>Dismount / walk-bike link</span>
        </label>
        <div className="grid grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm text-slate-200">
          <span className="h-4 w-4" aria-hidden="true" />
          <span className="relative h-1.5 w-8 rounded-full bg-white"><span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-blue-500" /></span>
          <span>Known unsealed (LTS-coloured dashes)</span>
        </div>
        <label className="grid cursor-pointer grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showMtbTrails} onChange={(event) => setShowMtbTrails(event.target.checked)} className="h-4 w-4" />
          <span className="w-8 rounded-full border-t-[6px] border-dashed border-purple-500" />
          <span>OSM-tagged MTB trail</span>
        </label>
        <label className="grid cursor-pointer grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm">
          <input type="checkbox" checked={showUnverifiedTrails} onChange={(event) => setShowUnverifiedTrails(event.target.checked)} className="h-4 w-4" />
          <span className="w-8 rounded-full border-t-[6px] border-dashed border-pink-500" />
          <span>Cycling suitability not confirmed</span>
        </label>
        {datasetKey === 'act' && (
          <label className="grid cursor-pointer grid-cols-[1rem_2rem_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={showActAccessOnlyTrails}
              onChange={(event) => setShowActAccessOnlyTrails(event.target.checked)}
              className="h-4 w-4"
            />
            <span className="relative h-1.5 w-8 rounded-full bg-white"><span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-slate-600" /></span>
            <span>Ordinary ACT paths &amp; forestry tracks</span>
          </label>
        )}
        {metadata && (
          <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
            <p>{metadata.segments.toLocaleString()} LTS segments · {(metadata.dismount_segments || 0).toLocaleString()} walk-bike links · {metadata.crossings.toLocaleString()} crossings · OSM snapshot {new Date(metadata.source_pbf_modified_at).toLocaleDateString('en-AU')}</p>
            {metadata.traffic_volume && (
              <p className="mt-1 text-sky-300/75">
                Traffic volume matched to {metadata.traffic_volume.matched_segments.toLocaleString()} segments ({metadata.traffic_volume.matched_distance_km.toLocaleString()} km) · {metadata.traffic_volume.uplifted_segments.toLocaleString()} raised
              </p>
            )}
          </div>
        )}
        </>}
        {mapError && <p className="mt-3 rounded-lg bg-red-500/15 p-2 text-xs text-red-300">{mapError}</p>}
        </div>
          </>
        )}
      </aside>}

      {!routeMode && selected && (selectedLts || selectedIsDismount || propertyIsTrue(selected.is_mtb)) && (
        <aside className="lts-surface absolute bottom-3 right-3 top-auto z-20 max-h-[70vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl backdrop-blur md:bottom-auto md:right-4 md:top-24 md:w-96">
          <button
            onClick={() => {
              if (selectionSavingRef.current) return;
              multiSelectRef.current = false;
              setMultiSelect(false);
              setSelected(null);
              selectionRef.current = [];
              setVoteSelection([]);
              setSelectedVoteSegment(null);
              setSelectedDismountSegment(null);
              setSelectedStreetViewPoint(null);
              const source = mapRef.current?.getSource('lts-selected') as maplibregl.GeoJSONSource | undefined;
              source?.setData(selectedGeoJson());
            }}
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close details"
            disabled={selectionSaving}
          ><X className="h-5 w-5" /></button>
          <div className="mb-4 flex items-center gap-3 pr-8">
            <span className={`flex h-12 w-12 items-center justify-center rounded-xl font-black text-white ${selectedIsDismount ? 'text-xs' : 'text-lg'}`} style={{ background: selectedLts ? LTS_COLOURS[selectedLts] : selectedIsDismount ? '#6b7280' : '#a855f7' }}>{selectedLts ? `L${selectedLts}` : selectedIsDismount ? 'WALK' : 'MTB'}</span>
            <div>
              <h2 className="font-bold">{String(selected.name || (selected.feature_kind === 'crossing' ? 'Crossing' : 'Unnamed road/path'))}</h2>
              <p className="text-sm" style={{ color: selectedLts ? LTS_COLOURS[selectedLts] : selectedIsDismount ? '#cbd5e1' : '#c084fc' }}>{selectedLts ? LTS_LABELS[selectedLts] : selectedIsDismount ? 'Dismount / walk bike' : 'MTB trail shown for context'}</p>
            </div>
          </div>
          {selectedStreetViewPoint && (
            <a
              href={googleStreetViewUrl(selectedStreetViewPoint)}
              target="_blank"
              rel="noreferrer"
              className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/10 px-3 text-sm font-bold text-sky-100 transition hover:border-sky-300/40 hover:bg-sky-300/20"
            >
              <MapPin className="h-4 w-4" />
              Open Street View
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {selectedVoteSegment && <>
            <div className="mb-3 rounded-lg border border-white/15 p-3 text-sm" role="status">
              <strong>{voteSelection.length} {voteSelection.length === 1 ? 'segment' : 'segments'} selected</strong>
              <p className="mt-1 text-xs">Hold Shift and click roads to add segments (up to {MAX_SELECTED_SEGMENTS}). Parts of the same OSM segment stay selected together. Click without Shift to start again.</p>
              <button type="button" disabled={selectionSaving} aria-pressed={multiSelect} className="mt-2 rounded-lg border px-3 py-2 text-xs font-bold" onClick={() => { multiSelectRef.current = !multiSelect; setMultiSelect(!multiSelect); }}>{multiSelect ? 'Finish selecting' : 'Select multiple segments'}</button>
              {multiSelect && <p className="mt-1 text-xs">Selection mode is on: click or tap segments to add them, then choose Finish selecting. Close this panel to clear the selection.</p>}
              {voteSelection.length >= MAX_SELECTED_SEGMENTS && <p className="mt-1 text-xs">Selection limit reached. Submit these before selecting more.</p>}
              {voteSelection.length > 1 && <p className="mt-1 text-xs">{[...new Set(voteSelection.map((item) => item.name))].join(' · ')}. The same ratings and explanation will apply to every selected segment.</p>}
            </div>
            <SegmentVote segment={selectedVoteSegment} segments={voteSelection} onSavingChange={(saving) => { selectionSavingRef.current = saving; setSelectionSaving(saving); }} onPublished={refreshApprovedOverlay} />
          </>}
          {selectedDismountSegment && <DismountReport segment={selectedDismountSegment} />}
          <div className="mt-3 rounded-lg bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedIsDismount ? 'Why this is grey' : 'Why this score'}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-200">{String(selected.reason || 'No explanation available')}</p>
          </div>
          {selectedOsmId && (
            <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.035] p-3" aria-labelledby="osm-access-heading">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="osm-access-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current OSM access</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Live tags can be newer than the OSM snapshot used to build this LTS score.</p>
                </div>
                {selectedOsmFeatureDetails?.updatedAt && (
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                    {new Date(selectedOsmFeatureDetails.updatedAt).toLocaleDateString('en-AU')}
                  </span>
                )}
              </div>
              {osmFeatureLoading && <p className="mt-3 text-sm text-slate-300">Loading OpenStreetMap tags…</p>}
              {selectedOsmFeatureError && <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 p-2 text-xs text-amber-100">{selectedOsmFeatureError}</p>}
              {selectedBikeAccess && (
                <div className={`mt-3 rounded-lg border p-3 ${selectedBikeAccessClass}`}>
                  <p className="text-sm font-black">Bike access: {selectedBikeAccess.label}</p>
                  <p className="mt-1 text-xs leading-relaxed opacity-90">{selectedBikeAccess.detail}</p>
                </div>
              )}
              {selectedOsmFeatureDetails && (
                <details className="mt-3">
                  <summary className="min-h-11 cursor-pointer select-none py-3 text-sm font-bold text-sky-300">Show all {Object.keys(selectedOsmFeatureDetails.tags).length} OSM tags</summary>
                  {Object.keys(selectedOsmFeatureDetails.tags).length > 0 ? (
                    <dl className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg bg-slate-950/70 p-2 text-xs">
                      {orderedOsmTags(selectedOsmFeatureDetails.tags).map(([key, value]) => (
                        <div key={key} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] gap-2 border-b border-white/5 py-1.5 last:border-0">
                          <dt><code className="break-all text-cyan-300">{key}</code></dt>
                          <dd><code className="break-all text-slate-200">{value}</code></dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="rounded-lg bg-slate-950/70 p-2 text-xs text-slate-400">This OSM feature currently has no tags.</p>}
                </details>
              )}
            </section>
          )}
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
            <p className="mt-3 rounded-lg border border-pink-400/20 bg-pink-400/10 p-3 text-xs leading-relaxed text-pink-100">{String(selected.trail_reason)}</p>
          )}
          {selectedOsmUrl && <a href={selectedOsmUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex text-sm font-semibold text-sky-400 hover:text-sky-300">Inspect this feature in OpenStreetMap →</a>}
        </aside>
      )}


      {showAbout && (
        <div
          id="lts-about-dialog"
          ref={aboutDialogRef}
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:p-3 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lts-about-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowAbout(false);
          }}
        >
          <section className="lts-surface relative h-full max-h-full w-full max-w-4xl overflow-y-auto border border-white/10 bg-slate-950 shadow-2xl sm:h-auto sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4 md:px-7">
              <div className="hidden rounded-xl bg-emerald-400/15 p-2.5 text-emerald-300 sm:block"><Info className="h-5 w-5" /></div>
              <div className="pr-10">
                <h2 id="lts-about-title" className="text-lg font-bold sm:text-xl">About the AusBUG LTS map</h2>
                <p className="mt-1 text-sm text-slate-400">Calmer streets. Better connections. Local knowledge.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAbout(false)}
                ref={aboutCloseRef}
                className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white sm:right-4 sm:top-4"
                aria-label="Close about panel"
              ><X className="h-5 w-5" /></button>
            </div>

            <div className="lts-about-content space-y-6 px-4 py-5 text-base leading-relaxed text-slate-300 sm:px-5 sm:py-6 md:px-7 md:py-7">
              <section aria-labelledby="about-purpose">
                <h3 id="about-purpose" className="text-2xl font-bold text-white">Help build Australia’s unofficial bike highways</h3>
                <p className="mt-3">Our aim is to connect quiet streets, bike paths and better crossings into everyday cycling corridors—to school, work and beyond. This is a community mapping project, not an officially designated network.</p>
                <p className="mt-3">The data gives us a starting point. Local riders help reveal the missing links: a filtered street that bikes can pass through, a calmer crossing, or the better choice between two roads both rated LTS 2.</p>
              </section>
              <section className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-5" aria-labelledby="about-contribute">
                <h3 id="about-contribute" className="text-lg font-bold text-white">Know a road better than the map? Vote.</h3>
                <p className="mt-2">Select a road or path, sign in with your AusBUG account, and rate its traffic stress or rideability. Explain what you observed—reasons are required. Your display name and explanation are public; your email stays private.</p>
                <p className="mt-2">A vote is evidence, not permission to ignore signs or override the scoring rules. Restrictions and high-speed safeguards still apply.</p>
                <button type="button" onClick={() => { setShowAbout(false); setSearchExpanded(true); setMapPanelExpanded(false); }} className="mt-4 min-h-11 rounded-full bg-emerald-400 px-5 text-sm font-bold text-slate-950">Find a road and contribute</button>
              </section>
              <section>
                <h3 className="text-lg font-bold text-white">Read the map: traffic stress, not a safety guarantee</h3>
                <p className="mt-2">
                  LTS means Level of Traffic Stress. It estimates the stress of interacting with motor traffic. It does not establish bicycle access, surface quality or whether a route is safe for a particular rider.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {[1, 1.5, 2, 3, 4].map((level) => (
                    <div key={level} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                      <span className="lts-score-badge" style={{ background: LTS_COLOURS[level], color: level === 2 || level === 4 ? '#fff' : '#10202b' }}>L{level}</span>
                      <div><p className="font-semibold text-white">{LTS_LABELS[level]}</p><p className="text-sm text-slate-400">{level === 1 ? 'Very little interaction with motor traffic' : level === 1.5 ? 'Community-identified quieter road, informed by local knowledge' : level === 2 ? 'Lower-stress conditions for many adults' : level === 3 ? 'More traffic interaction; confident riders' : 'High-speed, high-volume or otherwise stressful conditions'}</p></div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-white/10 p-4">
                <p className="mt-3"><strong>Grey links:</strong> walk your bike where dismount is mapped. <strong>Rideability:</strong> a separate surface rating. <strong>Inferred:</strong> missing data has been filled using model assumptions, not verified on site.</p>
                <p className="mt-3">Always check signs, access and current conditions. Low traffic stress does not guarantee a suitable surface, an open route or a safe crossing.</p>
              </section>
              <h3 className="text-lg font-bold text-white">Behind the map</h3>
              <details className="about-detail">
                <summary>Data sources and map symbols</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">OpenStreetMap road network</p>
                    <p className="mt-1 text-xs text-slate-400">Road and path geometry, bicycle access, directional cycleways, separation, painted lanes, buffers, parking, speed limits, lane counts, explicit surfaces, MTB difficulty and route tags, one-way rules, roundabouts and crossings.</p>
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">OpenStreetMap attribution <ExternalLink className="h-3 w-3" /></a>
                  </div>
                  <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-4">
                    <p className="font-semibold text-white">{stateSourceCopy.trafficTitle}</p>
                    <p className="mt-1 text-xs text-slate-300">{stateSourceCopy.trafficDescription}</p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                      {stateSourceCopy.trafficLinks.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">{link.label} <ExternalLink className="h-3 w-3" /></a>)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <p className="font-semibold text-white">Official road details</p>
                    <p className="mt-1 text-xs text-slate-300">{stateSourceCopy.roadDescription}</p>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                      {stateSourceCopy.roadLinks.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">{link.label} <ExternalLink className="h-3 w-3" /></a>)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Map delivery</p>
                    <p className="mt-1 text-xs text-slate-400">The classified network is packaged with Tippecanoe into PMTiles and rendered with MapLibre over a simplified OpenFreeMap base map. An optional Mapbox Satellite overlay can be faded from transparent to opaque; it changes only the background imagery, never the classification or routing. White-backed LTS-coloured dashes indicate an explicitly tagged unsealed surface. Grey dashes identify <code>bicycle=dismount</code> walk-bike links and deliberately carry no LTS score. Short white-backed purple dashes identify OSM-tagged MTB trails. Short white-backed cyan dashes identify paths and tracks whose ordinary bicycle access or suitability is not confirmed; cyan takes visual precedence when both meanings apply. Off-road paths and tracks are already LTS 1 because traffic stress is separate from trail access and difficulty, so they do not repeat a green LTS foreground. Where an MTB relation follows an ordinary road, the road&apos;s normal LTS colour remains visible beneath the purple dashes.</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Experimental routing</p>
                    <p className="mt-1 text-xs text-slate-400">{activeDataset.routable ? (USING_LOCAL_ENRICHED_ROUTER ? <>Routes in this local Lab come from a separate traffic-enriched BRouter test instance using <code className="text-emerald-300">cyalts</code>. The production router and existing iOS and Android profiles remain unchanged.</> : <>Routes come from the live BRouter service using the additive <code className="text-emerald-300">cyalts</code> profile. Existing iOS and Android profiles remain unchanged.</>) : <>This statewide layer is map-only. It uses the shared classifier for inspection and comparison but has no LTS BRouter graph, cannot plan routes, and cannot change AusBUG navigation.</>}</p>
                    <a href="https://brouter.de/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-300 hover:text-sky-200">About BRouter <ExternalLink className="h-3 w-3" /></a>
                  </div>
                </div>
              </details>

              <details className="about-detail">
                <summary>How a road receives its score</summary>
                <p className="mt-3">The same rules apply across Australia. Start here, then expand a section for the detail.</p>
                <ol className="about-score-steps">
                  <li><strong>Check access.</strong><span>Check whether cycling is permitted. Dismount links are grey and have no LTS score.</span></li>
                  <li><strong>Assess each direction.</strong><span>Use speed, lanes and cycling facilities to set the base score.</span></li>
                  <li><strong>Apply community adjustments.</strong><span>LTS 4 roads use the average of the base score and approved vote, rounded up. LTS 2 → 1.5 stays a direct adjustment.</span></li>
                  <li><strong>Display the result.</strong><span>The map shows the worse direction. Your route uses the direction you ride.</span></li>
                </ol>
                <details className="about-subdetail"><summary>Access, directions and evidence</summary>
                <div className="mt-3 space-y-2 text-slate-300">
                  <p>Every state and territory uses the same classifier and the exact rules below. What differs is which official datasets can fill gaps in OSM—not the meaning of an LTS level.</p>
                  <p>Each OSM way is assessed separately for the forward and backward cycling directions using Australian left-hand traffic. The map displays the more stressful permitted direction.</p>
                  <p>Direction matters because the two sides of a road can have different painted or protected cycle lanes, buffers, lane counts and speed tags. For Australian left-hand traffic, forward travel uses the left-side cycling treatment and backward travel uses the right-side treatment. Parking is currently a road-level door-zone flag rather than a fully directional input; its exact effect is stated below.</p>
                  <p>The background line deliberately shows the worse of the two permitted directions, while an active route shows the LTS for the direction being ridden. A route may therefore change a yellow background segment to blue when its side is safer, but the same shared classification should never change a blue background segment to yellow.</p>
                  <p>Before scoring, road/path class and access tags decide whether a way belongs in the cycling network: prohibited/private access and bicycle=no/private/use_sidepath are excluded. Dismount links are excluded from LTS scoring but can remain as grey walk-bike routing connections. Footways without explicit bicycle permission are normally excluded; in the ACT, where cycling on ordinary paths is legally permitted unless signed otherwise, they remain cautious routing links but are hidden from the map by default. An ACT footway, path or forestry track tagged only bicycle=yes is treated as legal access rather than proof of a designated cycling facility; highway=cycleway, bicycle=designated or official bicycle-route evidence keeps a link visible. One-way tags decide which travel directions are scored.</p>
                  <p>For an included direction, the segment score can be changed by only these inputs: road/path class; directional or general speed limit; directional or total motor-traffic lane count; roundabout status; cycling-facility type and side; whether a painted lane has a mapped buffer; mapped kerbside parking beside a painted lane; and matched all-vehicle daily motor traffic. Each rule is deterministic and is applied in the order shown below.</p>
                  <p>Traffic records are matched to OSM geometry using road name or route reference, projected distance, local direction and line overlap. Directional counts are doubled for a two-way OSM centreline to approximate conventional two-way daily traffic.</p>
                  {stateSourceCopy.methodology.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  <p>Surface, trail suitability and MTB evidence are separate from traffic stress. A road is called unsealed only when OSM has an explicit value such as gravel, dirt, ground or compacted; a missing surface is not guessed. Generic <code>path</code>, <code>track</code> and <code>bridleway</code> links need explicit bicycle access or bicycle-route evidence before they are treated as verified cycling links. Every explicit MTB tag or MTB route membership remains visible, even when routing rules exclude it.</p>
                </div>
                </details>
                <details className="about-subdetail"><summary>Base scores by road and cycling facility</summary>
                <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/10 text-slate-300"><tr><th className="px-3 py-2">Facility or road context</th><th className="px-3 py-2">Exact base LTS rule</th></tr></thead>
                    <tbody className="divide-y divide-white/10 align-top">
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Traffic-free path or protected lane</td><td className="px-3 py-2">LTS 1. This includes mapped cycleways/paths and on-road cycling treatments tagged as track, protected, separate or separated.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Dismount / walk-bike link</td><td className="px-3 py-2">No LTS score. A way tagged <code>bicycle=dismount</code> is shown grey and may remain routable with a strong penalty, but is not represented as permission to ride.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Slow local street</td><td className="px-3 py-2">A living street, or a local road at 30 km/h or less: LTS 1 with one lane per direction; LTS 2 with more. Roundabouts do not receive this shortcut.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Buffered painted lane</td><td className="px-3 py-2">LTS 2 at no more than 50 km/h and one lane per direction; LTS 3 at no more than 60 km/h and two lanes; otherwise LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Unbuffered painted lane</td><td className="px-3 py-2">LTS 2 at no more than 40 km/h and one lane per direction; LTS 3 at no more than 60 km/h and two lanes; otherwise LTS 4. Any mapped adjacent kerbside parking then adds one LTS level, capped at LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Shoulder</td><td className="px-3 py-2">LTS 2 at no more than 60 km/h and one lane per direction; LTS 3 at no more than 80 km/h; otherwise LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Local mixed traffic</td><td className="px-3 py-2">LTS 2 at no more than 50 km/h and one lane per direction; LTS 3 at no more than 60 km/h and two lanes; otherwise LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Tertiary/collector mixed traffic</td><td className="px-3 py-2">LTS 2 at no more than 40 km/h and one lane per direction; LTS 3 at no more than 60 km/h and one lane; otherwise LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Secondary, primary or trunk mixed traffic</td><td className="px-3 py-2">LTS 3 only when no more than 40 km/h with one lane per direction; otherwise LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Unprotected roundabout</td><td className="px-3 py-2">Never below LTS 3. It is LTS 3 only at no more than 50 km/h with one circulating lane; otherwise LTS 4.</td></tr>
                      <tr><td className="px-3 py-2 font-semibold text-slate-200">Sharrows</td><td className="px-3 py-2">Do not reduce stress by themselves. The ordinary mixed-traffic road-class, speed and lane rule still applies.</td></tr>
                    </tbody>
                  </table>
                </div>
                </details>
                <details className="about-subdetail"><summary>Missing speed and lane data</summary>
                <div className="mt-4 rounded-xl border border-slate-400/20 bg-slate-400/10 p-4 text-xs text-slate-200">
                  <h4 className="font-semibold text-white">When speed or lane data is missing</h4>
                  <p className="mt-2">The classifier marks the result as inferred and uses these explicit fallbacks: 20 km/h for living streets; 30 for service roads; 50 for residential, unclassified and generic roads; 60 for tertiary and secondary roads; 70 for primary roads; and 80 for trunk roads. Missing lanes default to two lanes per direction on primary/trunk roads and one on every other road. These are classification assumptions—not claims about the legal conditions on a particular street.</p>
                </div>
                </details>
                <details className="about-subdetail"><summary>Traffic volume and community safeguards</summary>
                <p className="mt-2">A floor is a minimum, not the final score. Speed, lanes or facilities can still make a quiet road score higher.</p>
                <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/10 text-slate-300"><tr><th className="px-3 py-2">Approximate daily motor traffic</th><th className="px-3 py-2">Mixed-traffic floor</th></tr></thead>
                    <tbody className="divide-y divide-white/10">
                      <tr><td className="px-3 py-2">Up to 2,000</td><td className="px-3 py-2"><span className="lts-score-badge lts-score-badge-small" style={{ background: LTS_COLOURS[1] }}>L1</span></td></tr>
                      <tr><td className="px-3 py-2">2,001–6,000</td><td className="px-3 py-2"><span className="lts-score-badge lts-score-badge-small" style={{ background: LTS_COLOURS[2], color: '#fff' }}>L2</span></td></tr>
                      <tr><td className="px-3 py-2">6,001–14,000</td><td className="px-3 py-2"><span className="lts-score-badge lts-score-badge-small" style={{ background: LTS_COLOURS[3] }}>L3</span></td></tr>
                      <tr><td className="px-3 py-2">Above 14,000</td><td className="px-3 py-2"><span className="lts-score-badge lts-score-badge-small" style={{ background: LTS_COLOURS[4], color: '#fff' }}>L4</span></td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-slate-400">Traffic volume is applied after the base rule. It may only raise a segment with no cycling facility, sharrows or a shoulder. It never lowers a score and currently does not alter a path, protected lane, buffered lane or painted lane. A low-confidence SCATS estimate may raise a segment by no more than one level.</p>
                <p className="mt-2 text-xs text-slate-400">Community-adjusted LTS 4 roads use (4 + approved vote) ÷ 2, rounded up, at every speed. Votes of 1, 1.5 or 2 give LTS 3; votes of 3 or 4 retain LTS 4. LTS 2 roads voted to 1.5 still become 1.5 directly. Speed limits and access restrictions are unchanged. Community adjustments are not independently verified safety assessments.</p>
                </details>
                <details className="about-subdetail"><summary>Crossings and what LTS does not measure</summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-4 text-xs text-sky-50">
                    <h4 className="font-semibold text-white">Crossing scores</h4>
                    <p className="mt-2">Crossings are point scores; they do not change the adjoining road&apos;s segment LTS. Signals are LTS 1 and refuge islands LTS 2. An uncontrolled crossing is at least LTS 2 and otherwise inherits the crossed road&apos;s LTS. A marked crossing is at least LTS 2 and is capped at LTS 3. When the crossed road is unknown, an uncontrolled crossing is LTS 3 and another marked crossing is LTS 2.</p>
                  </div>
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs text-amber-50">
                    <h4 className="font-semibold text-white">Recorded or used elsewhere—but not in segment LTS</h4>
                    <p className="mt-2">Heavy-vehicle percentage is retained for inspection but does not yet change LTS. Surface, gravel, MTB difficulty, hiking evidence and elevation affect display, eligibility or routing penalties—not the traffic-stress score. Bicycle volumes, crash history, rider popularity, road width and time-of-day conditions are not currently inputs. Apart from roundabouts and explicit crossing tags, intersection form is not yet modelled.</p>
                  </div>
                </div>
              </details>

              </details>
              <details className="about-detail">
                <summary>{activeDataset.routable ? 'How BRouter chooses a route' : 'Routing status'}</summary>
                {!activeDataset.routable && <p className="mt-2 rounded-xl border border-sky-400/20 bg-sky-400/10 p-4 text-sky-100">The statewide {activeDataset.label} map is map-only. Its visual classification and official-data matches are being audited before any BRouter segment build. It cannot plan routes or change production navigation.</p>}
                {activeDataset.routable && <>
                <p className="mt-2">The planner accepts up to 26 ordered points labelled A–Z. BRouter connects them in sequence, and every edit—including Clear—can be undone or redone.</p>
                <p className="mt-2">Each plan also requests the existing AusBUG <strong>Bike Paths</strong> route using the <code className="text-slate-300">cyabikepath</code> BRouter profile—the conservative profile used by the iOS and Android apps—for the same points and gravel setting. The route-comparison switch colours either result using the loaded directional LTS map while drawing the other as a semi-transparent solid grey line. The comparison profile&apos;s own routing cost is never presented as stress: its geometry is spatially matched back to the same map classifier, and any section that cannot be matched confidently remains grey and is reported as unscored.</p>
                <p className="mt-2">The <code className="text-emerald-300">cyalts</code> profile assigns widely separated routing costs: 1.0 for LTS 1, 1.4 for community LTS 1.5, 1.8 for LTS 2, 5.0 for LTS 3 and 15.0 for LTS 4. This strongly prefers low-stress links while allowing a higher-stress connection when otherwise necessary.</p>
                <p className="mt-2">The enriched routing segments carry the map classifier&apos;s forward and backward LTS values directly. BRouter uses the value for the travel direction; it does not independently reinterpret the road&apos;s lane or cycleway tags. The background line deliberately uses the worse direction, so a routed line can be safer—but not more stressful—when the lane or cycleway on the ridden side is better.</p>
                <p className="mt-2">Crossing dots are classified by the same rules and add point penalties equivalent to a 0 m, 20 m, 80 m or 250 m detour for LTS 1–4. This encourages the router to prefer signals, refuges and calmer crossings without making a difficult crossing an absolute barrier.</p>
                <p className="mt-2">The Gravel switch applies only to explicitly known unsealed surfaces. With Gravel off, those links receive a strong additional cost; unknown surfaces are not assumed unsealed. MTB trails with easy or unspecified difficulty remain connected but carry a strong commuter penalty. Trails tagged <code>mtb:scale=2</code> or higher, IMBA 2 or higher, downhill, freeride or trial are treated as clearly technical and excluded from commuter routing.</p>
                <p className="mt-2">A generic path, track or bridleway without explicit bicycle access or normal bicycle-route membership remains available only with an additional unverified-trail penalty. Hiking/foot route membership makes that warning more specific but does not prohibit cycling by itself. A <code>sac_scale</code> hiking-difficulty tag without positive cycling or MTB evidence is excluded from commuter routing.</p>
                <p className="mt-2">A link explicitly tagged <code>bicycle=dismount</code> remains connected with a strong penalty so a station crossing or short passage does not break the route. It is shown grey without an LTS score because the mapped instruction is to walk the bike, not ride it. Rider reports that signage is missing are saved for access verification and do not silently erase the OSM restriction.</p>
                <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/10 p-4">
                  <h4 className="font-semibold text-white">Handling unavoidable high-stress gaps</h4>
                  <p className="mt-2 text-xs text-violet-50">The values 1.0, 1.4, 1.8, 5.0 and 15.0 are deliberately separated experimental preference weights, not measured speeds, crash risks or final calibrated constants. Before other routing costs are considered, one kilometre at LTS 2, 3 or 4 therefore contributes roughly the same route cost as 1.8, 5 or 15 kilometres at LTS 1. The spacing makes the router mildly prefer LTS 1 over LTS 2, strongly avoid LTS 3 and treat LTS 4 as a last resort, while keeping every legal cycling connection available where the network has no practical alternative. These values still need comparison against routes chosen by riders.</p>
                  <p className="mt-2 text-xs text-violet-50">The model normally assumes the rider remains on the bicycle. The sole explicit exception is an OSM <code>bicycle=dismount</code> connector: the router may use it with a strong penalty and the map marks it grey as a walk-bike section. The current travel-time estimate does not yet separately model walking speed, so riders should allow extra time. LTS 4 still represents riding a stressful link; it is not a walking estimate.</p>
                </div>
                <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs text-amber-100">
                  {USING_LOCAL_ENRICHED_ROUTER
                    ? 'This local test uses separately built BRouter segments containing matched AADT classes, lane counts, parking, buffers, normalised cycleway tags, crossing scores and real elevation. Each directional road and crossing LTS value is precomputed by the same classifier that paints the map; ways excluded from the visible cycling network are also unavailable to the router. It has not been switched into production.'
                    : 'This Lab uses isolated, state-specific BRouter segment sets containing the same matched traffic, official road evidence, directional LTS, surface and trail rules, crossing scores and elevation used by the map. The AusBUG iOS and Android BRouter service remains separate and unchanged.'}
                </div>
                </>}
              </details>

              <details className="about-detail">
                <summary>Current {activeDataset.label} coverage</summary>
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
                {metadata?.nsw_speed_zones && (metadata.nsw_speed_zones.available_records || 0) > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    {(metadata.nsw_speed_zones.status_counts.matched || 0).toLocaleString()} segments received official speed evidence across {metadata.nsw_speed_zones.matched_distance_km.toLocaleString()} km · {(metadata.nsw_speed_zones.status_counts.ambiguous || 0).toLocaleString()} ambiguous matches quarantined
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
              </details>

              <details className="about-detail">
                <summary>Important limitations</summary>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">
                  <li>This is a diagnostic model, not a guarantee that a road is safe or presently open.</li>
                  <li>{stateSourceCopy.trafficLimitation}</li>
                  <li>Every matched traffic value retains its source, count period, methodology and confidence. Unmatched roads continue to use OSM-based inference.</li>
                  <li>{stateSourceCopy.speedLimitation}</li>
                  {datasetKey === 'victoria' && <li>The DTP bicycle layer is itself OSM-linked and may lag recent edits; it fills missing fields but never overwrites an explicit current OSM value.</li>}
                  <li>Surface, trail and MTB styling reflects OSM tags, which can be incomplete or wrong. Unknown surface stays unknown; unverified trails receive a warning/penalty; visual context is not a claim that a trail is suitable, legal, open or safe.</li>
                  <li>Crossings influence the experimental router through point penalties; the values still need rider testing and calibration.</li>
                  <li>Temporary works, congestion at a particular time, driver behaviour, sight distance and pavement condition may not be represented.</li>
                </ul>
              </details>

              <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-4 text-xs text-slate-500">
                <span>Map classifier: {metadata?.classifier_version || 'loading'}</span>
                <span>Router classifier: {activeDataset.routable ? (routeClassifier || DATASET_VERSION) : 'not enabled for this pilot'}</span>
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
