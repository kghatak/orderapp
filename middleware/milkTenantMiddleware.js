import { canonicalizeTenantId, TENANTS } from '../util/tenantMiddleware.js';

/**
 * After milkAuthMiddleware. Tenant comes from the JWT stamped at login
 * (order admin = refine-auth tenantId). Header may match; it cannot switch tenants.
 * Missing header / TENANT001 = NM2026 (old staging order-admin).
 */
export const milkTenantMiddleware = (req, res, next) => {
  const jwtTenant = canonicalizeTenantId(req.user?.tenantId || '');
  const headerRaw = req.headers['x-tenant-id'];
  const headerTenant = canonicalizeTenantId(
    typeof headerRaw === 'string' ? headerRaw : '',
  );

  const tenantId = jwtTenant || headerTenant || TENANTS.NAANU_MILK;

  if (headerTenant && jwtTenant && headerTenant !== jwtTenant) {
    return res.status(403).json({
      success: false,
      message: 'Tenant ID does not match session.',
    });
  }

  req.tenantId = tenantId;
  next();
};
