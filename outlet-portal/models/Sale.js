import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

const saleLineSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, default: '' },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true },
    lineTotal: { type: Number, required: true }
  },
  { _id: false }
);

const saleDiscountSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['%', '₹'], required: true },
    value: { type: Number, required: true },
    amount: { type: Number, required: true }
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema({
  saleId: { type: String, required: true },
  tenantId: { type: String, required: true, index: true },
  outletId: { type: String, required: true, index: true },
  firestoreUserId: { type: String, index: true },
  customer: {
    name: { type: String },
    phone: { type: String },
    address: { type: String }
  },
  items: { type: [saleLineSchema], required: true },
  /** Sum of line totals (cart) before invoice discount */
  subtotal: { type: Number, required: true },
  discount: { type: saleDiscountSchema, default: undefined },
  /** Final payable amount after discount */
  total: { type: Number, required: true },
  paymentMode: { type: String, enum: ['Cash', 'Card', 'UPI'], required: true },
  createdAt: { type: Date, default: Date.now }
});

saleSchema.index({ tenantId: 1, outletId: 1, createdAt: -1 });
saleSchema.index({ tenantId: 1, outletId: 1, saleId: 1 });
saleSchema.index({ saleId: 1 }, { unique: true, sparse: true });

export const getSaleModel = () => {
  const conn = getPortalConnection();
  return conn.models.Sale || conn.model('Sale', saleSchema);
};
