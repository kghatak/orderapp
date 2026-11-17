import { canonicalizeTenantId, TENANTS } from '../util/tenantMiddleware.js';

/** Business name for a tenant document. */
export function presentBrand(tenant) {
  if (!tenant) return { business: '', name: '' };
  return {
    business: String(tenant.business || tenant.name || '').trim(),
    name: String(tenant.name || '').trim(),
  };
}

export async function brandForTenantCode(code) {
  const { findTenantByCode } = await import('./repository.js');
  const raw = String(code || '').trim();
  const canonical = canonicalizeTenantId(raw);
  const candidates = [...new Set([raw, canonical].filter(Boolean))];
  for (const candidate of candidates) {
    const tenant = await findTenantByCode(candidate);
    if (tenant) return presentBrand(tenant);
  }
  if (canonical === TENANTS.NAANU_MILK) {
    return { business: 'Nannu Milk', name: 'Nannu Milk' };
  }
  return presentBrand(null);
}
