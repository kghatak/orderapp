import { canonicalizeTenantId, isAllowedOrderTenantId } from './tenantMiddleware.js';

const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const isTenantCountField = (key) => {
  if (!key || key === 'count') return false;
  return isAllowedOrderTenantId(canonicalizeTenantId(key));
};

const USER_COUNTER = 'userCounter';
const LEGACY_USER_COUNTER = 'userIdCounter';
const MAX_USER_ID_PROBES = 50;

export function formatUserId(globalCount) {
  return `UID${String(globalCount).padStart(4, '0')}`;
}

/**
 * Next user id from `counters/userCounter` only.
 * An id that already has a user document is skipped.
 * Callers must create() the user doc, not set().
 */
export async function nextUserId(db, tenantId, step = 1) {
  const tenant = canonicalizeTenantId(tenantId);
  const n = Number(step);
  const delta = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  const counterRef = db.collection('counters').doc(USER_COUNTER);

  return db.runTransaction(async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const data = counterSnap.exists ? counterSnap.data() || {} : {};

    let tenantSum = 0;
    for (const [key, value] of Object.entries(data)) {
      if (!isTenantCountField(key)) continue;
      tenantSum += toCount(value);
    }

    const tenantAllowed = Boolean(tenant && isAllowedOrderTenantId(tenant));
    const currentTenant = tenantAllowed ? toCount(data[tenant]) : 0;
    const floor = Math.max(toCount(data.count), tenantSum);

    if (delta === 0) {
      return {
        start: floor + 1,
        globalCount: floor,
        userId: formatUserId(floor),
        tenantCount: tenantAllowed ? currentTenant : null,
        tenant,
      };
    }

    let globalCount = floor + delta;
    for (let probe = 0; probe < MAX_USER_ID_PROBES; probe++) {
      const existing = await transaction.get(
        db.collection('users').doc(formatUserId(globalCount)),
      );
      if (!existing.exists) break;
      globalCount += 1;
      if (probe === MAX_USER_ID_PROBES - 1) {
        throw new Error(`No free user id after ${formatUserId(globalCount)}`);
      }
    }

    const update = { count: globalCount };
    let tenantCount = null;
    if (tenantAllowed) {
      tenantCount = currentTenant + delta;
      update[tenant] = tenantCount;
    }
    transaction.set(counterRef, update, { merge: true });

    return {
      start: globalCount - delta + 1,
      globalCount,
      userId: formatUserId(globalCount),
      tenantCount,
      tenant,
    };
  });
}

/**
 * Increment a Firestore `counters/{name}` doc tenant-wise.
 *
 * Document shape:
 *   { count: 18, T12026: 6, T22026: 8, T32026: 4 }
 *
 * `count` stays the unique ID sequence (so ORD-00000001 is not reused).
 * Tenant fields are how many that tenant created.
 * User ids always go through `counters/userCounter`, including a request for the old name.
 *
 * @returns {{ start: number, globalCount: number, tenantCount: number | null, tenant: string }}
 */
export async function nextTenantCounter(db, counterName, tenantId, step = 1) {
  if (counterName === USER_COUNTER || counterName === LEGACY_USER_COUNTER) {
    return nextUserId(db, tenantId, step);
  }

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
