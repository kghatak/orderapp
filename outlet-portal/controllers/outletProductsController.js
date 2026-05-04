import { getOutletProductsModel } from '../models/OutletProducts.js';
import { getOutletProductQuantityModel } from '../models/OutletProductQuantity.js';

const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const syncOutletQuantities = async (outletId, productsMap) => {
  const OutletProductQuantity = getOutletProductQuantityModel();
  const now = new Date();
  const entries = Object.entries(productsMap || {});
  const quantityMap = {};
  for (const [productId, product] of entries) {
    quantityMap[productId] = {
      productId,
      quantity: Math.max(0, toNum(product?.quantity, 0))
    };
  }

  // Remove any legacy rows for this outlet, then keep one document per outlet.
  await OutletProductQuantity.deleteMany({ outletId });
  await OutletProductQuantity.create({
    outletId,
    products: quantityMap,
    productCount: Object.keys(quantityMap).length,
    updatedAt: now
  });
};

/**
 * POST /outlet-products
 * Body: { outletId, products: [{ productId, name, category, unit, price, quantity }, ...] }
 * Replaces the entire `products` map (keyed by productId). Duplicate productIds in the array: last wins.
 * An empty array clears all products for the outlet.
 */
export const upsertOutletProducts = async (req, res) => {
  try {
    const { outletId, products } = req.body || {};

    if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
      return res.status(400).json({ success: false, message: 'outletId is required' });
    }

    if (!Array.isArray(products)) {
      return res.status(400).json({ success: false, message: 'products must be an array' });
    }

    const productsMap = {};
    for (const p of products) {
      const productId = p?.productId != null ? String(p.productId).trim() : '';
      if (!productId) {
        return res.status(400).json({ success: false, message: 'Each product must include productId' });
      }

      productsMap[productId] = {
        productId,
        name: p.name != null ? String(p.name) : '',
        category: p.category != null ? String(p.category) : '',
        unit: p.unit != null ? String(p.unit) : '',
        price: toNum(p.price, 0),
        quantity: toNum(p.quantity, 0)
      };
    }

    const trimmedOutletId = outletId.trim();
    const productCount = Object.keys(productsMap).length;
    const updatedAt = new Date();

    const OutletProducts = getOutletProductsModel();
    const doc = await OutletProducts.findOneAndUpdate(
      { outletId: trimmedOutletId },
      { $set: { products: productsMap, productCount, updatedAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    await syncOutletQuantities(trimmedOutletId, productsMap);

    res.status(200).json({
      success: true,
      message: 'Outlet products saved',
      data: {
        outletId: doc.outletId,
        products: doc.products || {},
        productCount: doc.productCount ?? productCount,
        updatedAt: doc.updatedAt
      }
    });
  } catch (err) {
    console.error('upsertOutletProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to save outlet products' });
  }
};

/**
 * GET /outlet-products?outletId=
 */
export const getOutletProductsByOutletId = async (req, res) => {
  try {
    const outletId = req.query.outletId;
    if (!outletId || typeof outletId !== 'string' || !String(outletId).trim()) {
      return res.status(400).json({ success: false, message: 'outletId query parameter is required' });
    }

    const OutletProducts = getOutletProductsModel();
    const doc = await OutletProducts.findOne({ outletId: String(outletId).trim() }).lean();

    if (!doc) {
      return res.status(200).json({
        success: true,
        data: {
          outletId: String(outletId).trim(),
          products: {},
          productCount: 0,
          updatedAt: null
        }
      });
    }

    const { _id, __v, ...rest } = doc;
    const derived =
      rest.products && typeof rest.products === 'object' && !Array.isArray(rest.products)
        ? Object.keys(rest.products).length
        : 0;
    const productCount =
      typeof rest.productCount === 'number' && Number.isFinite(rest.productCount)
        ? rest.productCount
        : derived;

    res.status(200).json({
      success: true,
      data: { id: _id, ...rest, productCount }
    });
  } catch (err) {
    console.error('getOutletProductsByOutletId error:', err);
    res.status(500).json({ success: false, message: 'Failed to load outlet products' });
  }
};
