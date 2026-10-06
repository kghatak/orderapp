import { getFirestoreDB } from '../util/firebase.js';
import { nextTenantCounter } from '../util/tenantCounter.js';
import { canonicalizeTenantId, TENANTS } from '../util/tenantMiddleware.js';
import { clearTenantStatusCache } from './tenantStatus.js';
import { HttpError } from './http.js';

const USERS = 'superAdminUsers';
const TENANT_DOCS = 'superAdminTenants';
const ADMINS = 'superAdminTenantAdmins';
const ACTIVITY = 'superAdminActivity';

const ID_PREFIX = {
  [USERS]: 'SAU',
  [TENANT_DOCS]: 'SAT',
  [ADMINS]: 'SAA',
  [ACTIVITY]: 'SAC',
};

function db() {
  return getFirestoreDB();
}

function now() {
  return new Date().toISOString();
}

async function nextFormattedId(collectionName) {
  const { globalCount } = await nextTenantCounter(db(), collectionName, '');
  return `${ID_PREFIX[collectionName]}${String(globalCount).padStart(4, '0')}`;
}

async function raiseCounter(collectionName, minimum) {
  if (minimum <= 0) return;
  const ref = db().collection('counters').doc(collectionName);
  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const count = Number(snap.exists ? snap.data()?.count : 0) || 0;
    if (count < minimum) transaction.set(ref, { count: minimum }, { merge: true });
  });
}

/** Rewrites random Firestore ids to SAU0001 / SAT0001 / SAA0001 / SAC0001 and keeps the counter ahead of them. */
export async function reformatSuperAdminIds() {
  const tenantIds = await reformatCollection(TENANT_DOCS);
  await reformatCollection(ADMINS, (data) => {
    if (tenantIds.has(data.tenantId)) data.tenantId = tenantIds.get(data.tenantId);
    return data;
  });
  await reformatCollection(USERS);
  await reformatCollection(ACTIVITY);
}

async function reformatCollection(collectionName, mapData = (data) => data) {
  const prefix = ID_PREFIX[collectionName];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const snap = await db().collection(collectionName).get();
  let max = 0;
  const pending = [];
  snap.docs.forEach((doc) => {
    const match = pattern.exec(doc.id);
    if (match) max = Math.max(max, Number(match[1]));
    else pending.push(doc);
  });
  pending.sort((left, right) => {
    const leftTime = left.data().createdAt || left.data().at || '';
    const rightTime = right.data().createdAt || right.data().at || '';
    return String(leftTime).localeCompare(String(rightTime));
  });
  await raiseCounter(collectionName, max);
  const idMap = new Map();
  for (const doc of pending) {
    const id = await nextFormattedId(collectionName);
    const data = mapData({ ...doc.data() });
    await db().collection(collectionName).doc(id).set(data);
    await doc.ref.delete();
    idMap.set(doc.id, id);
  }
  return idMap;
}

function docs(snap) {
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export function paginate(items, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(1, Number(pageSize) || 8));
  const start = (safePage - 1) * size;
  return {
    items: items.slice(start, start + size),
    total: items.length,
    page: safePage,
    pageSize: size,
  };
}

export async function outletCounts() {
  const snap = await db().collection('outlets').select('tenantId').get();
  const counts = new Map();
  snap.docs.forEach((doc) => {
    const code = canonicalizeTenantId(doc.data()?.tenantId) || TENANTS.NAANU_MILK;
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  return counts;
}

export async function listUsers() {
  return docs(await db().collection(USERS).get());
}

export async function findUserByEmail(email) {
  const snap = await db().collection(USERS).where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function findUserById(id) {
  const doc = await db().collection(USERS).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function findUserByResetHash(tokenHash) {
  const snap = await db().collection(USERS).where('resetTokenHash', '==', tokenHash).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function createUser(data) {
  const id = await nextFormattedId(USERS);
  const record = { ...data, createdAt: now(), updatedAt: now() };
  await db().collection(USERS).doc(id).set(record);
  return { id, ...record };
}

export async function updateUser(id, patch) {
  const ref = db().collection(USERS).doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new HttpError(404, 'User not found.');
  const next = { ...patch, updatedAt: now() };
  await ref.set(next, { merge: true });
  return { id, ...existing.data(), ...next };
}

export async function listTenants() {
  return docs(await db().collection(TENANT_DOCS).get());
}

export async function findTenantById(id) {
  const doc = await db().collection(TENANT_DOCS).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function findTenantByCode(code) {
  const snap = await db().collection(TENANT_DOCS).where('code', '==', code).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function findTenantByResetHash(tokenHash) {
  const snap = await db().collection(TENANT_DOCS).where('passwordResetTokenHash', '==', tokenHash).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function createTenant(data) {
  const id = await nextFormattedId(TENANT_DOCS);
  const record = {
    whatsappStatus: 'not_started',
    status: 'active',
    ...data,
    createdAt: now(),
    updatedAt: now(),
  };
  await db().collection(TENANT_DOCS).doc(id).set(record);
  clearTenantStatusCache(record.code);
  return { id, ...record };
}

export async function updateTenant(id, patch) {
  const existing = await findTenantById(id);
  if (!existing) throw new HttpError(404, 'Tenant not found.');
  const next = { ...patch, updatedAt: now() };
  await db().collection(TENANT_DOCS).doc(id).set(next, { merge: true });
  clearTenantStatusCache(existing.code);
  if (next.code && next.code !== existing.code) clearTenantStatusCache(next.code);
  return { ...existing, ...next };
}

export async function listAdmins() {
  return docs(await db().collection(ADMINS).get());
}

export async function findAdminById(id) {
  const doc = await db().collection(ADMINS).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createAdmin(data) {
  const id = await nextFormattedId(ADMINS);
  const record = { status: 'active', ...data, createdAt: now() };
  await db().collection(ADMINS).doc(id).set(record);
  return { id, ...record };
}

export async function updateAdmin(id, patch) {
  const existing = await findAdminById(id);
  if (!existing) throw new HttpError(404, 'Tenant admin not found.');
  await db().collection(ADMINS).doc(id).set(patch, { merge: true });
  return { ...existing, ...patch };
}

export async function addActivity(message, kind) {
  const id = await nextFormattedId(ACTIVITY);
  const record = { message, kind, at: now() };
  await db().collection(ACTIVITY).doc(id).set(record);
  return { id, ...record };
}

export async function listActivity(limit = 8) {
  const items = docs(await db().collection(ACTIVITY).get());
  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: 'superAdmin',
    status: user.status,
    createdAt: user.createdAt || null,
  };
}

export function publicTenant(tenant, outletCount = 0) {
  return {
    id: tenant.id,
    code: tenant.code,
    name: tenant.name,
    business: tenant.business || '',
    email: tenant.email || '',
    phone: tenant.phone || '',
    status: tenant.status || 'active',
    outletCount,
    whatsappStatus: tenant.whatsappStatus || 'not_started',
    createdAt: tenant.createdAt || null,
    updatedAt: tenant.updatedAt || null,
  };
}

export function publicAdmin(admin) {
  return {
    id: admin.id,
    tenantId: admin.tenantId,
    name: admin.name,
    email: admin.email || '',
    phone: admin.phone || '',
    role: admin.role === 'Staff' ? 'StoreKeeper' : admin.role,
    status: admin.status || 'active',
    createdAt: admin.createdAt || null,
  };
}
