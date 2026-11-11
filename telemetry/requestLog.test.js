import test from 'node:test';
import assert from 'node:assert/strict';
import { readGetTelemetry } from './requestLog.js';

test('reads tenant, user, page, and channel for a GET order', () => {
  const row = readGetTelemetry(
    {
      tenantId: 'NM2026',
      baseUrl: '/orders',
      route: { path: '/' },
      headers: {
        'x-user-id': 'UID0007',
        'x-page': '/orders',
        'x-client': 'Web',
      },
    },
    'orders',
  );

  assert.equal(row.tenantId, 'NM2026');
  assert.equal(row.userId, 'UID0007');
  assert.equal(row.page, '/orders');
  assert.equal(row.channel, 'web');
  assert.equal(row.resource, 'orders');
  assert.equal(row.path, '/orders');
  assert.ok(row.timestamp instanceof Date);
});

test('drops a phone number and a token, and treats an unknown channel as app', () => {
  const row = readGetTelemetry(
    {
      tenantId: 'T12026',
      headers: {
        'x-user-id': '9876543210',
        'x-page': '/orders?token=secret',
        'x-client': 'browser',
      },
      originalUrl: '/orders?token=secret',
    },
    'orders',
  );

  assert.equal(row.userId, '');
  assert.equal(row.page, '/orders');
  assert.equal(row.channel, 'app');
  assert.equal(row.path, '/orders');
});

test('stores app when the client does not send a channel', () => {
  const row = readGetTelemetry(
    {
      tenantId: 'NM2026',
      headers: {},
      originalUrl: '/orders',
    },
    'orders',
  );

  assert.equal(row.channel, 'app');
});

test('keeps pos when the client sends it', () => {
  const row = readGetTelemetry(
    {
      tenantId: 'NM2026',
      headers: { 'x-client': 'POS' },
      originalUrl: '/orders',
    },
    'orders',
  );

  assert.equal(row.channel, 'pos');
});

test('keeps an app screen name', () => {
  const row = readGetTelemetry(
    {
      tenantId: 'NM2026',
      headers: {
        'x-user-id': 'UID0012',
        'x-page': 'Storekeeper Orders',
        'x-client': 'app',
      },
      originalUrl: '/returns',
    },
    'returns',
  );

  assert.equal(row.page, 'Storekeeper Orders');
  assert.equal(row.channel, 'app');
  assert.equal(row.resource, 'returns');
});
