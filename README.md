# Australian Bicycle LTS Lab

A public, experimental Bicycle Level of Traffic Stress (LTS) map for Victoria and New South Wales.

The Lab classifies each rideable OpenStreetMap road or path separately by travel direction, then displays the more stressful permitted direction on the background map. Victoria also includes an experimental BRouter route planner. The About panel in the app documents the current rules, thresholds, data sources, routing costs, crossing penalties, limitations and freshness information.

## Status

This is research and diagnostic software. It is not safety advice, a guarantee that a link is legal or open, or a replacement for checking current conditions.

- Victoria: statewide diagnostic map and experimental routing.
- New South Wales: statewide diagnostic map; routing is intentionally disabled while the NSW graph is audited.
- NSW traffic evidence currently comes from the openly licensed Transport for NSW traffic-count dataset. Additional council datasets are only published after their reuse terms are confirmed.

## Run locally

Use Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set the PMTiles URLs in `.env.local`. The two generated PMTiles archives are intentionally not stored in Git because they are large. The small build metadata files are included.

## Environment variables

- `NEXT_PUBLIC_VICTORIA_PMTILES_URL`: public Victoria PMTiles archive with byte-range and CORS support.
- `NEXT_PUBLIC_NSW_PMTILES_URL`: public NSW PMTiles archive with byte-range and CORS support.
- `LTS_BROUTER_URL`: BRouter-compatible endpoint.
- `BROUTER_COMPARISON_URL`: existing AusBUG BRouter endpoint used for the mobile apps' conservative `cyabikepath` (Bike Paths) comparison route.
- `LTS_ROUTER_CLASSIFIER_VERSION`: classifier label returned by the route API.

## Data and attribution

- Road/path geometry and tags: © OpenStreetMap contributors, available under the ODbL.
- Victorian government and council sources: see the source links and build-specific counts in the app’s About panel.
- NSW traffic counts and speed zones: Transport for NSW open data, used under its published Creative Commons Attribution terms.
- Basemap: OpenFreeMap and OpenMapTiles data derived from OpenStreetMap, rendered with MapLibre GL JS.
- PMTiles reader: the official PMTiles JavaScript protocol library (BSD-3-Clause), bundled with the app.

Generated map archives are derivative datasets with their own source and attribution obligations. They are deployed separately from this code repository.

## Licence

Application code is licensed under Apache-2.0. That licence does not relicense source data, generated map archives, basemap content or third-party services.
