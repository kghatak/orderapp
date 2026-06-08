import { getOutletProductsModel } from '../models/OutletProducts.js';
import { getFirestoreDB } from '../../util/firebase.js';

const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeProductLine = (p, existing) => {
  const productId = p?.productId != null ? String(p.productId).trim() : '';
  if (!productId) return null;

  const prev = existing && typeof existing === 'object' ? existing : {};
  return {
    productId,
    name: p.name != null ? String(p.name) : (prev.name != null ? String(prev.name) : ''),
    category: p.category != null ? String(p.category) : (prev.category != null ? String(prev.category) : ''),
    unit: p.unit != null ? String(p.unit) : (prev.unit != null ? String(prev.unit) : ''),
    price: p.price !== undefined && p.price !== null ? toNum(p.price, 0) : toNum(prev.price, 0),
    quantity: p.quantity !== undefined && p.quantity !== null ? toNum(p.quantity, 0) : toNum(prev.quantity, 0)
  };
};

const isProductLineIncomplete = (line) => {
  if (!line || typeof line !== 'object') return true;
  const name = line.name != null ? String(line.name).trim() : '';
  const category = line.category != null ? String(line.category).trim() : '';
  const unit = line.unit != null ? String(line.unit).trim() : '';
  const price = toNum(line.price, 0);
  return !name || !category || !unit || price <= 0;
};

const fetchFirestoreCatalogProduct = async (db, mapKey) => {
  const key = String(mapKey || '').trim();
  if (!key) return null;

  const byDocId = await db.collection('products').doc(key).get();
  if (byDocId.exists) return byDocId.data();

  const byBusinessId = await db.collection('products').where('productId', '==', key).limit(1).get();
  if (!byBusinessId.empty) return byBusinessId.docs[0].data();

  return null;
};

const catalogToOutletLine = (mapKey, existing, catalog) => {
  const prev = existing && typeof existing === 'object' ? existing : {};
  return {
    productId: mapKey,
    name: prev.name || catalog?.name || '',
    category: prev.category || catalog?.category || '',
    unit: prev.unit || catalog?.unit || '',
    price:
      prev.price != null && toNum(prev.price, 0) > 0 ? toNum(prev.price, 0) : toNum(catalog?.price, 0),
    quantity: toNum(prev.quantity, 0)
  };
};

/**
 * POST /outlet-products
 * Body: { outletId, products: [...], merge?: boolean }
 * Default: replaces entire map. merge=true updates only sent productIds and keeps the rest.
 */
