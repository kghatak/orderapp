export const HARDCODED_TENANTS = [
  { id: 'nannu_milk', name: 'Nannu Milk' },
  { id: 'test_tenant', name: 'Test Tenant' },
];

export const DEFAULT_TENANT_ID = 'nannu_milk';
export const TENANT_IDS = HARDCODED_TENANTS.map((row) => row.id);

export const isValidTenantId = (value) => TENANT_IDS.includes(String(value ?? '').trim());

export const normalizeTenantId = (value) => {
  const id = String(value ?? '').trim();
  if (!id) return DEFAULT_TENANT_ID;
  return id;
};

/** Old docs with empty/missing tenantId belong to nannu_milk. */
export const docTenantId = (value) => {
  const id = String(value ?? '').trim();
  return id || DEFAULT_TENANT_ID;
};

export const matchesTenant = (docValue, tenantId) => docTenantId(docValue) === tenantId;

export const filterByTenant = (rows, tenantId) =>
  (rows || []).filter((row) => matchesTenant(row?.tenantId, tenantId));

export const resolveRequestTenantId = (req) => {
  const raw = req.query?.tenantId ?? req.body?.tenantId ?? req.headers['x-tenant-id'];
  const normalized = normalizeTenantId(raw);
  const provided = raw != null && String(raw).trim() !== '';
  if (provided && !isValidTenantId(normalized)) {
    return { error: 'Invalid tenantId. Allowed: nannu_milk, test_tenant' };
  }
  return { tenantId: isValidTenantId(normalized) ? normalized : DEFAULT_TENANT_ID };
};
