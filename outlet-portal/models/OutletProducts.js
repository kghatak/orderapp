import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

/**
 * One document per outlet. `products` is a plain object map: productId -> line fields.
 * MongoDB collection name: Products
 */
const outletProductsSchema = new mongoose.Schema(
  {
    outletId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, trim: true, index: true },
    products: { type: mongoose.Schema.Types.Mixed, default: {} },
    productCount: { type: Number, default: 0 },
    manualProductCount: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
  },
  { collection: 'Products' }
);

export const getOutletProductsModel = () => {
  const conn = getPortalConnection();
  return conn.models.OutletProducts || conn.model('OutletProducts', outletProductsSchema);
};

/** Writes tenantId onto every product line in the outlet map. */
export const stampProductsMapTenantId = (productsMap, tenantId) => {
  const id = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!id || !productsMap || typeof productsMap !== 'object' || Array.isArray(productsMap)) {
    return false;
  }
  let changed = false;
  for (const line of Object.values(productsMap)) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) continue;
    if (String(line.tenantId || '').trim() !== id) {
      line.tenantId = id;
      changed = true;
    }
  }
  return changed;
};
