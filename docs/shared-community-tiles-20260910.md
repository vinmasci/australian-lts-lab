# Shared community tile publication

Production deployment: `dpl_2hZ1HZdgNCi4tpHf3496WKLx2riM`.
Promoted after a protected staged request returned Little Clyde Street
(`w50882098`) as LTS 1 forward/back, preserving base_lts=2.

The endpoint now applies published current/carried-forward segment ratings
by OSM way ID to MVT properties. Geometry, crossings and access tags stay
unchanged. Current tile speed limits still enforce existing hard floors.
This does not mutate original PMTiles, routing graphs, or votes.

Verification:

- TypeScript check, production build and 33 unit tests passed.
- Local merge checked 32 published roads across 18 actual production tiles,
  with identical decoded geometry before/after.
- After promotion, `npx tsx scripts/check-community-tiles.ts --live` passed
  for all 32 roads, including Little Clyde Street = 1.
- Four approval/tile-speed conflicts retain the rule-based score:
  Hildebrand Road w28727829 (100), Greens Road w35050294 (100),
  Cottles Bridge–Strathewen Road w287216878 (80),
  Hurstbridge–Arthurs Creek Road w27880744 (100 km/h).
  This is intentional; do not lower those based only on an approval snapshot.

Approval snapshots and edge responses each have a five-minute TTL. Outages
fall back to last-known ratings or base tiles, with a bounded approval wait.
Already-downloaded client tiles are outside server cache control. The iOS
cache policy fix, fractional 1.5 styling, and client URL revision are prepared
in CYARoutes and require their own releases. Ordinary infrastructure styling
and previously saved route classifications are separate from this endpoint.

Rollback: promote the previous known-good Vercel deployment. Original PMTiles
remain immutable and available; this change does not rebuild or replace them.
