# AusBUG LTS Map

A public, experimental Bicycle Level of Traffic Stress (LTS) map for Australia.

The Lab classifies each rideable OpenStreetMap road or path separately by travel direction, then displays the more stressful permitted direction on the background map. Every published state and territory except the still-audited NSW graph includes an isolated experimental BRouter route planner. The About panel documents the current rules, thresholds, state-specific data sources, routing costs, crossing penalties, limitations and freshness information.

The map includes Australian search-as-you-type and a browser-controlled current-location button. Place suggestions use the OpenStreetMap-based Photon geocoder through a debounced, cached and rate-limited server route. `PHOTON_GEOCODER_URL` can point production at a dedicated Photon instance. Current coordinates remain in the browser and are used only to position the map marker.

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
- `LTS_FIREBASE_PROJECT_ID`: Firebase project containing the private community contribution collections (production uses the existing billed `cyaroutes` project).
- `LTS_FIREBASE_SERVICE_ACCOUNT_BASE64`: base64-encoded, server-only credential for the narrowly scoped LTS Lab service account. Never expose this as a `NEXT_PUBLIC_` value.
- `BLOB_READ_WRITE_TOKEN`: legacy pilot store retained as a migration/recovery source. Local development falls back to an in-memory store when Firestore is not configured.
- `LTS_VOTE_USE_BLOB_LOCALLY`: optional `true` override for testing the shared Blob store during local development.
- `LTS_RECONCILE_TOKEN`: optional server-only machine credential for automated OSM reconciliation jobs. Human review uses Firebase Authentication instead.
- `LTS_VOTE_HASH_SALT`: separate server-only random value used when hashing network identifiers for abuse controls.

## Community segment voting

Selecting a mapped road opens its contribution controls. A contribution may contain an LTS vote, a rideability rating, or both; at least one rating is required, but neither scale is mandatory when submitting the other. Contributors enter a name or nickname, but do not need to create an account. That name, their reasoning and their observation are visible only to protected reviewers. One browser has one editable contribution per segment.

LTS 1.5 is the cyan class for a trafficable road above 30 km/h with very little motor traffic. Votes for LTS 1, 1.5 or 2 become that value if approved. An approved LTS 3 or 4 proposal is averaged with the published score and rounded up: for example, a published LTS 2 plus an LTS 3 proposal becomes LTS 3.

Rideability is rated independently as R1 any bike, R2 commuter or hybrid, R3 wider tyres advised, or R4 specialist bike/walking may be required. Voters can optionally explain their LTS choice, flag loose surfaces, corrugations, potholes or ruts, uneven stone, and wet-weather slipperiness, and add a short observation. Rideability does not change the LTS because surface difficulty and motor-traffic stress measure different things. The community result uses the conservative upper median when an even number of ratings is split.

Votes do not directly alter the source network. Every new or edited contribution is marked pending until an AusBUG reviewer approves or rejects it at `/ltsmap/review` (also available at `/review`). Reviewers sign in with an existing AusBUG Apple, Google or email/password account through the `cyaroutes` Firebase Authentication project; account creation remains with the main AusBUG app. The server verifies each Firebase ID token and checks the private `ltsReviewers` allowlist before returning contributor information or accepting a decision. Public contributions are rate-limited, and a hidden honeypot catches simple automated submissions.

Raw votes, names and reasoning are private server-side records under `ltsSegments/{segment}/votes`; decisions have an append-only audit record in `ltsReviewDecisions`, including the verified reviewer UID and email, while current approvals are stored in `ltsApprovals`. Only the sanitised `ltsPublishedSegments` collection feeds `/api/lts-votes?dataset=victoria&approved=1`, so AusBUG clients never need access to voter hashes, names, notes, reasoning or reviewer identity. Tied vote totals lean toward the higher-stress value so that uncertainty is not hidden.

Every contribution carries the OSM snapshot and classifier version. Selecting a contributed segment registers its current geometry. Stable segments are carried forward to a new snapshot; a changed base LTS, ambiguous geometry match or missing segment hides the approval from the published layer and marks it `needs_review` or `orphaned`. After generating a new OSM network, an authenticated `POST /api/lts-votes/reconcile` accepts the complete current contribution-segment manifest, creates aliases for clear split/identifier changes, and queues uncertain matches for review. The manifest must contain every currently contributed segment before `complete: true` is used.

The one-time, non-destructive Blob migration can be audited first and then applied with:

```bash
npx tsx scripts/migrate-lts-blob-to-firestore.ts
npx tsx scripts/migrate-lts-blob-to-firestore.ts --apply
```

The original Blob records are intentionally not deleted.

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
