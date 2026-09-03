import assert from 'node:assert/strict';
import test from 'node:test';
import { ltsAppPath } from '../lib/client-path';

test('keeps direct LTS Lab paths unchanged', () => {
  assert.equal(ltsAppPath('/api/lts-votes', 'australian-lts-lab.vercel.app'), '/api/lts-votes');
  assert.equal(ltsAppPath('https://example.com/data.pmtiles', 'ausbug.app'), 'https://example.com/data.pmtiles');
});

test('prefixes internal requests on AusBUG website hosts', () => {
  assert.equal(ltsAppPath('/api/lts-votes?dataset=victoria', 'ausbug.app'), '/ltsmap/api/lts-votes?dataset=victoria');
  assert.equal(ltsAppPath('/data/lts/victoria-lts-metadata.json', 'www.vicbug.app'), '/ltsmap/data/lts/victoria-lts-metadata.json');
});
