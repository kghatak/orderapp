/**
 * Middleware to ensure tenantId is available.
 * Extracts from X-Tenant-Id header or from JWT (req.user.tenantId).
 * Use after milkAuthMiddleware for protected routes.
 */
export const milkTenantMiddleware = (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'] || req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant ID is required. Provide X-Tenant-Id header or use authenticated token.'
    });
  }
  req.tenantId = tenantId;
  next();
};
