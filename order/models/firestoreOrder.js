import mongoose from 'mongoose';
import { getPortalConnection } from '../../outlet-portal/config/portalDb.js';

/**
 * Mirror of a Firestore `orders` document, stored in the outlet portal database.
 * `_id` is the Firestore document id. Every other field is stored as-is
 * (`strict: false`), including names like "Created at" and "total amount".
 */
const firestoreOrderSchema = new mongoose.Schema(
  {
    _id: { type: String },
  },
  {
    strict: false,
    versionKey: false,
    collection: 'orders',
    minimize: false,
  }
);

firestoreOrderSchema.index({ tenantId: 1, 'Created at._seconds': -1 });
firestoreOrderSchema.index({ tenantId: 1, outletId: 1, 'Created at._seconds': -1 });
firestoreOrderSchema.index({ tenantId: 1, status: 1, 'deliveredDate._seconds': -1 });
firestoreOrderSchema.index({ outletId: 1, status: 1, 'deliveredDate._seconds': -1 });
firestoreOrderSchema.index({ parentOrder: 1 });

export const getFirestoreOrderModel = () => {
  const conn = getPortalConnection();
  return conn.models.FirestoreOrder || conn.model('FirestoreOrder', firestoreOrderSchema);
};
