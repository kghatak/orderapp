// util/tenantMiddleware.js
// Reads tenant from request header (not body). Clients send:
//   X-Tenant-Id / User-TenantId from refine-auth. No default tenant.

export const TENANTS = {
  NAANU_MILK: 'NM2026',
  TEST: 'T12026',
};

export const ALLOWED_TENANT_IDS = Object.values(TENANTS);

const TENANT_ALIASES = {
  NM2026: TENANTS.NAANU_MILK,
  T12026: TENANTS.TEST,
};

// Extra tenants set on users in Firestore (e.g. T22026) — same shape as T12026.
const isCustomOrderTenantId = (id) => /^T\d{4,}$/i.test(id);

export const isAllowedOrderTenantId = (id) =>
  ALLOWED_TENANT_IDS.includes(id) || isCustomOrderTenantId(id);

function normalizeTenantId(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function canonicalizeTenantId(value) {
  const id = normalizeTenantId(value);
  if (!id) return '';
  if (TENANT_ALIASES[id]) return TENANT_ALIASES[id];
  // Milk module id (TENANT001) is not an order tenant.
  if (/^TENANT\d+$/i.test(id)) return '';
  return id;
}

function readTenantFromRequest(req) {
  return (
    req.headers['x-tenant-id'] ||
    req.headers['user-tenantid'] ||
    req.query?.tenantId ||
    ''
  );
}

export function tenantMiddleware(req, res, next) {
  const tenantId = canonicalizeTenantId(readTenantFromRequest(req));

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Missing tenant ID in request',
    });
  }

  if (!isAllowedOrderTenantId(tenantId)) {
    return res.status(400).json({
      success: false,
      message: `Invalid tenant ID. Allowed: ${ALLOWED_TENANT_IDS.join(', ')}`,
    });
  }

  req.tenantId = tenantId;
  next();
}

/** Sets req.tenantId when a valid header is present; otherwise continues (cron jobs). */
export function optionalTenantMiddleware(req, res, next) {
  const tenantId = canonicalizeTenantId(readTenantFromRequest(req));
  if (!tenantId) {
    return next();
  }
  if (!isAllowedOrderTenantId(tenantId)) {
    return res.status(400).json({
      success: false,
      message: `Invalid tenant ID. Allowed: ${ALLOWED_TENANT_IDS.join(', ')}`,
    });
  }
  req.tenantId = tenantId;
  next();
}

export function validateTenantId(req, res) {
  if (!req.tenantId) {
    res.status(400).json({
      success: false,
      message: 'Missing tenant ID in request',
    });
    return false;
  }
  return true;
}

// Existing Naanu Milk docs may have no tenantId yet — treat those as NM2026.
export function belongsToTenant(docTenantId, requestTenantId) {
  const requestTenant = canonicalizeTenantId(requestTenantId);
  if (!requestTenant) return false;
  const docTenant = canonicalizeTenantId(docTenantId);
  if (requestTenant === TENANTS.NAANU_MILK) {
    return !docTenant || docTenant === TENANTS.NAANU_MILK;
  }
  return docTenant === requestTenant;
}

export function denyUnlessTenant(res, docTenantId, requestTenantId, message = 'Not found') {
  if (belongsToTenant(docTenantId, requestTenantId)) return false;
  res.status(404).json({ error: message });
  return true;
}

export function recordsForTenant(records, requestTenantId) {
  return records.filter((row) => belongsToTenant(row.tenantId, requestTenantId));
}
