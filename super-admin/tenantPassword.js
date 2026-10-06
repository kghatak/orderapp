import { getFirestoreDB } from '../util/firebase.js';
import { NannuUser } from '../order/models/NannuUser.js';
import { nextTenantCounter } from '../util/tenantCounter.js';
import { canonicalizeTenantId, TENANTS } from '../util/tenantMiddleware.js';
import { phoneMatchVariants, sendWhatsAppTemplate } from '../util/whatsapp.js';
import { createToken, hashToken } from './passwords.js';
import { createAdmin, findTenantByResetHash, listAdmins, updateTenant } from './repository.js';
import { HttpError } from './http.js';

const RESET_MINUTES = 60;
export const SET_PASSWORD_TEMPLATE = 'tenant_set_password';

function appBaseUrl() {
  return (process.env.TENANT_ADMIN_APP_URL || 'https://admin.nannumilk.com').replace(/\/$/, '');
}

function loginPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function userTenantCode(data) {
  const raw = String(data?.tenantId || '').trim();
  return canonicalizeTenantId(raw) || (raw ? '' : TENANTS.NAANU_MILK);
}

async function ensureTenantAdmin(tenant, externalUserId, phone) {
  const admins = await listAdmins();
  if (admins.some((admin) => admin.externalUserId === externalUserId)) return;
  await createAdmin({
    tenantId: tenant.id,
    name: tenant.name,
    email: tenant.email || '',
    phone,
    role: 'Admin',
    status: 'active',
    externalUserId,
  });
}

async function ensureOrderAdmin(tenant) {
  const db = getFirestoreDB();
  const phone = loginPhone(tenant.phone);
  const variants = phoneMatchVariants(tenant.phone).slice(0, 10);
  const snap = await db.collection('users').where('phoneNumber', 'in', variants).limit(5).get();
  const existing = snap.docs.find((doc) => {
    const data = doc.data() || {};
    return data.createdBy === 'super-admin' && userTenantCode(data) === tenant.code;
  });
  if (existing) {
    const data = existing.data() || {};
    const userId = data.userId || existing.id;
    await ensureTenantAdmin(tenant, userId, data.phoneNumber || phone);
    return { userId: existing.id };
  }
  if (!snap.empty) return { conflict: true };

  const { globalCount } = await nextTenantCounter(db, 'userCounter', tenant.code);
  const userId = `UID${String(globalCount).padStart(4, '0')}`;
  const user = new NannuUser({
    userId,
    phoneNumber: phone,
    password: '',
    outletId: null,
    userProfile: 'Admin',
    tenantId: tenant.code,
    enableNotification: true,
    fcmToken: '',
  });
  await db.collection('users').doc(userId).set({ ...user, createdBy: 'super-admin' });
  await ensureTenantAdmin(tenant, userId, phone);
  return { userId };
}

export async function sendTenantSetPassword(tenant) {
  const ensured = await ensureOrderAdmin(tenant);
  if (ensured.conflict) {
    return {
      sent: false,
      statusCode: 409,
      notice: `Tenant saved. ${loginPhone(tenant.phone)} already belongs to another account, so the set-password WhatsApp was not sent.`,
    };
  }

  const token = createToken();
  const expires = new Date(Date.now() + RESET_MINUTES * 60 * 1000).toISOString();
  await updateTenant(tenant.id, {
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: expires,
    passwordResetUserId: ensured.userId,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log(`Tenant set-password link for ${tenant.code}: ${appBaseUrl()}/set-password?token=${token}`);
  }

  const templateName = String(process.env.WHATSAPP_ONBOARDING_TEMPLATE || SET_PASSWORD_TEMPLATE).trim();
  const result = await sendWhatsAppTemplate(
    tenant.phone,
    templateName,
    {
      tenant_name: tenant.name || tenant.code,
      business_name: tenant.business || tenant.name || tenant.code,
    },
    'en',
    { urlButtonSuffix: token },
  );

  if (!result?.ok) {
    console.error('Tenant set-password WhatsApp failed:', result?.error);
    return {
      sent: false,
      statusCode: 502,
      notice: 'Tenant saved. The set-password WhatsApp was not sent. Approve tenant_set_password in MSG91, then resend from the tenant row.',
    };
  }

  await updateTenant(tenant.id, { whatsappStatus: 'pending' });
  return {
    sent: true,
    statusCode: 200,
    notice: `Tenant saved. A WhatsApp message was sent to ${loginPhone(tenant.phone)}. They open it, set a password, then sign in at https://admin.nannumilk.com. The link expires in 60 minutes.`,
  };
}

export async function completeTenantSetPassword(token, password) {
  const tenant = await findTenantByResetHash(hashToken(token));
  if (!tenant || !tenant.passwordResetExpiresAt || new Date(tenant.passwordResetExpiresAt).getTime() < Date.now()) {
    return false;
  }
  if (!tenant.passwordResetUserId) return false;

  const ref = getFirestoreDB().collection('users').doc(tenant.passwordResetUserId);
  const doc = await ref.get();
  if (!doc.exists) throw new HttpError(400, 'This link is invalid or has expired.');

  await ref.set({ password, updatedAt: new Date() }, { merge: true });
  await updateTenant(tenant.id, {
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null,
    passwordResetUserId: null,
    whatsappStatus: 'onboarded',
  });
  return true;
}
