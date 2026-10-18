import { canonicalizeTenantId } from '../util/tenantMiddleware.js';
import { FEATURE_KEYS } from './features.js';
import { findTenantByCode } from './repository.js';

const ALLOWED = new Set(FEATURE_KEYS);

/** Missing list means the tenant was never configured, so every feature stays on. */
export function effectiveFeatureList(stored) {
  if (!Array.isArray(stored)) return [...FEATURE_KEYS];
  return [...new Set(stored.filter((key) => ALLOWED.has(key)))];
}

export async function featuresForTenantCode(code) {
  const raw = String(code || '').trim();
  const canonical = canonicalizeTenantId(raw);
  const candidates = [...new Set([raw, canonical].filter(Boolean))];
  for (const candidate of candidates) {
    const tenant = await findTenantByCode(candidate);
    if (tenant) return effectiveFeatureList(tenant.features);
  }
  return [...FEATURE_KEYS];
}
