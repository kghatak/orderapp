import { getFirestoreDB } from '../../util/firebase.js';
import {
  HARDCODED_TENANTS,
  DEFAULT_TENANT_ID,
  formatTenantId,
  toCanonicalTenantId,
  isValidTenantId,
} from '../../util/tenant.js';

const TENANTS_COLLECTION = 'tenants';
const COUNTER_DOC = 'tenantCounter';

async function getNextTenantNumber(db) {
  const counterRef = db.collection('counters').doc(COUNTER_DOC);
  let next = 3; // 001 Nannu, 002 Test reserved
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.count || 2) : 2;
    next = current + 1;
    tx.set(counterRef, { count: next }, { merge: true });
  });
  return next;
}

function serializeTenant(id, data = {}) {
  return {
    tenantId: id,
    tenantName: data.tenantName || data.name || id,
    status: data.status === 'inactive' ? 'inactive' : 'active',
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

async function listRegisteredTenants(db) {
  const snapshot = await db.collection(TENANTS_COLLECTION).get();
  return snapshot.docs.map((doc) => serializeTenant(doc.id, doc.data() || {}));
}

async function ensureDefaultTenants(db) {
  for (const row of HARDCODED_TENANTS) {
    const ref = db.collection(TENANTS_COLLECTION).doc(row.id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        tenantId: row.id,
        tenantName: row.name,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}

/** GET /tenants */
export const getTenants = async (req, res) => {
  try {
    const db = getFirestoreDB();
    await ensureDefaultTenants(db);
    const registered = await listRegisteredTenants(db);
    const byId = new Map();
    for (const row of HARDCODED_TENANTS) {
      byId.set(row.id, serializeTenant(row.id, { tenantName: row.name, status: row.status }));
    }
    for (const row of registered) {
      byId.set(row.tenantId, row);
    }
    res.status(200).json(Array.from(byId.values()));
  } catch (err) {
    console.error('Get tenants error:', err);
    res.status(500).json({ error: 'Failed to list tenants' });
  }
};

/**
 * POST /tenants — SuperAdmin onboards a partner (PRD Step 1–2).
 * Body: { tenantName }  → system generates TENANT_00N
 * Optional: { tenantId } if explicitly provided (must be TENANT_xxx unused)
 */
export const createTenant = async (req, res) => {
  try {
    const tenantName = String(req.body?.tenantName ?? req.body?.name ?? '').trim();
    if (!tenantName) {
      return res.status(400).json({ error: 'tenantName is required' });
    }

    const db = getFirestoreDB();
    await ensureDefaultTenants(db);

    let id = String(req.body?.tenantId ?? req.body?.id ?? '').trim();
    if (id) {
      id = toCanonicalTenantId(id);
      if (!isValidTenantId(id) || !/^TENANT_\d{3,}$/.test(id)) {
        return res.status(400).json({
          error: 'tenantId must look like TENANT_001',
        });
      }
      if (id === DEFAULT_TENANT_ID) {
        return res.status(409).json({ error: 'TENANT_001 already exists' });
      }
      const existing = await db.collection(TENANTS_COLLECTION).doc(id).get();
      if (existing.exists) {
        return res.status(409).json({ error: `Tenant ${id} already exists` });
      }
    } else {
      const num = await getNextTenantNumber(db);
      id = formatTenantId(num);
    }

    const payload = {
      tenantId: id,
      tenantName,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection(TENANTS_COLLECTION).doc(id).set(payload);

    console.log(`[API] tenant created tenantId=${id} name=${tenantName}`);
    res.status(201).json(serializeTenant(id, payload));
  } catch (err) {
    console.error('Create tenant error:', err);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
};

/** GET /tenants/:id */
export const getTenantById = async (req, res) => {
  try {
    const id = toCanonicalTenantId(req.params.id);
    const db = getFirestoreDB();
    await ensureDefaultTenants(db);
    const snap = await db.collection(TENANTS_COLLECTION).doc(id).get();
    if (!snap.exists) {
      const hardcoded = HARDCODED_TENANTS.find((t) => t.id === id);
      if (!hardcoded) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      return res.status(200).json(
        serializeTenant(id, { tenantName: hardcoded.name, status: hardcoded.status }),
      );
    }
    res.status(200).json(serializeTenant(id, snap.data()));
  } catch (err) {
    console.error('Get tenant error:', err);
    res.status(500).json({ error: 'Failed to fetch tenant' });
  }
};

/**
 * PATCH /tenants/:id
 * Body: { tenantName?, status?: 'active'|'inactive' }
 */
export const updateTenant = async (req, res) => {
  try {
    const id = toCanonicalTenantId(req.params.id);
    const db = getFirestoreDB();
    await ensureDefaultTenants(db);
    const ref = db.collection(TENANTS_COLLECTION).doc(id);
    let snap = await ref.get();
    if (!snap.exists) {
      const hardcoded = HARDCODED_TENANTS.find((t) => t.id === id);
      if (!hardcoded) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      await ref.set({
        tenantId: id,
        tenantName: hardcoded.name,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      snap = await ref.get();
    }

    const update = { updatedAt: new Date() };
    if (req.body?.tenantName != null || req.body?.name != null) {
      const name = String(req.body.tenantName ?? req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'tenantName cannot be empty' });
      update.tenantName = name;
    }
    if (req.body?.status != null) {
      const status = String(req.body.status).trim();
      if (status !== 'active' && status !== 'inactive') {
        return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
      }
      update.status = status;
    }

    await ref.update(update);
    const next = await ref.get();
    console.log(`[API] tenant updated tenantId=${id}`);
    res.status(200).json(serializeTenant(id, next.data()));
  } catch (err) {
    console.error('Update tenant error:', err);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
};

/**
 * POST /tenants/:id/admin — SuperAdmin creates first Tenant Admin (PRD Step 3).
 * Body: { phoneNumber, password, confirmPassword, adminCode? }
 */
export const createTenantAdmin = async (req, res) => {
  try {
    const tenantId = toCanonicalTenantId(req.params.id);
    const { phoneNumber, password, confirmPassword, adminCode } = req.body || {};
    const db = getFirestoreDB();
    await ensureDefaultTenants(db);

    const tenantSnap = await db.collection(TENANTS_COLLECTION).doc(tenantId).get();
    const hardcoded = HARDCODED_TENANTS.find((t) => t.id === tenantId);
    if (!tenantSnap.exists && !hardcoded) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const tenantData = tenantSnap.exists ? tenantSnap.data() : { status: 'active' };
    if (tenantData.status === 'inactive') {
      return res.status(403).json({ error: 'Tenant is inactive' });
    }

    if (!phoneNumber || !password || !confirmPassword) {
      return res.status(400).json({
        error: 'phoneNumber, password, and confirmPassword are required',
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and confirm password do not match' });
    }
    if (String(phoneNumber).length < 10 || !/^\d+$/.test(String(phoneNumber))) {
      return res.status(400).json({ error: 'Phone number must be at least 10 digits' });
    }
    if (adminCode && adminCode !== 'ADMIN123') {
      return res.status(400).json({ error: 'Invalid admin code' });
    }

    const existingUser = await db
      .collection('users')
      .where('phoneNumber', '==', String(phoneNumber))
      .limit(1)
      .get();
    if (!existingUser.empty) {
      return res.status(409).json({ error: 'User with this phone number already exists' });
    }

    const userCounterRef = db.collection('counters').doc('userCounter');
    const userCounterDoc = await userCounterRef.get();
    let currentCount = 1;
    if (userCounterDoc.exists) {
      currentCount = (userCounterDoc.data().count || 0) + 1;
    }
    const userId = `UID${currentCount.toString().padStart(4, '0')}`;
    await userCounterRef.set({ count: currentCount }, { merge: true });

    const user = {
      userId,
      phoneNumber: String(phoneNumber),
      password: String(password),
      outletId: null,
      userProfile: 'Admin',
      tenantId,
      enableNotification: true,
      fcmToken: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('users').doc(userId).set(user);

    console.log(`[API] tenant-admin created tenantId=${tenantId} userId=${userId}`);
    res.status(201).json({
      success: true,
      message: 'Tenant admin created',
      data: {
        userId,
        phoneNumber: user.phoneNumber,
        userProfile: 'Admin',
        tenantId,
      },
    });
  } catch (err) {
    console.error('Create tenant admin error:', err);
    res.status(500).json({ error: 'Failed to create tenant admin' });
  }
};

export const assertTenantActive = async (tenantId) => {
  const canonical = toCanonicalTenantId(tenantId);
  const db = getFirestoreDB();
  const snap = await db.collection(TENANTS_COLLECTION).doc(canonical).get();
  if (!snap.exists) {
    // Hardcoded defaults treated active until registered
    if (HARDCODED_TENANTS.some((t) => t.id === canonical)) return { ok: true };
    return { ok: true }; // unknown but valid id — allow (created mid-flight)
  }
  if (snap.data()?.status === 'inactive') {
    return { ok: false, error: 'Tenant is inactive' };
  }
  return { ok: true };
};
