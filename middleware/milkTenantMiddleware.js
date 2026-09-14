/**
 * After milkAuthMiddleware. Tenant comes from the JWT stamped at login
 * (order admin = refine-auth tenantId). Header may match; it cannot switch tenants.
 */
export const milkTenantMiddleware = (req, res, next) => {
  const jwtTenant =
    typeof req.user?.tenantId === 'string' ? req.user.tenantId.trim() : '';
  if (!jwtTenant) {
    return res.status(400).json({
      success: false,
      message: 'Tenant ID is required.',
    });
  }

  const headerRaw = req.headers['x-tenant-id'];
  const headerTenant = typeof headerRaw === 'string' ? headerRaw.trim() : '';
  if (headerTenant && headerTenant !== jwtTenant) {
    return res.status(403).json({
      success: false,
      message: 'Tenant ID does not match session.',
    });
  }

  req.tenantId = jwtTenant;
  next();
};
