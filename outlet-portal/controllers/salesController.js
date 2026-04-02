import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';
import { getOutletProductsModel } from '../models/OutletProducts.js';
import { getSaleModel } from '../models/Sale.js';
import { generateSaleId } from '../util/businessIds.js';

const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const isTransactionUnsupportedError = (e) => {
  const m = e && e.message ? String(e.message) : '';
  return (
    m.includes('Transaction numbers are only allowed') ||
    m.includes('replica set member') ||
    m.includes('mongos')
  );
};

/**
 * Sums sold quantity per productId (handles duplicate lines).
 * @param {{ productId: string, quantity: number }[]} normalizedItems
 * @returns {Map<string, number>}
 */
const soldQtyByProductId = (normalizedItems) => {
  const map = new Map();
  for (const line of normalizedItems) {
    const pid = line.productId;
    const q = Number(line.quantity);
    if (!Number.isFinite(q) || q <= 0) continue;
    map.set(pid, (map.get(pid) || 0) + q);
  }
  return map;
};

/**
 * Subtracts sold quantities from MongoDB `Products` for this outlet (keys must exist).
 * Each quantity floors at 0. Runs inside optional Mongoose session (transaction).
 */
const decrementOutletProductsForSale = async (outletId, normalizedItems, session) => {
  const totals = soldQtyByProductId(normalizedItems);
  if (totals.size === 0) return;

  const OutletProducts = getOutletProductsModel();
  const q = OutletProducts.findOne({ outletId });
  const doc = session ? await q.session(session) : await q;

  if (!doc?.products || typeof doc.products !== 'object' || Array.isArray(doc.products)) {
    return;
  }

  let touched = false;
  for (const [pid, soldTotal] of totals) {
    if (!Object.prototype.hasOwnProperty.call(doc.products, pid)) {
      continue;
    }
    const entry = doc.products[pid];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const current = Number(entry.quantity);
    const safeCurrent = Number.isFinite(current) ? current : 0;
    entry.quantity = Math.max(0, safeCurrent - soldTotal);
    touched = true;
  }

  if (touched) {
    doc.updatedAt = new Date();
    doc.markModified('products');
    await doc.save(session ? { session } : {});
  }
};

const serializeSale = (doc) => {
  const s = doc.toObject ? doc.toObject() : { ...doc };
  const id = s._id;
  delete s._id;
  delete s.__v;
  return { id, ...s };
};

/**
 * GET /sales
 * Query: limit (default 50, max 100), skip (default 0)
 * Returns sales for the authenticated outlet only.
 */
export const listSales = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);

    const Sale = getSaleModel();
    const filter = { tenantId: auth.tenantId, outletId: auth.outletId };

    const [rows, total] = await Promise.all([
      Sale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: rows.map((row) => {
        const { _id, __v, ...rest } = row;
        return { id: _id, ...rest };
      }),
      pagination: { total, limit, skip, hasMore: skip + rows.length < total }
    });
  } catch (err) {
    console.error('List sales error:', err);
    res.status(500).json({ success: false, message: 'Failed to list sales' });
  }
};

/**
 * GET /sales/:id
 * id may be MongoDB ObjectId or business saleId (e.g. OUTID099-SALE-1730000000000).
 */
export const getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    const auth = req.portalAuth;
    const Sale = getSaleModel();

    const scope = { tenantId: auth.tenantId, outletId: auth.outletId };
    let sale = null;

    if (mongoose.isValidObjectId(id)) {
      sale = await Sale.findOne({ _id: id, ...scope }).lean();
    }
    if (!sale && typeof id === 'string' && id.trim()) {
      sale = await Sale.findOne({ saleId: id.trim(), ...scope }).lean();
    }

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const { _id, __v, ...rest } = sale;
    res.status(200).json({
      success: true,
      data: { id: _id, ...rest }
    });
  } catch (err) {
    console.error('Get sale error:', err);
    res.status(500).json({ success: false, message: 'Failed to get sale' });
  }
};

/**
 * POST /sales
 * Requires: Authorization: Bearer <portal login token>
 * Body: { outletId, customer?, items[], total }
 */
export const createSale = async (req, res) => {
  try {
    const { outletId, customer, items, total } = req.body;
    const auth = req.portalAuth;

    if (!outletId || typeof outletId !== 'string') {
      return res.status(400).json({ success: false, message: 'outletId is required' });
    }

    if (outletId !== auth.outletId) {
      return res.status(403).json({
        success: false,
        message: 'outletId does not match authenticated outlet user'
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items must be a non-empty array' });
    }

    if (total === undefined || total === null || Number.isNaN(Number(total))) {
      return res.status(400).json({ success: false, message: 'total is required' });
    }

    const normalizedItems = [];
    let sumLines = 0;

    for (const line of items) {
      if (!line || line.productId === undefined || line.productId === null || line.productId === '') {
        return res.status(400).json({
          success: false,
          message: 'Each item must include productId'
        });
      }
      const qty = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const lineTotal = Number(line.lineTotal);
      if (Number.isNaN(qty) || qty <= 0 || Number.isNaN(unitPrice) || Number.isNaN(lineTotal)) {
        return res.status(400).json({
          success: false,
          message: 'Each item needs valid quantity, unitPrice, and lineTotal'
        });
      }
      sumLines += lineTotal;
      normalizedItems.push({
        productId: String(line.productId),
        name: line.name != null ? String(line.name) : '',
        unitPrice: roundMoney(unitPrice),
        quantity: qty,
        lineTotal: roundMoney(lineTotal)
      });
    }

    const totalNum = roundMoney(total);
    sumLines = roundMoney(sumLines);
    if (Math.abs(totalNum - sumLines) > 0.02) {
      return res.status(400).json({
        success: false,
        message: `total (${totalNum}) does not match sum of line totals (${sumLines})`
      });
    }

    const customerDoc =
      customer && typeof customer === 'object'
        ? {
            name: customer.name?.trim?.() || undefined,
            phone: customer.phone?.trim?.() || undefined,
            address: customer.address?.trim?.() || undefined
          }
        : {};

    const saleId = generateSaleId(auth.outletId);
    const Sale = getSaleModel();
    const salePayload = {
      saleId,
      tenantId: auth.tenantId,
      outletId: auth.outletId,
      firestoreUserId: auth.userId,
      customer: customerDoc,
      items: normalizedItems,
      total: totalNum
    };

    const conn = getPortalConnection();
    const session = await conn.startSession();
    let sale;
    try {
      session.startTransaction();
      const created = await Sale.create([salePayload], { session });
      sale = created[0];
      await decrementOutletProductsForSale(auth.outletId, normalizedItems, session);
      await session.commitTransaction();
    } catch (txErr) {
      await session.abortTransaction().catch(() => {});
      if (isTransactionUnsupportedError(txErr)) {
        sale = await Sale.create(salePayload);
        await decrementOutletProductsForSale(auth.outletId, normalizedItems, null);
      } else {
        console.error('Create sale transaction error:', txErr);
        return res.status(500).json({ success: false, message: 'Failed to create sale' });
      }
    } finally {
      session.endSession();
    }

    res.status(201).json({
      success: true,
      message: 'Sale recorded',
      data: serializeSale(sale)
    });
  } catch (err) {
    console.error('Create sale error:', err);
    res.status(500).json({ success: false, message: 'Failed to create sale' });
  }
};
