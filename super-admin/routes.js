import express from 'express';
import { asyncHandler } from './http.js';
import { requireSuperAdmin } from './authMiddleware.js';
import { login, logout, session, setPassword } from './authController.js';
import {
  dashboard,
  getAdmins,
  getTenants,
  getUsers,
  onboardWhatsapp,
  patchAdmin,
  patchAdminStatus,
  patchTenant,
  patchTenantStatus,
  patchUser,
  patchUserStatus,
  permissions,
  postAdmin,
  postTenant,
  tenantOptions,
} from './resourceController.js';

const router = express.Router();

router.post('/auth/login', asyncHandler(login));
router.post('/auth/set-password', asyncHandler(setPassword));
router.post('/auth/logout', requireSuperAdmin, asyncHandler(logout));
router.get('/auth/session', requireSuperAdmin, asyncHandler(session));

router.use(requireSuperAdmin);
router.get('/dashboard', asyncHandler(dashboard));
router.get('/permissions', asyncHandler(permissions));
router.get('/tenants/options', asyncHandler(tenantOptions));
router.get('/tenants', asyncHandler(getTenants));
router.post('/tenants', asyncHandler(postTenant));
router.patch('/tenants/:id', asyncHandler(patchTenant));
router.patch('/tenants/:id/status', asyncHandler(patchTenantStatus));
router.post('/tenants/:id/whatsapp/onboard', asyncHandler(onboardWhatsapp));
router.get('/tenant-admins', asyncHandler(getAdmins));
router.post('/tenant-admins', asyncHandler(postAdmin));
router.patch('/tenant-admins/:id', asyncHandler(patchAdmin));
router.patch('/tenant-admins/:id/status', asyncHandler(patchAdminStatus));
router.get('/users', asyncHandler(getUsers));
router.patch('/users/:id', asyncHandler(patchUser));
router.patch('/users/:id/status', asyncHandler(patchUserStatus));

export default router;
