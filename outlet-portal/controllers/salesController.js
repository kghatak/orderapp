import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';
import { getOutletProductsModel } from '../models/OutletProducts.js';
import { getOutletProductQuantityModel } from '../models/OutletProductQuantity.js';
import { getSaleModel } from '../models/Sale.js';
import { generateSaleId } from '../util/businessIds.js';

const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Flatten driver/Mongoose error text (nested cause, errorResponse). */
const mongoErrorText = (e) => {
  if (!e) return '';
  const bits = [];
  let cur = e;
  let depth = 0;
  while (cur && depth < 6) {
    if (typeof cur.message === 'string' && cur.message) bits.push(cur.message);
    if (typeof cur.errmsg === 'string' && cur.errmsg) bits.push(cur.errmsg);
    if (cur.errorResponse && typeof cur.errorResponse.errmsg === 'string') {
      bits.push(cur.errorResponse.errmsg);
    }
    cur = cur.cause || cur.reason;
    depth++;
  }
  return bits.join(' ');
};

/** Standalone MongoDB / non-RS clusters cannot run multi-doc transactions. */
const isTransactionUnsupportedError = (e) => {
  const m = mongoErrorText(e);
  const lower = m.toLowerCase();
  const code = e?.code ?? e?.errorResponse?.code;
  if (code === 20 && /transaction|replica|mongos|session/i.test(m)) return true;
  return (
    lower.includes('transaction numbers are only allowed') ||
    lower.includes('replica set member') ||
    lower.includes('mongos') ||
    lower.includes('transactions are not supported') ||
    lower.includes('does not support transactions') ||
    lower.includes('multi-document transaction') ||
    (lower.includes('transaction') && lower.includes('replica set'))
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
 * Subtracts sold quantities from MongoDB `OutletProductQuantities` for this outlet.
 * Each quantity floors at 0. Runs inside optional Mongoose session (transaction).
 */
const decrementOutletProductQuantitiesForSale = async (outletId, normalizedItems, session) => {
  const quantityTotals = soldQtyByProductId(normalizedItems);
  if (quantityTotals.size === 0) return;

  const OutletProductQuantity = getOutletProductQuantityModel();
  const now = new Date();
  const q = OutletProductQuantity.findOne({ outletId, products: { $exists: true } });
  const doc = session ? await q.session(session) : await q;
  const productsMap =
    doc?.products && typeof doc.products === 'object' && !Array.isArray(doc.products)
      ? doc.products
      : {};

  let touched = false;
  for (const [productId, soldTotal] of quantityTotals) {
    const current = Number(productsMap?.[productId]?.quantity);
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const nextQuantity = Math.max(0, safeCurrent - soldTotal);
    productsMap[productId] = { productId, quantity: nextQuantity };
    touched = true;
  }

  if (touched) {
    const payload = {
      outletId,
      products: productsMap,
      productCount: Object.keys(productsMap).length,
      updatedAt: now
    };
    if (doc) {
      doc.products = payload.products;
      doc.productCount = payload.productCount;
      doc.updatedAt = payload.updatedAt;
      doc.markModified('products');
      await doc.save(session ? { session } : {});
    } else if (session) {
      await OutletProductQuantity.deleteMany({ outletId }, { session });
      await OutletProductQuantity.create([payload], { session });
    } else {
      await OutletProductQuantity.deleteMany({ outletId });
      await OutletProductQuantity.create(payload);
    }
  }
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

  await decrementOutletProductQuantitiesForSale(outletId, normalizedItems, session);
};

/**
 * Adds quantities back to MongoDB `Products` for this outlet (reverses a sale decrement).
 */
const incrementOutletProductsForSale = async (outletId, normalizedItems, session) => {
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
    entry.quantity = safeCurrent + soldTotal;
    touched = true;
  }

  if (touched) {
    doc.updatedAt = new Date();
    doc.markModified('products');
    await doc.save(session ? { session } : {});
  }

  const OutletProductQuantity = getOutletProductQuantityModel();
  const now = new Date();
  const quantityQuery = OutletProductQuantity.findOne({ outletId, products: { $exists: true } });
  const quantityDoc = session ? await quantityQuery.session(session) : await quantityQuery;
  const productsMap =
    quantityDoc?.products && typeof quantityDoc.products === 'object' && !Array.isArray(quantityDoc.products)
      ? quantityDoc.products
      : {};

  let quantityTouched = false;
  for (const [productId, soldTotal] of totals) {
    const current = Number(productsMap?.[productId]?.quantity);
    const safeCurrent = Number.isFinite(current) ? current : 0;
    productsMap[productId] = { productId, quantity: safeCurrent + soldTotal };
    quantityTouched = true;
  }

  if (quantityTouched) {
    const payload = {
      outletId,
      products: productsMap,
      productCount: Object.keys(productsMap).length,
      updatedAt: now
    };
    if (quantityDoc) {
      quantityDoc.products = payload.products;
      quantityDoc.productCount = payload.productCount;
      quantityDoc.updatedAt = payload.updatedAt;
      quantityDoc.markModified('products');
      await quantityDoc.save(session ? { session } : {});
    } else if (session) {
      await OutletProductQuantity.deleteMany({ outletId }, { session });
      await OutletProductQuantity.create([payload], { session });
    } else {
      await OutletProductQuantity.deleteMany({ outletId });
      await OutletProductQuantity.create(payload);
    }
  }
};

/**
 * Validates POST/PATCH sale body. Returns normalized fields or an error object for res.status().json().
 */
const parseSaleBody = (body, authOutletId) => {
  const { outletId, customer, items, subtotal, discount, total, paymentMode } = body;

  if (!outletId || typeof outletId !== 'string') {
    return { error: { status: 400, json: { success: false, message: 'outletId is required' } } };
  }

  if (outletId !== authOutletId) {
    return {
      error: {
        status: 403,
        json: { success: false, message: 'outletId does not match authenticated outlet user' }
      }
    };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: { status: 400, json: { success: false, message: 'items must be a non-empty array' } } };
  }

  if (subtotal === undefined || subtotal === null || Number.isNaN(Number(subtotal))) {
    return { error: { status: 400, json: { success: false, message: 'subtotal is required' } } };
  }

  if (total === undefined || total === null || Number.isNaN(Number(total))) {
    return { error: { status: 400, json: { success: false, message: 'total is required' } } };
  }

  const mode =
    paymentMode != null && typeof paymentMode === 'string' ? paymentMode.trim() : '';
  if (!['Cash', 'Card', 'UPI'].includes(mode)) {
    return {
      error: {
        status: 400,
        json: {
          success: false,
          message: 'paymentMode is required and must be "Cash", "Card", or "UPI"'
        }
      }
    };
  }

  const normalizedItems = [];
  let sumLines = 0;

  for (const line of items) {
    if (!line || line.productId === undefined || line.productId === null || line.productId === '') {
      return {
        error: {
          status: 400,
          json: { success: false, message: 'Each item must include productId' }
        }
      };
    }
    const qty = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const lineTotal = Number(line.lineTotal);
    if (Number.isNaN(qty) || qty <= 0 || Number.isNaN(unitPrice) || Number.isNaN(lineTotal)) {
      return {
        error: {
          status: 400,
          json: { success: false, message: 'Each item needs valid quantity, unitPrice, and lineTotal' }
        }
      };
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

  const subtotalNum = roundMoney(subtotal);
  sumLines = roundMoney(sumLines);
  if (Math.abs(subtotalNum - sumLines) > 0.02) {
    return {
      error: {
        status: 400,
        json: {
          success: false,
          message: `subtotal (${subtotalNum}) does not match sum of line totals (${sumLines})`
        }
      }
    };
  }

  let discountDoc;
  if (discount != null && Object.keys(discount).length > 0) {
    if (typeof discount !== 'object') {
      return {
        error: { status: 400, json: { success: false, message: 'discount must be an object when provided' } }
      };
    }
    const dType = discount.type;
    if (dType !== '%' && dType !== '₹') {
      return {
        error: { status: 400, json: { success: false, message: 'discount.type must be "%" or "₹"' } }
      };
    }
    const dValue = Number(discount.value);
    const dAmount = Number(discount.amount);
    if (!Number.isFinite(dValue) || !Number.isFinite(dAmount) || dAmount < 0) {
      return {
        error: {
          status: 400,
          json: {
            success: false,
            message: 'discount.value and discount.amount must be valid numbers; amount must be >= 0'
          }
        }
      };
    }
    if (dAmount > subtotalNum + 0.02) {
      return {
        error: { status: 400, json: { success: false, message: 'discount.amount cannot exceed subtotal' } }
      };
    }
    if (dType === '%') {
      const expected = roundMoney((subtotalNum * dValue) / 100);
      if (Math.abs(expected - roundMoney(dAmount)) > 0.02) {
        return {
          error: {
            status: 400,
            json: {
              success: false,
              message: `discount.amount (${dAmount}) does not match ${dValue}% of subtotal (expected ${expected})`
            }
          }
        };
      }
    } else {
      if (Math.abs(dValue - dAmount) > 0.02) {
        return {
          error: {
            status: 400,
            json: {
              success: false,
              message: 'For fixed (₹) discount, discount.value and discount.amount should match'
            }
          }
        };
      }
    }
    discountDoc = {
      type: dType,
      value: roundMoney(dValue),
      amount: roundMoney(dAmount)
    };
  }

  const totalNum = roundMoney(total);
  const expectedTotal = discountDoc
    ? roundMoney(subtotalNum - discountDoc.amount)
    : subtotalNum;
  if (Math.abs(totalNum - expectedTotal) > 0.02) {
    return {
      error: {
        status: 400,
        json: {
          success: false,
          message: discountDoc
            ? `total (${totalNum}) must equal subtotal minus discount (${expectedTotal})`
            : `total (${totalNum}) must equal subtotal (${subtotalNum}) when no discount`
        }
      }
    };
  }

  const customerDoc =
    customer && typeof customer === 'object'
      ? {
          name: customer.name?.trim?.() || undefined,
          phone: customer.phone?.trim?.() || undefined,
          address: customer.address?.trim?.() || undefined
        }
      : {};

  return {
    value: {
      normalizedItems,
      subtotalNum,
      discountDoc,
      totalNum,
      mode,
      customerDoc
    }
  };
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
 * Body: {
 *   outletId, customer?, items[],
 *   subtotal (sum of line totals, pre-discount),
 *   discount? { type: "%" | "₹", value, amount },
 *   total (after discount),
 *   paymentMode: "Cash" | "Card" | "UPI"
 * }
 */
export const createSale = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const parsed = parseSaleBody(req.body, auth.outletId);
    if (parsed.error) {
      return res.status(parsed.error.status).json(parsed.error.json);
    }
    const { normalizedItems, subtotalNum, discountDoc, totalNum, mode, customerDoc } = parsed.value;

    const saleId = generateSaleId(auth.outletId);
    const Sale = getSaleModel();
    const salePayload = {
      saleId,
      tenantId: auth.tenantId,
      outletId: auth.outletId,
      firestoreUserId: auth.userId,
      customer: customerDoc,
      items: normalizedItems,
      subtotal: subtotalNum,
      ...(discountDoc ? { discount: discountDoc } : {}),
      total: totalNum,
      paymentMode: mode
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
      if (txErr?.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: txErr.message });
      }
      if (isTransactionUnsupportedError(txErr)) {
        try {
          sale = await Sale.create(salePayload);
          await decrementOutletProductsForSale(auth.outletId, normalizedItems, null);
        } catch (fallbackErr) {
          console.error('Create sale (no transaction) error:', fallbackErr);
          if (fallbackErr?.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: fallbackErr.message });
          }
          if (fallbackErr?.code === 11000) {
            return res.status(409).json({
              success: false,
              message: 'Duplicate sale id; retry the request.'
            });
          }
          const detail = mongoErrorText(fallbackErr) || fallbackErr?.message || 'Failed to create sale';
          return res.status(500).json({ success: false, message: detail });
        }
      } else if (txErr?.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'Duplicate sale id; retry the request.'
        });
      } else {
        console.error('Create sale transaction error:', txErr);
        const detail = mongoErrorText(txErr) || 'Failed to create sale';
        return res.status(500).json({ success: false, message: detail });
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

/**
 * PATCH /sales/:id
 * id: MongoDB _id or business saleId (e.g. OUTID113-SALE-1775682117898).
 * Body: same shape as POST /sales; optional saleId must match the existing document when sent.
 * Restores outlet product quantities from the previous lines, updates the sale, then applies new lines.
 */
export const updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const auth = req.portalAuth;
    const Sale = getSaleModel();
    const scope = { tenantId: auth.tenantId, outletId: auth.outletId };

    let saleDoc = null;
    if (mongoose.isValidObjectId(id)) {
      saleDoc = await Sale.findOne({ _id: id, ...scope });
    }
    if (!saleDoc && typeof id === 'string' && id.trim()) {
      saleDoc = await Sale.findOne({ saleId: id.trim(), ...scope });
    }
    if (!saleDoc) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const bodySaleId = req.body?.saleId;
    if (bodySaleId != null && String(bodySaleId).trim() !== '') {
      if (String(bodySaleId).trim() !== String(saleDoc.saleId)) {
        return res.status(400).json({
          success: false,
          message: 'saleId in body does not match this sale document'
        });
      }
    }

    const parsed = parseSaleBody(req.body, auth.outletId);
    if (parsed.error) {
      return res.status(parsed.error.status).json(parsed.error.json);
    }
    const { normalizedItems, subtotalNum, discountDoc, totalNum, mode, customerDoc } = parsed.value;

    const oldItems = saleDoc.items.map((line) => ({
      productId: line.productId,
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal
    }));

    const setFields = {
      customer: customerDoc,
      items: normalizedItems,
      subtotal: subtotalNum,
      total: totalNum,
      paymentMode: mode
    };
    if (discountDoc) {
      setFields.discount = discountDoc;
    }
    const mongoUpdate = { $set: setFields };
    if (!discountDoc) {
      mongoUpdate.$unset = { discount: '' };
    }

    const conn = getPortalConnection();
    const session = await conn.startSession();
    try {
      session.startTransaction();
      await incrementOutletProductsForSale(auth.outletId, oldItems, session);
      await Sale.updateOne({ _id: saleDoc._id }, mongoUpdate, { session });
      await decrementOutletProductsForSale(auth.outletId, normalizedItems, session);
      await session.commitTransaction();
    } catch (txErr) {
      await session.abortTransaction().catch(() => {});
      if (txErr?.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: txErr.message });
      }
      if (isTransactionUnsupportedError(txErr)) {
        try {
          await incrementOutletProductsForSale(auth.outletId, oldItems, null);
          await Sale.updateOne({ _id: saleDoc._id }, mongoUpdate);
          await decrementOutletProductsForSale(auth.outletId, normalizedItems, null);
        } catch (fallbackErr) {
          console.error('Update sale (no transaction) error:', fallbackErr);
          if (fallbackErr?.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: fallbackErr.message });
          }
          const detail = mongoErrorText(fallbackErr) || fallbackErr?.message || 'Failed to update sale';
          return res.status(500).json({ success: false, message: detail });
        }
      } else {
        console.error('Update sale transaction error:', txErr);
        const detail = mongoErrorText(txErr) || 'Failed to update sale';
        return res.status(500).json({ success: false, message: detail });
      }
    } finally {
      session.endSession();
    }

    const fresh = await Sale.findById(saleDoc._id).lean();
    const { _id, __v, ...rest } = fresh;
    res.status(200).json({
      success: true,
      message: 'Sale updated',
      data: { id: _id, ...rest }
    });
  } catch (err) {
    console.error('Update sale error:', err);
    res.status(500).json({ success: false, message: 'Failed to update sale' });
  }
};
