import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isLtsVoteLevel, projectApprovedLts } from '@/lib/lts-voting';

// Exercise the actual route validators without authenticating or writing votes.
function validator(file: string, end: string) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf('const DATASETS');
  assert.ok(start >= 0 && source.indexOf(end, start) > start);
  const code = ts.transpileModule(source.slice(start, source.indexOf(end, start)),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ isLtsVoteLevel });
  vm.runInContext(code, context);
  return context.validSegment as (segment: unknown, dataset?: string) => boolean;
}
const segment = (level: unknown) => ({ dataset: 'victoria', segmentId: 'segment:w123', name: 'Test Street',
  featureKind: 'segment', currentLts: level, osmId: 'w123',
  geometry: { type: 'MultiLineString', coordinates: [[[145,-37],[145.001,-37]]] } });
for (const [file, end] of [
  ['../app/api/lts-votes/route.ts', 'async function summary'],
  ['../app/api/lts-votes/reconcile/route.ts', 'export async function POST'],
]) {
  test(`${file} accepts every supported base rating including 1.5`, () => {
    const validate = validator(file, end);
    for (const level of [1,1.5,2,3,4]) assert.equal(validate(segment(level), 'victoria'), true);
    for (const level of [0,1.2,2.5,5,NaN,Infinity,'1.5',null]) assert.equal(validate(segment(level), 'victoria'), false);
  });
}
test('votes from a 1.5 base preserve all three intended results', () => {
  for (const target of [1,1.5,2] as const) assert.equal(projectApprovedLts(1.5,target),target);
});
