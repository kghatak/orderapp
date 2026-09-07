import { resolveRequestTenantId } from '../util/tenant.js';
import { assertTenantActive } from '../order/controllers/tenantController.js';

export const attachTenant = async (req, res, next) => {
  const resolved = resolveRequestTenantId(req);
  if (resolved.error) {
    console.log(`[API] tenant reject ${req.method} ${req.originalUrl} -> ${resolved.error}`);
    return res.status(400).json({ error: resolved.error });
  }
  req.tenantId = resolved.tenantId;

  try {
    const active = await assertTenantActive(req.tenantId);
    if (!active.ok) {
      console.log(`[API] tenant inactive ${req.tenantId} ${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: active.error });
    }
  } catch (err) {
    console.error('Tenant active check failed:', err);
  }

  console.log(`[API] tenant=${req.tenantId} ${req.method} ${req.originalUrl}`);
  next();
};
