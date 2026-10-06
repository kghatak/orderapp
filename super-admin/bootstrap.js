import { getFirestoreDB } from '../util/firebase.js';
import { canonicalizeTenantId, isAllowedOrderTenantId, TENANTS } from '../util/tenantMiddleware.js';
import {
  createAdmin,
  createTenant,
  createUser,
  findUserByEmail,
  listAdmins,
  listUsers,
  updateAdmin,
  updateUser,
  listTenants,
  outletCounts,
  reformatSuperAdminIds,
} from './repository.js';

const KNOWN = [
  { code: TENANTS.NAANU_MILK, name: 'Naanu Milk', business: 'Naanu Milk' },
  { code: TENANTS.TEST, name: 'Test', business: 'Test' },
];

export async function bootstrapSuperAdmin() {
  await reformatSuperAdminIds();
  await ensureConsoleUser();
  await markConsoleUsers();
  await syncTenantsFromExistingData();
}

async function markConsoleUsers() {
  const users = await listUsers();
  for (const user of users) {
    if (user.role !== 'superAdmin') await updateUser(user.id, { role: 'superAdmin' });
  }
}

const CONSOLE_EMAIL = 'super-admin@gmail.com';
const CONSOLE_PASSWORD = 'superadmin';

async function ensureConsoleUser() {
  const email = CONSOLE_EMAIL;
  const existing = await findUserByEmail(email);
  if (existing) {
    await updateUser(existing.id, {
      name: 'Admin',
      role: 'superAdmin',
      password: CONSOLE_PASSWORD,
      status: 'active',
    });
    return;
  }
  await createUser({
    name: 'Admin',
    email,
    role: 'superAdmin',
    password: CONSOLE_PASSWORD,
    status: 'active',
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });
  console.log(`Admin account ready for ${email}`);
}

export async function syncTenantsFromExistingData() {
  const existing = await listTenants();
  const byCode = new Map(existing.map((tenant) => [tenant.code, tenant]));

  for (const known of KNOWN) {
    if (!byCode.has(known.code)) {
      const created = await createTenant({
        code: known.code,
        name: known.name,
        business: known.business,
        email: '',
        phone: '',
        status: 'active',
        whatsappStatus: 'not_started',
      });
      byCode.set(created.code, created);
    }
  }

  const counts = await outletCounts();
  for (const code of counts.keys()) {
    if (byCode.has(code) || !isAllowedOrderTenantId(code)) continue;
    const created = await createTenant({
      code,
      name: code,
      business: code,
      email: '',
      phone: '',
      status: 'active',
      whatsappStatus: 'not_started',
    });
    byCode.set(code, created);
  }

  await linkExistingOrderAdmins(byCode);
  return byCode;
}

async function linkExistingOrderAdmins(tenantsByCode) {
  const snap = await getFirestoreDB().collection('users').get();
  const admins = await listAdmins();
  for (const admin of admins) {
    if (admin.role === 'Staff') await updateAdmin(admin.id, { role: 'StoreKeeper' });
  }
  const linked = new Set(admins.map((admin) => admin.externalUserId).filter(Boolean));
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const profile = data.userProfile;
    if (profile !== 'Admin' && profile !== 'StoreKeeper') continue;
    const externalUserId = data.userId || doc.id;
    if (linked.has(externalUserId)) continue;
    linked.add(externalUserId);

    const code = canonicalizeTenantId(data.tenantId) || TENANTS.NAANU_MILK;
    let tenant = tenantsByCode.get(code);
    if (!tenant && isAllowedOrderTenantId(code)) {
      tenant = await createTenant({
        code,
        name: code,
        business: code,
        email: '',
        phone: '',
        status: 'active',
        whatsappStatus: 'not_started',
      });
      tenantsByCode.set(code, tenant);
    }
    if (!tenant) continue;

    await createAdmin({
      tenantId: tenant.id,
      name: data.phoneNumber || externalUserId,
      email: '',
      phone: String(data.phoneNumber || '').replace(/\D/g, ''),
      role: profile === 'Admin' ? 'Admin' : 'StoreKeeper',
      status: 'active',
      externalUserId,
    });
  }
}
