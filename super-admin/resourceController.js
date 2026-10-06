import { permissionCatalog } from './permissions.js';
import { sendTenantSetPassword } from './tenantPassword.js';
import { HttpError, sendData } from './http.js';
import {
  addActivity,
  createAdmin,
  createTenant,
  findAdminById,
  findTenantByCode,
  findTenantById,
  findUserByEmail,
  findUserById,
  listActivity,
  listAdmins,
  listTenants,
  listUsers,
  outletCounts,
  paginate,
  publicAdmin,
  publicTenant,
  publicUser,
  updateAdmin,
  updateTenant,
  updateUser,
} from './repository.js';
import {
  assertEmail,
  assertName,
  assertPhone,
  assertRole,
  assertStatus,
  assertTenantCode,
} from './validate.js';

function matches(value, query) {
  return String(value || '').toLowerCase().includes(query);
}

function withOutletCount(tenant, counts) {
  return publicTenant(tenant, counts.get(tenant.code) || 0);
}

export async function dashboard(_req, res) {
  const [tenants, admins, counts, activity] = await Promise.all([
    listTenants(),
    listAdmins(),
    outletCounts(),
    listActivity(8),
  ]);
  const recentTenants = [...tenants]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((tenant) => withOutletCount(tenant, counts));
  sendData(res, {
    totals: {
      tenants: tenants.length,
      activeTenants: tenants.filter((tenant) => tenant.status === 'active').length,
      admins: admins.filter((admin) => admin.status === 'active').length,
      outlets: [...counts.values()].reduce((sum, count) => sum + count, 0),
    },
    recentTenants,
    activity,
  });
}

export async function permissions(_req, res) {
  sendData(res, permissionCatalog());
}

export async function getTenants(req, res) {
  const counts = await outletCounts();
  const query = String(req.query.search || '').trim().toLowerCase();
  const status = req.query.status || 'all';
  const filtered = (await listTenants())
    .filter((tenant) => (status === 'all' ? true : tenant.status === status))
    .filter((tenant) => {
      if (!query) return true;
      return [tenant.name, tenant.business, tenant.email, tenant.phone, tenant.code].some((field) =>
        matches(field, query),
      );
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((tenant) => withOutletCount(tenant, counts));
  sendData(res, paginate(filtered, req.query.page, req.query.pageSize));
}

export async function tenantOptions(_req, res) {
  const tenants = await listTenants();
  sendData(
    res,
    tenants
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tenant) => ({ id: tenant.id, name: tenant.name, code: tenant.code })),
  );
}

export async function postTenant(req, res) {
  const code = assertTenantCode(req.body?.code);
  if (await findTenantByCode(code)) {
    throw new HttpError(409, 'A tenant with this code already exists.');
  }
  const tenant = await createTenant({
    code,
    name: assertName(req.body?.name, 'Name'),
    business: assertName(req.body?.business, 'Business'),
    email: assertEmail(req.body?.email),
    phone: assertPhone(req.body?.phone),
  });
  const delivery = await sendTenantSetPassword(tenant);
  await addActivity(`${tenant.name} was added`, 'tenant');
  if (delivery.sent) await addActivity(`Set-password WhatsApp sent for ${tenant.name}`, 'whatsapp');
  const counts = await outletCounts();
  const saved = await findTenantById(tenant.id);
  sendData(res, { ...withOutletCount(saved, counts), notice: delivery.notice }, delivery.notice, 201);
}

export async function patchTenant(req, res) {
  const existing = await findTenantById(req.params.id);
  if (!existing) throw new HttpError(404, 'Tenant not found.');
  const code = assertTenantCode(req.body?.code);
  if (code !== existing.code && (await findTenantByCode(code))) {
    throw new HttpError(409, 'A tenant with this code already exists.');
  }
  const tenant = await updateTenant(existing.id, {
    code,
    name: assertName(req.body?.name, 'Name'),
    business: assertName(req.body?.business, 'Business'),
    email: assertEmail(req.body?.email),
    phone: assertPhone(req.body?.phone),
  });
  await addActivity(`${tenant.name} was updated`, 'tenant');
  const counts = await outletCounts();
  sendData(res, withOutletCount(tenant, counts), 'Tenant updated');
}

export async function patchTenantStatus(req, res) {
  const status = assertStatus(req.body?.status, ['active', 'inactive']);
  const existing = await findTenantById(req.params.id);
  if (!existing) throw new HttpError(404, 'Tenant not found.');
  const tenant = await updateTenant(existing.id, { status });
  await addActivity(`${tenant.name} was ${status === 'active' ? 'activated' : 'deactivated'}`, 'tenant');
  const counts = await outletCounts();
  sendData(res, withOutletCount(tenant, counts));
}