export const upsertOutletProducts = async (req, res) => {
  try {
    const { outletId, products, merge } = req.body || {};

    if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
      return res.status(400).json({ success: false, message: 'outletId is required' });
    }

    if (!Array.isArray(products)) {
      return res.status(400).json({ success: false, message: 'products must be an array' });
    }

    const trimmedOutletId = outletId.trim();
    const OutletProducts = getOutletProductsModel();
    const existingDoc = merge ? await OutletProducts.findOne({ outletId: trimmedOutletId }).lean() : null;
    const productsMap =
      merge &&
      existingDoc?.products &&
      typeof existingDoc.products === 'object' &&
      !Array.isArray(existingDoc.products)
        ? { ...existingDoc.products }
        : {};

    for (const p of products) {
      const productId = p?.productId != null ? String(p.productId).trim() : '';
      if (!productId) {
        return res.status(400).json({ success: false, message: 'Each product must include productId' });
      }

      const line = normalizeProductLine(p, productsMap[productId]);
      if (!line) {
        return res.status(400).json({ success: false, message: 'Each product must include productId' });
      }
      productsMap[productId] = line;
    }

    const productCount = Object.keys(productsMap).length;
    const updatedAt = new Date();

    const doc = await OutletProducts.findOneAndUpdate(
      { outletId: trimmedOutletId },
      { $set: { products: productsMap, productCount, updatedAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.status(200).json({
      success: true,
      message: merge ? 'Outlet products merged' : 'Outlet products saved',
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
 * PATCH /outlet-products/:productId
 * Body: { outletId, name?, category?, unit?, price?, quantity? }
 * Updates one product without replacing the full outlet catalog.
 */
export const patchOutletProduct = async (req, res) => {
  try {
    const mapKey = req.params.productId != null ? String(req.params.productId).trim() : '';
    const { outletId, name, category, unit, price, quantity } = req.body || {};

    if (!mapKey) {
      return res.status(400).json({ success: false, message: 'productId path parameter is required' });
    }
    if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
      return res.status(400).json({ success: false, message: 'outletId is required' });
    }

    const hasPatch =
      name !== undefined ||
      category !== undefined ||
      unit !== undefined ||
      price !== undefined ||
      quantity !== undefined;

    if (!hasPatch) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: name, category, unit, price, quantity'
      });
    }

    const trimmedOutletId = outletId.trim();
    const OutletProducts = getOutletProductsModel();
    const doc = await OutletProducts.findOne({ outletId: trimmedOutletId });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Outlet products not found' });
    }

    const productsMap =
      doc.products && typeof doc.products === 'object' && !Array.isArray(doc.products)
        ? doc.products
        : {};
    const existing = productsMap[mapKey];
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found for this outlet' });
    }

    const patch = { productId: mapKey, ...existing };
    if (name !== undefined) patch.name = String(name);
    if (category !== undefined) patch.category = String(category);
    if (unit !== undefined) patch.unit = String(unit);
    if (price !== undefined) patch.price = toNum(price, 0);
    if (quantity !== undefined) patch.quantity = toNum(quantity, 0);

    productsMap[mapKey] = patch;
    doc.products = productsMap;
    doc.productCount = Object.keys(productsMap).length;
    doc.updatedAt = new Date();
    doc.markModified('products');
    await doc.save();

    res.status(200).json({
      success: true,
      message: 'Outlet product updated',
      data: {
        outletId: doc.outletId,
        product: patch,
        productCount: doc.productCount,
        updatedAt: doc.updatedAt
      }
    });
  } catch (err) {
    console.error('patchOutletProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to update outlet product' });
  }
};

/**
 * POST /outlet-products/repair-missing
 * Body or query: outletId
 * Fills missing name/category/unit/price from Firestore master products.
 */
export const repairMissingOutletProducts = async (req, res) => {
  try {
    const outletId = req.body?.outletId ?? req.query?.outletId;
    if (!outletId || typeof outletId !== 'string' || !String(outletId).trim()) {
      return res.status(400).json({ success: false, message: 'outletId is required' });
    }

    const trimmedOutletId = String(outletId).trim();
    const OutletProducts = getOutletProductsModel();
    const doc = await OutletProducts.findOne({ outletId: trimmedOutletId });
    if (!doc?.products || typeof doc.products !== 'object' || Array.isArray(doc.products)) {
      return res.status(404).json({ success: false, message: 'Outlet products not found' });
    }

    const db = getFirestoreDB();
    let repaired = 0;
    let skipped = 0;
    let notFound = 0;

    for (const [mapKey, line] of Object.entries(doc.products)) {
      if (!isProductLineIncomplete(line)) {
        skipped++;
        continue;
      }

      const catalog = await fetchFirestoreCatalogProduct(db, mapKey);
      if (!catalog) {
        notFound++;
        continue;
      }

      doc.products[mapKey] = catalogToOutletLine(mapKey, line, catalog);
      repaired++;
    }

    if (repaired > 0) {
      doc.updatedAt = new Date();
      doc.markModified('products');
      await doc.save();
    }

    res.status(200).json({
      success: true,
      message: repaired > 0 ? 'Missing outlet product details repaired' : 'No incomplete products found',
      data: {
        outletId: trimmedOutletId,
        repaired,
        skipped,
        notFoundInCatalog: notFound,
        productCount: Object.keys(doc.products).length,
        updatedAt: doc.updatedAt
      }
    });
  } catch (err) {
    console.error('repairMissingOutletProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to repair outlet products' });
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
