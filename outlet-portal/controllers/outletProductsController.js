import { getOutletProductsModel, stampProductsMapTenantId } from '../models/OutletProducts.js';
import { getFirestoreDB } from '../../util/firebase.js';
import { roundQty } from '../../util/quantities.js';
import { canonicalizeTenantId } from '../../util/tenantMiddleware.js';

/** POS session: JWT outlet + tenant. Request outletId must match; header tenant if sent must match JWT. */
const resolvePortalOutletId = (req, res, requestedRaw, missingMessage) => {
  const auth = req.portalAuth;
  if (!auth?.outletId || !auth?.tenantId) {
    res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    return null;
  }

  const headerTenant = canonicalizeTenantId(
    req.headers['x-tenant-id'] || req.headers['user-tenantid'] || '',
  );
  const jwtTenant = canonicalizeTenantId(auth.tenantId);
  if (headerTenant && headerTenant !== jwtTenant) {
    res.status(403).json({
      success: false,
      message: 'Tenant does not match authenticated session',
    });
    return null;
  }

  const requested = requestedRaw != null ? String(requestedRaw).trim() : '';
  if (!requested) {
    res.status(400).json({ success: false, message: missingMessage });
    return null;
  }
  if (requested !== auth.outletId) {
    res.status(403).json({
      success: false,
      message: 'outletId does not match authenticated outlet',
    });
    return null;
  }
  return requested;
};

const sessionTenantId = (req) => canonicalizeTenantId(req.portalAuth?.tenantId || '');

const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const isManualProductId = (productId) => String(productId || '').trim().startsWith('manual:');

const isManualProductLine = (mapKey, line) =>
  isManualProductId(mapKey) || line?.isManual === true;

const countManualProducts = (productsMap) => {
  if (!productsMap || typeof productsMap !== 'object' || Array.isArray(productsMap)) return 0;
  return Object.entries(productsMap).filter(([key, line]) => isManualProductLine(key, line)).length;
};

const productCountsFromMap = (productsMap) => {
  const productCount = Object.keys(productsMap || {}).length;
  const manualProductCount = countManualProducts(productsMap);
  return { productCount, manualProductCount };
};

const withManualProductCount = (payload, manualProductCount) => {
  if (manualProductCount > 0) {
    payload.manualProductCount = manualProductCount;
  }
  return payload;
};

const normalizeProductLine = (p, existing) => {
  const productId = p?.productId != null ? String(p.productId).trim() : '';
  if (!productId) return null;

  const prev = existing && typeof existing === 'object' ? existing : {};
  const manual = isManualProductId(productId) || p?.isManual === true || prev.isManual === true;
  const line = {
    productId,
    name: p.name != null ? String(p.name) : (prev.name != null ? String(prev.name) : ''),
    category: p.category != null ? String(p.category) : (prev.category != null ? String(prev.category) : ''),
    unit: p.unit != null ? String(p.unit) : (prev.unit != null ? String(prev.unit) : ''),
    price: p.price !== undefined && p.price !== null ? toNum(p.price, 0) : toNum(prev.price, 0),
    quantity:
      p.quantity !== undefined && p.quantity !== null
        ? roundQty(p.quantity, 0)
        : roundQty(prev.quantity, 0)
  };

  if (manual) {
    line.isManual = true;
  }

  return line;
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
    quantity: roundQty(prev.quantity, 0)
  };
};

const withRoundedQuantities = (products, tenantId) => {
  if (!products || typeof products !== 'object' || Array.isArray(products)) return products || {};
  const id = canonicalizeTenantId(tenantId);
  const out = {};
  for (const [key, line] of Object.entries(products)) {
    if (!line || typeof line !== 'object') {
      out[key] = line;
      continue;
    }
    out[key] = {
      ...line,
      quantity: roundQty(line.quantity, 0),
      ...(id ? { tenantId: id } : {})
    };
  }
  return out;
};

/**
 * POST /outlet-products
 * Body: { outletId, products: [...], merge?: boolean }
 * Default: replaces entire map. merge=true updates only sent productIds and keeps the rest.
 */
