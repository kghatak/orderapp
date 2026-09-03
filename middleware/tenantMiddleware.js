import { resolveRequestTenantId } from '../util/tenant.js';

export const attachTenant = (req, res, next) => {
  const resolved = resolveRequestTenantId(req);
  if (resolved.error) {
    console.log(`[API] tenant reject ${req.method} ${req.originalUrl} -> ${resolved.error}`);
    return res.status(400).json({ error: resolved.error });
  }
  req.tenantId = resolved.tenantId;
  const tag = resolved.tenantId === 'test_tenant' ? 'TEST_TENANT' : resolved.tenantId;
  console.log(`[API] tenant=${tag} ${req.method} ${req.originalUrl}`);
  next();
};
