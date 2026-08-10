# Australian Bicycle LTS Lab

A public, experimental Bicycle Level of Traffic Stress (LTS) map for Australia.

The Lab classifies each rideable OpenStreetMap road or path separately by travel direction, then displays the more stressful permitted direction on the background map. Every published state and territory except the still-audited NSW graph includes an isolated experimental BRouter route planner. The About panel documents the current rules, thresholds, state-specific data sources, routing costs, crossing penalties, limitations and freshness information.

## Status

This is research and diagnostic software. It is not safety advice, a guarantee that a link is legal or open, or a replacement for checking current conditions.

- Victoria, Queensland, Western Australia, South Australia, ACT, Tasmania and Northern Territory: statewide or territory-wide diagnostic maps and isolated experimental routing.
- New South Wales: statewide diagnostic map; routing is intentionally disabled while the NSW graph is audited.
- Official traffic evidence is state-specific. WA, SA and Tasmania include suitable reusable traffic observations; ACT and NT currently use OSM and transparent inference because no maintained territory-wide geospatial AADT feed passed the road-level join contract.

## Run locally

Use Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set the PMTiles URLs in `.env.local`. Generated PMTiles archives are intentionally not stored in Git because they are large. The small build metadata files are included.

## Environment variables

- `NEXT_PUBLIC_VICTORIA_PMTILES_URL`: public Victoria PMTiles archive with byte-range and CORS support.
- `NEXT_PUBLIC_NSW_PMTILES_URL`: public NSW PMTiles archive with byte-range and CORS support.
- `NEXT_PUBLIC_QUEENSLAND_PMTILES_URL`, `NEXT_PUBLIC_WA_PMTILES_URL`, `NEXT_PUBLIC_SA_PMTILES_URL`, `NEXT_PUBLIC_ACT_PMTILES_URL`, `NEXT_PUBLIC_TASMANIA_PMTILES_URL`, `NEXT_PUBLIC_NT_PMTILES_URL`: equivalent state/territory PMTiles archives.
- `NEXT_PUBLIC_MAPBOX_TOKEN`: public Mapbox token used only when the optional satellite overlay is enabled.
- `LTS_BROUTER_URL`: isolated Victoria/Queensland BRouter-compatible endpoint.
- `LTS_BROUTER_WA_URL`, `LTS_BROUTER_SA_URL`, `LTS_BROUTER_ACT_URL`, `LTS_BROUTER_TAS_URL`, `LTS_BROUTER_NT_URL`: isolated state/territory routing endpoints. Separate stores prevent BRouter&apos;s five-degree tiles from overwriting neighbouring state data.
- `BROUTER_COMPARISON_URL`: existing AusBUG BRouter endpoint used for the mobile apps' conservative `cyabikepath` (Bike Paths) comparison route.
- `LTS_ROUTER_CLASSIFIER_VERSION`: classifier label returned by the route API.

## Firebase tile hosting

The production PMTiles archives are published separately from the application in
the Melbourne-based `cyaroutes.firebasestorage.app` Firebase Storage bucket under
`public/lts/`. Use content-versioned filenames because PMTiles responses are
cached as immutable. Apply the browser range-request policy before publishing:

```bash
gsutil cors set firebase-storage-cors.json gs://cyaroutes.firebasestorage.app
gcloud storage cp --cache-control='public,max-age=31536000,immutable' \
  --content-type='application/octet-stream' FILE.pmtiles \
  gs://cyaroutes.firebasestorage.app/public/lts/VERSIONED_FILE.pmtiles
gcloud storage objects update \
  gs://cyaroutes.firebasestorage.app/public/lts/VERSIONED_FILE.pmtiles \
  --add-acl-grant=entity=allUsers,role=READER
```

`firebase.tiles.json` retains a separately deployed Firebase Hosting mirror for
disaster recovery. The app does not use that mirror because cold range requests
for these large archives are substantially slower than Firebase Storage.

## Data and attribution

- Road/path geometry and tags: © OpenStreetMap contributors, available under the ODbL.
- Victorian government and council sources: see the source links and build-specific counts in the app’s About panel.
- NSW traffic counts and speed zones: Transport for NSW open data, used under its published Creative Commons Attribution terms.
- Queensland TMR, Main Roads WA, South Australian DIT, Tasmanian State Growth and national Harmonised Traffic Counts sources: see the exact source links, methods and accepted-record counts in each state&apos;s About panel.
- Basemap: OpenFreeMap and OpenMapTiles data derived from OpenStreetMap, rendered with MapLibre GL JS.
- PMTiles reader: the official PMTiles JavaScript protocol library (BSD-3-Clause), bundled with the app.

Generated map archives are derivative datasets with their own source and attribution obligations. They are deployed separately from this code repository.

## Licence

Application code is licensed under Apache-2.0. That licence does not relicense source data, generated map archives, basemap content or third-party services.
