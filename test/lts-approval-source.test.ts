import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalSource } from '../lib/lts-approval-source';
const absent = { firestore: false, development: false, preview: false, publicRead: false, blob: false };
test('missing production restriction storage fails closed instead of returning an empty approval list', () => {
  assert.throws(() => approvalSource(absent), /restriction storage is not configured/);
  assert.equal(approvalSource({ ...absent, firestore: true }), 'firestore');
  assert.equal(approvalSource({ ...absent, blob: true }), 'blob');
});
test('all preview modes read published restrictions and configured production Firestore stays authoritative', () => {
  for (const mode of ['development', 'preview', 'publicRead']) {
    assert.equal(approvalSource({ ...absent, [mode]: true, blob: true }), 'public');
  }
  assert.equal(approvalSource({ ...absent, firestore: true, preview: true }), 'firestore');
});
