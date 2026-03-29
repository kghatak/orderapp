import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  firestoreUserId: { type: String, required: true },
  outletId: { type: String, required: true, index: true },
  lastLoginAt: { type: Date, default: Date.now }
});

schema.index({ tenantId: 1, firestoreUserId: 1 }, { unique: true });

export const getPortalOutletUserStateModel = () => {
  const conn = getPortalConnection();
  return conn.models.PortalOutletUserState || conn.model('PortalOutletUserState', schema);
};
