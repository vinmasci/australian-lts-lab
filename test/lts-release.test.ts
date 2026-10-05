import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LTS_DATASETS, parseLtsRelease, type LtsRelease } from '../lib/lts-release';

function fixture(): LtsRelease {
  const release_id = '20261005T080000Z';
  const root = `https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/releases/${release_id}/`;
  return { schema_version: 1, release_id, osm_sha256: 'a'.repeat(64),
    datasets: Object.fromEntries(LTS_DATASETS.map(dataset => {
      const slug = dataset.replace(/_/g, '-');
      return [dataset, { archive_url: `${root}${slug}-lts.pmtiles`,
        metadata_url: `${root}${slug}-lts-metadata.json`, metadata: { source_pbf_modified_at: '2026-10-04T20:00:00Z' } }];
    })) as unknown as LtsRelease['datasets'] };
}
test('accepts one complete national release of immutable map files', () => {
  const release = fixture(); assert.deepEqual(parseLtsRelease(release), release);
});
test('rejects partial releases and mismatched dataset URLs', () => {
  const partial = fixture(); delete (partial.datasets as Partial<LtsRelease['datasets']>).act;
  assert.throws(() => parseLtsRelease(partial));
  const mixed = fixture(); mixed.datasets.nsw.archive_url = mixed.datasets.victoria.archive_url;
  assert.throws(() => parseLtsRelease(mixed));
});
test('rejects arbitrary origins, old release paths and invalid checksums', () => {
  for (const url of ['https://other.example/data.pmtiles', fixture().datasets.victoria.archive_url.replace('20261005T080000Z', '20260901T080000Z')]) {
    const release = fixture(); release.datasets.victoria.archive_url = url;
    assert.throws(() => parseLtsRelease(release));
  }
  const release = fixture(); release.osm_sha256 = 'not a checksum';
  assert.throws(() => parseLtsRelease(release));
});
