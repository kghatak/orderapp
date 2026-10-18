import { canonicalizeTenantId, isAllowedOrderTenantId } from '../util/tenantMiddleware.js';
import { FEATURE_KEYS } from './features.js';
import { TENANT_ROLES } from './permissions.js';
import { HttpError } from './http.js';

export function normalizeTenantCode(value) {
  const canonical = canonicalizeTenantId(value);
  if (!canonical || !isAllowedOrderTenantId(canonical)) return '';
  if (/^T\d{4,}$/i.test(canonical)) return canonical.toUpperCase();
  return canonical;
}

export function assertTenantCode(value) {
  const code = normalizeTenantCode(value);
  if (!code) {
    throw new HttpError(400, 'Enter a tenant code up to 64 characters. Avoid . * ~ / [ ].');
  }
  return code;
}

export function assertEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email.');
  }
  return email;
}

export function assertPhone(value) {
  const phone = String(value || '').replace(/\s/g, '');
  if (!/^\d{10,15}$/.test(phone)) {
    throw new HttpError(400, 'Enter a phone number with 10 to 15 digits.');
  }
  return phone;
}

export function assertName(value, label) {
  const name = String(value || '').trim();
  if (!name) throw new HttpError(400, `${label} is required.`);
  return name;
}

export function assertRole(value) {
  if (!TENANT_ROLES.includes(value)) {
    throw new HttpError(400, 'Role must be Admin or StoreKeeper.');
  }
  return value;
}

export function assertFeatures(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) {
    throw new HttpError(400, 'Features must be a list of feature names.');
  }
  const allowed = new Set(FEATURE_KEYS);
  const next = [];
  value.forEach((key) => {
    if (!allowed.has(key)) throw new HttpError(400, `Unknown feature: ${key}.`);
    if (!next.includes(key)) next.push(key);
  });
  return next;
}

export function assertStatus(value, allowed) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `Status must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

export function assertPassword(password, confirmPassword) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters.');
  }
  if (password !== confirmPassword) {
    throw new HttpError(400, 'Passwords do not match.');
  }
  return password;
}