export const upsertOutletProducts = async (req, res) => {
  try {
    const { outletId, products, merge } = req.body || {};

    const trimmedOutletId = resolvePortalOutletId(req, res, outletId, 'outletId is required');
    if (!trimmedOutletId) return;

    if (!Array.isArray(products)) {
      return res.status(400).json({ success: false, message: 'products must be an array' });
    }

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

      if (isManualProductId(productId)) {
        if (isProductLineIncomplete(line)) {
          return res.status(400).json({
            success: false,
            message: 'Manual products require name, category, unit, and price > 0'
          });
        }
        line.isManual = true;
      }

      productsMap[productId] = line;
    }

    const { productCount, manualProductCount } = productCountsFromMap(productsMap);
    const updatedAt = new Date();
    const tenantId = sessionTenantId(req);
    stampProductsMapTenantId(productsMap, tenantId);

    const doc = await OutletProducts.findOneAndUpdate(
      { outletId: trimmedOutletId },
      {
        $set: { products: productsMap, productCount, manualProductCount, updatedAt },
        $unset: { tenantId: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const savedManualCount = doc.manualProductCount ?? manualProductCount;
    res.status(200).json({
      success: true,
      message: merge ? 'Outlet products merged' : 'Outlet products saved',
      data: withManualProductCount(
        {
          outletId: doc.outletId,
          products: withRoundedQuantities(doc.products || {}, tenantId),
          productCount: doc.productCount ?? productCount,
          updatedAt: doc.updatedAt
        },
        savedManualCount
      )
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
    const trimmedOutletId = resolvePortalOutletId(req, res, outletId, 'outletId is required');
    if (!trimmedOutletId) return;

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
    if (quantity !== undefined) patch.quantity = roundQty(quantity, 0);

    productsMap[mapKey] = patch;
    const tenantId = sessionTenantId(req);
    stampProductsMapTenantId(productsMap, tenantId);
    doc.products = productsMap;
    const counts = productCountsFromMap(productsMap);
    doc.productCount = counts.productCount;
    doc.manualProductCount = counts.manualProductCount;
    doc.tenantId = undefined;
    doc.updatedAt = new Date();
    doc.markModified('products');
    await doc.save();
    await OutletProducts.updateOne({ _id: doc._id }, { $unset: { tenantId: 1 } });

    res.status(200).json({
      success: true,
      message: 'Outlet product updated',
      data: withManualProductCount(
        {
          outletId: doc.outletId,
          product: patch,
          productCount: doc.productCount,
          updatedAt: doc.updatedAt
        },
        doc.manualProductCount
      )
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
    const trimmedOutletId = resolvePortalOutletId(
      req,
      res,
      req.body?.outletId ?? req.query?.outletId,
      'outletId is required',
    );
    if (!trimmedOutletId) return;
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
      if (isManualProductId(mapKey) || line?.isManual === true) {
        skipped++;
        continue;
      }

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

    const tenantId = sessionTenantId(req);
    const linesStamped = stampProductsMapTenantId(doc.products, tenantId);
    const hadDocTenant = canonicalizeTenantId(doc.tenantId);
    if (repaired > 0 || linesStamped || hadDocTenant) {
      if (hadDocTenant) doc.tenantId = undefined;
      doc.updatedAt = new Date();
      if (repaired > 0 || linesStamped) doc.markModified('products');
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
    const trimmedOutletId = resolvePortalOutletId(
      req,
      res,
      req.query.outletId,
      'outletId query parameter is required',
    );
    if (!trimmedOutletId) return;

    const OutletProducts = getOutletProductsModel();
    const doc = await OutletProducts.findOne({ outletId: trimmedOutletId }).lean();

    if (!doc) {
      return res.status(200).json({
        success: true,
        data: {
          outletId: trimmedOutletId,
          products: {},
          productCount: 0,
          updatedAt: null
        }
      });
    }

    const jwtTenant = sessionTenantId(req);
    const lineTenantMissing = stampProductsMapTenantId(doc.products, jwtTenant);
    const hadDocTenant = Boolean(canonicalizeTenantId(doc.tenantId));
    if (lineTenantMissing || hadDocTenant) {
      await OutletProducts.updateOne(
        { outletId: trimmedOutletId },
        {
          ...(lineTenantMissing ? { $set: { products: doc.products } } : {}),
          $unset: { tenantId: 1 },
        },
      );
    }

    const { _id, __v, tenantId: _docTenant, manualProductCount: storedManualCount, ...rest } = doc;
    const counts = productCountsFromMap(rest.products);
    const productCount =
      typeof rest.productCount === 'number' && Number.isFinite(rest.productCount)
        ? rest.productCount
        : counts.productCount;
    const manualProductCount =
      typeof storedManualCount === 'number' && Number.isFinite(storedManualCount)
        ? storedManualCount
        : counts.manualProductCount;

    res.status(200).json({
      success: true,
      data: withManualProductCount(
        {
          id: _id,
          ...rest,
          products: withRoundedQuantities(rest.products, jwtTenant),
          productCount
        },
        manualProductCount
      )
    });
  } catch (err) {
    console.error('getOutletProductsByOutletId error:', err);
    res.status(500).json({ success: false, message: 'Failed to load outlet products' });
  }
};
