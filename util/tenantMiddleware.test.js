import test from 'node:test';
import assert from 'node:assert/strict';
import {
  belongsToTenant,
  mongoTenantFilter,
  withMongoTenant,
  canonicalizeTenantId,
  resolveRequestTenantId,
  TENANTS,
} from './tenantMiddleware.js';

test('belongsToTenant: empty doc is only NM2026', () => {
  assert.equal(belongsToTenant('', TENANTS.NAANU_MILK), true);
  assert.equal(belongsToTenant(undefined, TENANTS.NAANU_MILK), true);
  assert.equal(belongsToTenant(TENANTS.NAANU_MILK, TENANTS.NAANU_MILK), true);
  assert.equal(belongsToTenant('TENANT001', TENANTS.NAANU_MILK), true);
  assert.equal(belongsToTenant('TENANT001', 'T12026'), false);
  assert.equal(belongsToTenant('', 'T12026'), false);
  assert.equal(belongsToTenant(TENANTS.NAANU_MILK, 'T12026'), false);
  assert.equal(belongsToTenant('T22026', 'T22026'), true);
  assert.equal(belongsToTenant('T22026', TENANTS.NAANU_MILK), false);
});

test('mongoTenantFilter: T1 is exact', () => {
  assert.deepEqual(mongoTenantFilter('T12026'), { tenantId: 'T12026' });
});

test('mongoTenantFilter: NM2026 includes empty and TENANT001', () => {
  const filter = mongoTenantFilter('NM2026');
  assert.ok(filter.$or);
  const values = filter.$or.map((c) => c.tenantId);
  assert.ok(values.includes('NM2026'));
  assert.ok(values.includes('TENANT001'));
  assert.ok(values.includes(''));
  assert.ok(values.includes(null));
});

test('withMongoTenant keeps outletId for T1 and NM', () => {
  const t1 = withMongoTenant({ outletId: 'OUTID001' }, 'T12026');
  assert.equal(t1.tenantId, 'T12026');
  assert.equal(t1.outletId, 'OUTID001');

  const nm = withMongoTenant({ outletId: 'OUTID001' }, 'NM2026');
  assert.ok(nm.$and);
  assert.equal(nm.$and[1].outletId, 'OUTID001');
});

test('missing header and TENANT001 resolve to NM2026', () => {
  assert.equal(resolveRequestTenantId(''), TENANTS.NAANU_MILK);
  assert.equal(resolveRequestTenantId('TENANT001'), TENANTS.NAANU_MILK);
  assert.equal(canonicalizeTenantId('TENANT001'), TENANTS.NAANU_MILK);
  assert.equal(resolveRequestTenantId('T22026'), 'T22026');
});
