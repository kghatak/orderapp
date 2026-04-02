import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

/**
 * One document per outlet. `products` is a plain object map: productId -> line fields.
 * MongoDB collection name: Products
 */
const outletProductsSchema = new mongoose.Schema(
  {
    outletId: { type: String, required: true, unique: true, index: true },
    products: { type: mongoose.Schema.Types.Mixed, default: {} },
    productCount: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'Products' }
);

export const getOutletProductsModel = () => {
  const conn = getPortalConnection();
  return conn.models.OutletProducts || conn.model('OutletProducts', outletProductsSchema);
};
