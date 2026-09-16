import { canonicalizeTenantId, isAllowedOrderTenantId } from './tenantMiddleware.js';

const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const isTenantCountField = (key) => {
  if (!key || key === 'count') return false;
  return isAllowedOrderTenantId(canonicalizeTenantId(key));
};

/**
 * Increment a Firestore `counters/{name}` doc tenant-wise.
 *
 * Document shape:
 *   { count: 18, T12026: 6, T22026: 8, T32026: 4 }
 *
 * `count` stays the unique ID sequence (so ORD-00000001 is not reused).
 * Tenant fields are how many that tenant created.
 *
 * @returns {{ start: number, globalCount: number, tenantCount: number | null, tenant: string }}
 */
export async function nextTenantCounter(db, counterName, tenantId, step = 1) {
  const tenant = canonicalizeTenantId(tenantId);
  const n = Number(step);
  const delta = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  const counterRef = db.collection('counters').doc(counterName);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(counterRef);
    const data = snap.exists ? snap.data() || {} : {};
    const legacy = toCount(data.count);

    let tenantSum = 0;
    for (const [key, value] of Object.entries(data)) {
      if (!isTenantCountField(key)) continue;
      tenantSum += toCount(value);
    }

    const tenantAllowed = Boolean(tenant && isAllowedOrderTenantId(tenant));
    const currentTenant = tenantAllowed ? toCount(data[tenant]) : 0;
    const highWater = Math.max(legacy, tenantSum);

    if (delta === 0) {
      return {
        start: highWater + 1,
        globalCount: highWater,
        tenantCount: tenantAllowed ? currentTenant : null,
        tenant,
      };
    }

    const update = {};
    let tenantCount = null;
    if (tenantAllowed) {
      tenantCount = currentTenant + delta;
      update[tenant] = tenantCount;
    }

    const globalCount = highWater + delta;
    update.count = globalCount;

    transaction.set(counterRef, update, { merge: true });
    return {
      start: globalCount - delta + 1,
      globalCount,
      tenantCount,
      tenant,
    };
  });
}
