import { hashToken } from './passwords.js';
import { HttpError, sendData } from './http.js';
import { findUserByEmail, findUserById, findUserByResetHash, publicUser, updateUser } from './repository.js';
import { assertEmail, assertPassword } from './validate.js';
import { signSuperAdminToken } from './authMiddleware.js';
import { completeTenantSetPassword } from './tenantPassword.js';

export async function login(req, res) {
  const email = assertEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = await findUserByEmail(email);
  if (!user || user.status === 'inactive') {
    throw new HttpError(401, 'Invalid email or password.');
  }
  if (!user.password) {
    throw new HttpError(401, 'This account has no password.');
  }
  if (user.password !== password) {
    throw new HttpError(401, 'Invalid email or password.');
  }
  sendData(res, { token: signSuperAdminToken(user), user: publicUser(user) }, 'Login successful');
}

export async function session(req, res) {
  const user = await findUserById(req.superAdmin.userId);
  if (!user || user.status === 'inactive') {
    throw new HttpError(401, 'Session is no longer valid.');
  }
  sendData(res, publicUser(user));
}

export async function logout(_req, res) {
  sendData(res, null, 'Signed out');
}

export async function setPassword(req, res) {
  const token = String(req.body?.token || '').trim();
  const password = assertPassword(req.body?.password, req.body?.confirmPassword);
  if (token.length < 16) {
    throw new HttpError(400, 'This link is invalid or has expired.');
  }
  const user = await findUserByResetHash(hashToken(token));
  if (!user) {
    const updated = await completeTenantSetPassword(token, password);
    if (!updated) throw new HttpError(400, 'This link is invalid or has expired.');
    sendData(res, { message: 'Password updated. Sign in at https://admin.nannumilk.com with this phone number.' });
    return;
  }
  if (!user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt).getTime() < Date.now()) {
    throw new HttpError(400, 'This link is invalid or has expired.');
  }
  await updateUser(user.id, {
    password,
    status: user.status === 'invited' ? 'active' : user.status,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });
  sendData(res, { message: 'Password updated. You can sign in.' });
}