export async function onboardWhatsapp(req, res) {
  const tenant = await findTenantById(req.params.id);
  if (!tenant) throw new HttpError(404, 'Tenant not found.');
  if (!tenant.phone) throw new HttpError(400, 'This tenant has no phone number.');
  const delivery = await sendTenantSetPassword(tenant);
  if (!delivery.sent) throw new HttpError(delivery.statusCode, delivery.notice);
  await addActivity(`Set-password WhatsApp sent for ${tenant.name}`, 'whatsapp');
  sendData(res, {
    tenantId: tenant.id,
    status: 'pending',
    message: delivery.notice,
  });
}

export async function getAdmins(req, res) {
  const query = String(req.query.search || '').trim().toLowerCase();
  const tenantId = req.query.tenantId || 'all';
  const role = req.query.role || 'all';
  const filtered = (await listAdmins())
    .filter((admin) => tenantId === 'all' || admin.tenantId === tenantId)
    .filter((admin) => role === 'all' || admin.role === role)
    .filter((admin) => {
      if (!query) return true;
      return [admin.name, admin.email, admin.phone].some((field) => matches(field, query));
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicAdmin);
  sendData(res, paginate(filtered, req.query.page, req.query.pageSize));
}

async function adminBody(body) {
  const tenant = await findTenantById(body?.tenantId);
  if (!tenant) throw new HttpError(400, 'Choose a tenant.');
  return {
    tenantId: tenant.id,
    name: assertName(body?.name, 'Name'),
    email: assertEmail(body?.email),
    phone: assertPhone(body?.phone),
    role: assertRole(body?.role),
  };
}

export async function postAdmin(req, res) {
  const input = await adminBody(req.body);
  const admin = await createAdmin(input);
  const tenant = await findTenantById(admin.tenantId);
  await addActivity(`${admin.name} added as ${admin.role} at ${tenant?.name || 'a tenant'}`, 'admin');
  sendData(res, publicAdmin(admin), 'Tenant admin created', 201);
}

export async function patchAdmin(req, res) {
  const existing = await findAdminById(req.params.id);
  if (!existing) throw new HttpError(404, 'Tenant admin not found.');
  const input = await adminBody(req.body);
  const admin = await updateAdmin(existing.id, input);
  await addActivity(`${admin.name} was updated`, 'admin');
  sendData(res, publicAdmin(admin), 'Tenant admin updated');
}

export async function patchAdminStatus(req, res) {
  const status = assertStatus(req.body?.status, ['active', 'inactive']);
  const existing = await findAdminById(req.params.id);
  if (!existing) throw new HttpError(404, 'Tenant admin not found.');
  const admin = await updateAdmin(existing.id, { status });
  await addActivity(`${admin.name} was ${status === 'active' ? 'activated' : 'deactivated'}`, 'admin');
  sendData(res, publicAdmin(admin));
}

export async function getUsers(req, res) {
  const query = String(req.query.search || '').trim().toLowerCase();
  const status = req.query.status || 'all';
  const filtered = (await listUsers())
    .filter((user) => status === 'all' || user.status === status)
    .filter((user) => !query || [user.name, user.email].some((field) => matches(field, query)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicUser);
  sendData(res, paginate(filtered, req.query.page, req.query.pageSize));
}

export async function patchUser(req, res) {
  const existing = await findUserById(req.params.id);
  if (!existing) throw new HttpError(404, 'User not found.');
  const email = assertEmail(req.body?.email);
  const other = await findUserByEmail(email);
  if (other && other.id !== existing.id) {
    throw new HttpError(409, 'A user with this email already exists.');
  }
  const user = await updateUser(existing.id, {
    name: assertName(req.body?.name, 'Name'),
    email,
  });
  await addActivity(`${user.name} was updated`, 'user');
  sendData(res, publicUser(user), 'User updated');
}

export async function patchUserStatus(req, res) {
  const status = assertStatus(req.body?.status, ['active', 'inactive']);
  const existing = await findUserById(req.params.id);
  if (!existing) throw new HttpError(404, 'User not found.');
  const user = await updateUser(existing.id, { status });
  await addActivity(`${user.name} was ${status === 'active' ? 'activated' : 'deactivated'}`, 'user');
  sendData(res, publicUser(user));
}
