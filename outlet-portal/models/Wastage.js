import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

const wastageSchema = new mongoose.Schema(
  {
    tenantId:    { type: String, required: true, index: true },
    outletId:    { type: String, required: true, index: true },
    name:        { type: String, trim: true },
    productId:   { type: String, required: true, trim: true },
    productName: { type: String, trim: true },
    quantity:    { type: Number, required: true },
    unit:        { type: String, trim: true },
    price:       { type: Number },
    reason:      { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    customerAddress: { type: String, trim: true },
    status:      { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    date:        { type: String, index: true },
    createdAt:   { type: Date, default: Date.now },
    updatedAt:   { type: Date, default: Date.now }
  },
  { collection: 'Wastages', timestamps: false }
);

wastageSchema.index({ tenantId: 1, outletId: 1, date: -1, createdAt: -1 });

export const getWastageModel = () => {
  const conn = getPortalConnection();
  return conn.models.Wastage || conn.model('Wastage', wastageSchema, 'Wastages');
};
