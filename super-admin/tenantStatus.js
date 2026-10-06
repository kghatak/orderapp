import { getFirestoreDB } from '../util/firebase.js';

const COLLECTION = 'superAdminTenants';
const cache = new Map();
const TTL_MS = 15_000;

/** True only when a super-admin tenant record exists and is inactive. Missing records stay allowed. */
export async function isTenantInactive(tenantId) {
  if (!tenantId) return false;
  const hit = cache.get(tenantId);
  if (hit && hit.expires > Date.now()) return hit.inactive;

  const snap = await getFirestoreDB()
    .collection(COLLECTION)
    .where('code', '==', tenantId)
    .limit(1)
    .get();
  const inactive = !snap.empty && snap.docs[0].data()?.status === 'inactive';
  cache.set(tenantId, { inactive, expires: Date.now() + TTL_MS });
  return inactive;
}

export function clearTenantStatusCache(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
