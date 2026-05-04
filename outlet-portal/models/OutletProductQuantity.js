import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

/**
 * One document per outlet. `products` is a map: productId -> { productId, quantity }.
 * MongoDB collection name: OutletProductQuantities
 */
const outletProductQuantitySchema = new mongoose.Schema(
  {
    outletId: { type: String, required: true, index: true, trim: true },
    products: { type: mongoose.Schema.Types.Mixed, default: {} },
    productCount: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'OutletProductQuantities', timestamps: true }
);

outletProductQuantitySchema.index({ outletId: 1 });

export const getOutletProductQuantityModel = () => {
  const conn = getPortalConnection();
  return (
    conn.models.OutletProductQuantity ||
    conn.model('OutletProductQuantity', outletProductQuantitySchema)
  );
};
