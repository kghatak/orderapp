import { HARDCODED_TENANTS } from '../../util/tenant.js';

export const getTenants = (req, res) => {
  res.status(200).json(HARDCODED_TENANTS);
};
