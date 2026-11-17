import test from 'node:test';
import assert from 'node:assert/strict';
import { presentBrand } from './tenantBrand.js';

test('uses the stored business name', () => {
  const brand = presentBrand({ code: 'NM2026', name: 'Naanu Milk', business: 'Nannu Milk' });
  assert.equal(brand.business, 'Nannu Milk');
  assert.equal(brand.name, 'Naanu Milk');
});

test('returns the business name for any tenant', () => {
  const brand = presentBrand({ code: 'ACME', name: 'Acme', business: 'Acme Dairy' });
  assert.equal(brand.business, 'Acme Dairy');
  assert.equal(brand.name, 'Acme');
});

test('business falls back to the tenant name', () => {
  const brand = presentBrand({ code: 'T9', name: 'Harbor', business: '' });
  assert.equal(brand.business, 'Harbor');
});

test('missing tenant has no name', () => {
  assert.deepEqual(presentBrand(null), { business: '', name: '' });
});
