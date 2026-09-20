// util/tenantMiddleware.js
// Reads tenant from request header (not body).
// Missing header / legacy TENANT001 = NM2026 (old order-admin without interceptor).

export const TENANTS = {
  NAANU_MILK: 'NM2026',
  TEST: 'T12026',
};

export const ALLOWED_TENANT_IDS = Object.values(TENANTS);

const TENANT_ALIASES = {
  NM2026: TENANTS.NAANU_MILK,
  T12026: TENANTS.TEST,
  TENANT001: TENANTS.NAANU_MILK,
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
  const upper = id.toUpperCase();
  if (TENANT_ALIASES[id]) return TENANT_ALIASES[id];
  if (TENANT_ALIASES[upper]) return TENANT_ALIASES[upper];
  // Other milk-module ids (TENANT002…) are not order tenants.
  if (/^TENANT\d+$/i.test(id)) return '';
  return id;
}

/** Header empty or legacy TENANT001 → NM2026. T1/T2 stay as sent. */
export function resolveRequestTenantId(raw) {
  const id = canonicalizeTenantId(raw);
  return id || TENANTS.NAANU_MILK;
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
  const tenantId = resolveRequestTenantId(readTenantFromRequest(req));

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

export function isNaanuMilkTenant(tenantId) {
  return canonicalizeTenantId(tenantId) === TENANTS.NAANU_MILK;
}

/**
 * Mongo query for tenant isolation.
 * NM2026 also matches missing/empty tenantId and legacy TENANT001 (old milk docs).
 * T1/T2/T3 stay exact match. Staging order-admin / POS keep sending the same header/JWT.
 */
export function mongoTenantFilter(tenantId, field = 'tenantId') {
  const id = canonicalizeTenantId(tenantId);
  if (!id) {
    return { [field]: { $in: [] } };
  }
  if (id === TENANTS.NAANU_MILK) {
    return {
      $or: [
        { [field]: TENANTS.NAANU_MILK },
        { [field]: 'TENANT001' },
        { [field]: '' },
        { [field]: null },
        { [field]: { $exists: false } },
      ],
    };
  }
  return { [field]: id };
}

/** Merge extra Mongo fields with {@link mongoTenantFilter}. */
export function withMongoTenant(extra, tenantId, field = 'tenantId') {
  const tenant = mongoTenantFilter(tenantId, field);
  const rest =
    extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {};
  const restObj = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) restObj[key] = value;
  }
  if (Object.keys(restObj).length === 0) return tenant;
  if (tenant.$or) {
    return { $and: [tenant, restObj] };
  }
  return { ...tenant, ...restObj };
}
