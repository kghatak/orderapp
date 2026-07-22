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

const salePaymentSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['Cash', 'Card', 'UPI'], required: true },
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
  /** Cash / Card / UPI = paid at sale time; Due = sold on credit; Split = mixed modes at sale time */
  paymentMode: { type: String, enum: ['Cash', 'Card', 'UPI', 'Due', 'Split'], required: true },
  /** Required when paymentMode is Split. Sum of amounts must equal total. */
  payments: { type: [salePaymentSchema], default: undefined },
  /**
   * pending = payment not yet received (typically paymentMode Due).
   * collected = amount received or paid-at-POS (Cash/Card/UPI).
   * Legacy docs without this field are treated as collected when paymentMode is not Due.
   */
  paymentStatus: { type: String, enum: ['pending', 'collected'], default: 'collected' },
  /** When paymentStatus became collected (null while pending on Due). */
  collectedAt: { type: Date, default: null },
  /** Unguessable token for public bill view / PDF download links. */
  billToken: { type: String, index: true, sparse: true },
  /** Outlet header snapshot at sale time (for WhatsApp bill links). */
  outletSnapshot: {
    name: { type: String },
    address: { type: String },
    gstNo: { type: String }
  },
  /** Staff name shown on receipt (from POS session). */
  cashierName: { type: String },
  createdAt: { type: Date, default: Date.now }
});

saleSchema.index({ tenantId: 1, outletId: 1, createdAt: -1 });
saleSchema.index({ tenantId: 1, outletId: 1, saleId: 1 }, { unique: true });

export const getSaleModel = () => {
  const conn = getPortalConnection();
  return conn.models.Sale || conn.model('Sale', saleSchema);
};
