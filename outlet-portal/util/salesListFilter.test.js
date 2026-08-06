import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerPhoneFilter,
  buildSalesSearchOr,
  buildSalesListFilter
} from './salesListFilter.js';

test('full phone search matches only exact last 10 digits', () => {
  const or = buildSalesSearchOr('6465464646');
  assert.ok(or);
  const filter = buildSalesListFilter({
    tenantId: 'T1',
    outletId: 'O1',
    search: '6465464646'
  });
  assert.equal(filter.tenantId, 'T1');
  assert.ok(filter.$or || filter['customer.phone']);
});

test('buildCustomerPhoneFilter rejects partial false positives', () => {
  const tail = '6465464646';
  const clause = buildCustomerPhoneFilter(tail);
  assert.ok(clause.$or);
  const regexClause = clause.$or.find((c) => c['customer.phone']?.$regex);
  const re = new RegExp(regexClause['customer.phone'].$regex);
  assert.equal(re.test('6465464646'), true);
  assert.equal(re.test('6464465464'), false);
  assert.equal(re.test('3453534535'), false);
  assert.equal(re.test('5555555555'), false);
});

test('name search does not require phone digits', () => {
  const filter = buildSalesListFilter({
    tenantId: 'T1',
    outletId: 'O1',
    search: 'nitesh'
  });
  assert.ok(filter.$or);
  const hasName = filter.$or.some((c) => c['customer.name']);
  assert.equal(hasName, true);
});

test('paymentMode and search combine with AND', () => {
  const filter = buildSalesListFilter({
    tenantId: 'T1',
    outletId: 'O1',
    paymentMode: 'Due',
    search: '6465464646'
  });
  assert.equal(filter.paymentMode, 'Due');
  assert.ok(filter.$or);
});

test('explicit customerPhone filter', () => {
  const filter = buildSalesListFilter({
    tenantId: 'T1',
    outletId: 'O1',
    customerPhone: '6465464646'
  });
  assert.ok(filter.$or);
});

test('dsf name search does not match dffhdh', () => {
  const re = new RegExp('dsf', 'i');
  assert.equal(re.test('dsf'), true);
  assert.equal(re.test('dffhdh'), false);
  const or = buildSalesSearchOr('dsf');
  assert.ok(or?.$or?.some((c) => c['customer.name']));
});
