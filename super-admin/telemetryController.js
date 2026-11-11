import { canonicalizeTenantId, isAllowedOrderTenantId } from '../util/tenantMiddleware.js';
import { listRequestEvents } from '../telemetry/requestLog.js';
import { HttpError, sendData } from './http.js';

const CHANNELS = new Set(['app', 'web', 'pos']);
const RESOURCES = new Set(['orders', 'returns']);

function optionalChoice(value, allowed, label) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'all') return '';
  if (!allowed.has(raw)) throw new HttpError(400, `Choose a valid ${label}.`);
  return raw;
}

function optionalTenant(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'all') return '';
  const tenantId = canonicalizeTenantId(raw);
  if (!tenantId || !isAllowedOrderTenantId(tenantId)) {
    throw new HttpError(400, 'Choose a valid tenant.');
  }
  return tenantId;
}

function optionalDay(value, endOfDay) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpError(400, 'Enter a valid date.');
  const date = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid date.');
  return date;
}

export async function getTelemetry(req, res) {
  const from = optionalDay(req.query.from, false);
  const to = optionalDay(req.query.to, true);
  if (from && to && from > to) {
    throw new HttpError(400, 'The start date must be on or before the end date.');
  }

  try {
    const data = await listRequestEvents({
      tenantId: optionalTenant(req.query.tenantId),
      channel: optionalChoice(req.query.channel, CHANNELS, 'channel'),
      resource: optionalChoice(req.query.resource, RESOURCES, 'resource'),
      search: String(req.query.search || '').trim().slice(0, 80),
      from,
      to,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    sendData(res, data);
  } catch (err) {
    if (err.status) throw err;
    console.error('Could not read telemetry:', err.message);
    throw new HttpError(502, 'Could not read telemetry.');
  }
}
