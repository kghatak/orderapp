import { getOutletProductQuantityModel } from '../models/OutletProductQuantity.js';

/**
 * GET /outlet-product-quantities?outletId=...&limit=...&skip=...
 */
export const listOutletProductQuantities = async (req, res) => {
  try {
    const outletId = req.query.outletId;
    if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'outletId query parameter is required'
      });
    }

    const trimmedOutletId = outletId.trim();

    const OutletProductQuantity = getOutletProductQuantityModel();
    let doc = await OutletProductQuantity.findOne({
      outletId: trimmedOutletId,
      products: { $exists: true }
    }).lean();

    res.status(200).json({
      success: true,
      data: doc
        ? {
            id: doc._id,
            outletId: doc.outletId,
            products: doc.products || {},
            productCount:
              Number.isFinite(Number(doc.productCount))
                ? Number(doc.productCount)
                : Object.keys(doc.products || {}).length,
            updatedAt: doc.updatedAt || null
          }
        : {
            outletId: trimmedOutletId,
            products: {},
            productCount: 0,
            updatedAt: null
          }
    });
  } catch (err) {
    console.error('listOutletProductQuantities error:', err);
    res.status(500).json({ success: false, message: 'Failed to load outlet product quantities' });
  }
};

/**
 * GET /outlet-product-quantities/:outletId/:productId
 */
export const getOutletProductQuantityByIds = async (req, res) => {
  try {
    const outletId = req.params.outletId;
    const productId = req.params.productId;

    if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
      return res.status(400).json({ success: false, message: 'outletId path parameter is required' });
    }

    if (!productId || typeof productId !== 'string' || !productId.trim()) {
      return res.status(400).json({ success: false, message: 'productId path parameter is required' });
    }

    const OutletProductQuantity = getOutletProductQuantityModel();
    let doc = await OutletProductQuantity.findOne({
      outletId: outletId.trim(),
      products: { $exists: true }
    }).lean();

    const product = doc?.products?.[productId.trim()];
    if (!doc || !product) {
      return res.status(404).json({
        success: false,
        message: 'Quantity row not found for this outlet/product'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: doc._id,
        outletId: doc.outletId,
        productId: productId.trim(),
        quantity: Number.isFinite(Number(product?.quantity)) ? Number(product.quantity) : 0,
        updatedAt: doc.updatedAt || null
      }
    });
  } catch (err) {
    console.error('getOutletProductQuantityByIds error:', err);
    res.status(500).json({ success: false, message: 'Failed to load outlet product quantity' });
  }
};

/**
 * POST /outlet-product-quantities/migrate-legacy
 * Converts legacy per-product rows into one grouped document per outlet.
 */
export const migrateLegacyOutletProductQuantities = async (_req, res) => {
  try {
    const OutletProductQuantity = getOutletProductQuantityModel();

    const legacyRows = await OutletProductQuantity.find({
      productId: { $exists: true },
      outletId: { $exists: true }
    }).lean();

    if (legacyRows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No legacy outlet product quantity rows found.',
        legacyRowsScanned: 0,
        outletsMigrated: 0,
        rowsDeleted: 0
      });
    }

    const byOutlet = new Map();
    for (const row of legacyRows) {
      const outletId = row?.outletId != null ? String(row.outletId).trim() : '';
      const productId = row?.productId != null ? String(row.productId).trim() : '';
      if (!outletId || !productId) continue;

      if (!byOutlet.has(outletId)) {
        byOutlet.set(outletId, {
          rows: [],
          products: {}
        });
      }

      const bucket = byOutlet.get(outletId);
      bucket.rows.push(row);
      const prev = bucket.products[productId];
      const nextUpdated = row?.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      const prevUpdated = prev?.updatedAt ? new Date(prev.updatedAt).getTime() : -1;
      // If duplicates exist for same productId, keep the latest row.
      if (!prev || nextUpdated >= prevUpdated) {
        bucket.products[productId] = {
          productId,
          quantity: Number.isFinite(Number(row?.quantity)) ? Number(row.quantity) : 0,
          updatedAt: row?.updatedAt || null
        };
      }
    }

    let outletsMigrated = 0;
    let rowsDeleted = 0;
    const now = new Date();

    for (const [outletId, bucket] of byOutlet.entries()) {
      const groupedDoc = await OutletProductQuantity.findOne({
        outletId,
        products: { $exists: true }
      });

      const mergedProducts =
        groupedDoc?.products && typeof groupedDoc.products === 'object' && !Array.isArray(groupedDoc.products)
          ? { ...groupedDoc.products }
          : {};

      for (const [productId, rowData] of Object.entries(bucket.products)) {
        mergedProducts[productId] = {
          productId,
          quantity: Number.isFinite(Number(rowData?.quantity)) ? Number(rowData.quantity) : 0
        };
      }

      const payload = {
        outletId,
        products: mergedProducts,
        productCount: Object.keys(mergedProducts).length,
        updatedAt: now
      };

      if (groupedDoc) {
        groupedDoc.products = payload.products;
        groupedDoc.productCount = payload.productCount;
        groupedDoc.updatedAt = payload.updatedAt;
        groupedDoc.markModified('products');
        await groupedDoc.save();
      } else {
        await OutletProductQuantity.create(payload);
      }

      const legacyIds = bucket.rows.map((row) => row._id).filter(Boolean);
      if (legacyIds.length > 0) {
        const deleteResult = await OutletProductQuantity.deleteMany({ _id: { $in: legacyIds } });
        rowsDeleted += deleteResult?.deletedCount || 0;
      }

      outletsMigrated++;
    }

    res.status(200).json({
      success: true,
      message: 'Legacy outlet product quantity rows migrated successfully.',
      legacyRowsScanned: legacyRows.length,
      outletsMigrated,
      rowsDeleted
    });
  } catch (err) {
    console.error('migrateLegacyOutletProductQuantities error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to migrate legacy outlet product quantities'
    });
  }
};
