import test from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from './passwords.js';
import { normalizeTenantCode } from './validate.js';

test('reset tokens are stored as a hash', () => {
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), 'abc');
});

test('tenant codes match orderapp tenant ids', () => {
  assert.equal(normalizeTenantCode('nm2026'), 'NM2026');
  assert.equal(normalizeTenantCode('t22026'), 'T22026');
  assert.equal(normalizeTenantCode('TENANT001'), 'NM2026');
  assert.equal(normalizeTenantCode('harbor'), '');
});
