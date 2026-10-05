/** A single pointer selects the immutable maps validated with the live routers. */
export const LTS_DATASETS = ['victoria', 'nsw', 'queensland', 'western_australia',
  'south_australia', 'act', 'tasmania', 'northern_territory'] as const;
export type ReleaseDataset = typeof LTS_DATASETS[number];
export interface LtsRelease {
  schema_version: 1;
  release_id: string;
  osm_sha256: string;
  datasets: Record<ReleaseDataset, {
    archive_url: string;
    metadata_url: string;
    metadata: Record<string, unknown>;
  }>;
}
const STORAGE_ROOT = 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/';
const MANIFEST_URL = `${STORAGE_ROOT}current-release.json`;

export function parseLtsRelease(value: unknown): LtsRelease {
  if (!value || typeof value !== 'object') throw new Error('Invalid LTS release');
  const release = value as LtsRelease;
  if (release.schema_version !== 1 || !/^\d{8}T\d{6}Z$/.test(release.release_id)
    || !/^[a-f0-9]{64}$/.test(release.osm_sha256)) throw new Error('Invalid LTS release identity');
  const root = `${STORAGE_ROOT}releases/${release.release_id}/`;
  for (const dataset of LTS_DATASETS) {
    const entry = release.datasets?.[dataset];
    const slug = dataset.replace(/_/g, '-');
    if (!entry || entry.archive_url !== `${root}${slug}-lts.pmtiles`
      || entry.metadata_url !== `${root}${slug}-lts-metadata.json`
      || !entry.metadata || typeof entry.metadata !== 'object'
      || typeof entry.metadata.source_pbf_modified_at !== 'string') {
      throw new Error(`Invalid LTS release dataset ${dataset}`);
    }
  }
  return release;
}

let cached: LtsRelease | null = null;
let expires = 0;
let pending: Promise<LtsRelease | null> | null = null;

/** One read per warm process/minute; keep the last valid release on failure. */
export async function currentLtsRelease(): Promise<LtsRelease | null> {
  if (expires > Date.now()) return cached;
  if (!pending) {
    pending = fetch(MANIFEST_URL, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
      .then(async response => {
        if (response.status === 404 && cached === null) return null;
        if (!response.ok) throw new Error(`LTS manifest returned ${response.status}`);
        return parseLtsRelease(await response.json());
      }).then(release => {
        cached = release;
        expires = Date.now() + 60_000;
        return cached;
      }).catch(error => {
        console.error('[LTS release] retaining the previous map release', error);
        expires = Date.now() + 15_000;
        return cached;
      }).finally(() => { pending = null; });
  }
  return pending;
}
