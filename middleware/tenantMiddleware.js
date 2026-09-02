import { resolveRequestTenantId } from '../util/tenant.js';

export const attachTenant = (req, res, next) => {
  const resolved = resolveRequestTenantId(req);
  if (resolved.error) {
    return res.status(400).json({ error: resolved.error });
  }
  req.tenantId = resolved.tenantId;
  next();
};
