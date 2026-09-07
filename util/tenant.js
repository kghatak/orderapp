/**
 * Multi-tenant (PRD): Platform → Tenant (partner) → Outlets.
 * Canonical ids: TENANT_001, TENANT_002, …
 * Legacy aliases still accepted on read/request, then normalized.
 */

export const DEFAULT_TENANT_ID = 'TENANT_001';

export const HARDCODED_TENANTS = [
  { id: 'TENANT_001', name: 'Nannu Milk', status: 'active' },
  { id: 'TENANT_002', name: 'Test Tenant', status: 'active' },
];

/** Map old / alternate ids → PRD canonical tenantId */
export const LEGACY_TENANT_ALIASES = {
  nannu_milk: 'TENANT_001',
  NM2026: 'TENANT_001',
  test_tenant: 'TENANT_002',
};

export const PRD_TENANT_PATTERN = /^TENANT_\d{3,}$/;

export const toCanonicalTenantId = (value) => {
  const id = String(value ?? '').trim();
  if (!id) return DEFAULT_TENANT_ID;
  if (LEGACY_TENANT_ALIASES[id]) return LEGACY_TENANT_ALIASES[id];
  if (PRD_TENANT_PATTERN.test(id)) return id;
  return id;
};

export const isValidTenantId = (value) => {
  const id = String(value ?? '').trim();
  if (!id) return false;
  if (LEGACY_TENANT_ALIASES[id]) return true;
  return PRD_TENANT_PATTERN.test(id);
};

export const normalizeTenantId = (value) => toCanonicalTenantId(value);

/** Doc field → canonical. Empty/missing = TENANT_001 (existing Nannu data). */
export const docTenantId = (value) => toCanonicalTenantId(value);

export const matchesTenant = (docValue, tenantId) =>
  docTenantId(docValue) === toCanonicalTenantId(tenantId);

export const filterByTenant = (rows, tenantId) =>
  (rows || []).filter((row) => matchesTenant(row?.tenantId, tenantId));

/**
 * Resolve tenant for a request.
 * Missing header/query/body => TENANT_001 (website backward compatible).
 */
export const resolveRequestTenantId = (req) => {
  const raw =
    req.query?.tenantId ?? req.body?.tenantId ?? req.headers['x-tenant-id'];
  const provided = raw != null && String(raw).trim() !== '';
  if (!provided) {
    return { tenantId: DEFAULT_TENANT_ID };
  }
  const trimmed = String(raw).trim();
  // Milk Mongo id TENANT001 (no underscore) is NOT an order tenant
  if (/^TENANT\d+$/i.test(trimmed) && !trimmed.includes('_')) {
    return { tenantId: DEFAULT_TENANT_ID };
  }
  if (!isValidTenantId(trimmed)) {
    return {
      error:
        'Invalid tenantId. Use TENANT_001, TENANT_002, … (or legacy nannu_milk / test_tenant).',
    };
  }
  return { tenantId: toCanonicalTenantId(trimmed) };
};

export const resolveSignupTenantId = (tenantId) => {
  if (tenantId == null || String(tenantId).trim() === '') {
    return { tenantId: DEFAULT_TENANT_ID };
  }
  const trimmed = String(tenantId).trim();
  if (/^TENANT\d+$/i.test(trimmed) && !trimmed.includes('_')) {
    return {
      error:
        'Invalid order tenantId. Use TENANT_001 style (with underscore), not milk TENANT001.',
    };
  }
  if (!isValidTenantId(trimmed)) {
    return {
      error: 'Invalid tenantId. Use TENANT_001, TENANT_002, …',
    };
  }
  return { tenantId: toCanonicalTenantId(trimmed) };
};

export const formatTenantId = (num) =>
  `TENANT_${String(num).padStart(3, '0')}`;
