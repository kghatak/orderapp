import mongoose from 'mongoose';
import { getWastageModel } from '../models/Wastage.js';
import { getOutletProductQuantityModel } from '../models/OutletProductQuantity.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseYmd = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const d = String(value).trim();
  if (!DATE_RE.test(d)) return { error: `${label} must be in yyyy-mm-dd format` };
  return d;
};

const serialize = (doc) => {
  const { _id, __v, ...rest } = doc.toObject ? doc.toObject() : doc;
  return { id: _id, ...rest };
};

const findWastage = async (id, auth) => {
  if (!id || !mongoose.isValidObjectId(id)) {
    return { err: { status: 400, message: 'Valid wastage id is required' } };
  }
  const Wastage = getWastageModel();
  const doc = await Wastage.findOne({ _id: id, tenantId: auth.tenantId, outletId: auth.outletId });
  if (!doc) return { err: { status: 404, message: 'Wastage record not found' } };
  return { doc };
};

export const listWastages = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
    const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);

    const start = parseYmd(req.query.startDate, 'startDate');
    if (start?.error) return res.status(400).json({ success: false, message: start.error });
    const end = parseYmd(req.query.endDate, 'endDate');
    if (end?.error) return res.status(400).json({ success: false, message: end.error });

    const filter = { tenantId: auth.tenantId, outletId: auth.outletId };
    if (start || end) {
      if (start && end && start > end) {
        return res.status(400).json({ success: false, message: 'startDate must be on or before endDate' });
      }
      filter.date = {};
      if (start) filter.date.$gte = start;
      if (end) filter.date.$lte = end;
    }

    const Wastage = getWastageModel();
    const [rows, total] = await Promise.all([
      Wastage.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Wastage.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: rows.map(serialize),
      pagination: { total, limit, skip, hasMore: skip + rows.length < total }
    });
  } catch (err) {
    console.error('listWastages error:', err);
    res.status(500).json({ success: false, message: 'Failed to list wastage records' });
  }
};

export const createWastage = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const { outletId, name, productId, productName, quantity, unit, price, reason, date } = req.body || {};

    if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
      return res.status(400).json({ success: false, message: 'outletId is required' });
    }
    if (outletId.trim() !== auth.outletId) {
      return res.status(403).json({ success: false, message: 'outletId does not match authenticated outlet' });
    }
    if (!productId || typeof productId !== 'string' || !productId.trim()) {
      return res.status(400).json({ success: false, message: 'productId is required' });
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'quantity must be greater than 0' });
    }

    const parsedDate = parseYmd(date, 'date');
    if (parsedDate?.error) return res.status(400).json({ success: false, message: parsedDate.error });

    const now = new Date();
    const payload = {
      tenantId: auth.tenantId,
      outletId: auth.outletId,
      productId: String(productId).trim(),
      quantity: qty,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    if (typeof name === 'string') payload.name = name.trim();
    if (typeof productName === 'string') payload.productName = productName.trim();
    if (typeof unit === 'string') payload.unit = unit.trim();
    if (price != null && !Number.isNaN(Number(price))) payload.price = Number(price);
    if (reason != null) payload.reason = String(reason).trim();
    if (parsedDate) payload.date = parsedDate;

    const doc = await getWastageModel().create(payload);
    res.status(201).json({ success: true, message: 'Wastage record created', data: serialize(doc) });
  } catch (err) {
    console.error('createWastage error:', err);
    res.status(500).json({ success: false, message: 'Failed to create wastage record' });
  }
};

export const updateWastage = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const body = req.body || {};
    const { outletId, name, productId, productName, quantity, unit, price, reason, date } = body;

    if (outletId !== undefined && outletId !== null && String(outletId).trim() !== '') {
      if (String(outletId).trim() !== auth.outletId) {
        return res.status(403).json({ success: false, message: 'outletId does not match authenticated outlet' });
      }
    }

    const hasPatch =
      name !== undefined ||
      productId !== undefined ||
      productName !== undefined ||
      quantity !== undefined ||
      unit !== undefined ||
      price !== undefined ||
      reason !== undefined ||
      date !== undefined;

    if (!hasPatch) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: name, productId, productName, quantity, unit, price, reason, date'
      });
    }

    const found = await findWastage(req.params.id, auth);
    if (found.err) return res.status(found.err.status).json({ success: false, message: found.err.message });

    const { doc } = found;
    if (doc.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Only pending wastage can be updated (current status: ${doc.status})`
      });
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'name cannot be empty' });
      }
      doc.name = name.trim();
    }
    if (productId !== undefined) {
      if (typeof productId !== 'string' || !productId.trim()) {
        return res.status(400).json({ success: false, message: 'productId cannot be empty' });
      }
      doc.productId = productId.trim();
    }
    if (productName !== undefined) {
      if (typeof productName !== 'string') {
        return res.status(400).json({ success: false, message: 'productName must be a string' });
      }
      doc.productName = productName.trim();
    }
    if (quantity !== undefined) {
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ success: false, message: 'quantity must be greater than 0' });
      }
      doc.quantity = qty;
    }
    if (unit !== undefined) {
      if (typeof unit !== 'string') {
        return res.status(400).json({ success: false, message: 'unit must be a string' });
      }
      doc.unit = unit.trim();
    }
    if (price !== undefined) {
      if (price === null || Number.isNaN(Number(price))) {
        return res.status(400).json({ success: false, message: 'price must be a valid number' });
      }
      doc.price = Number(price);
    }
    if (reason !== undefined) {
      if (reason === null) {
        return res.status(400).json({ success: false, message: 'reason cannot be null' });
      }
      doc.reason = String(reason).trim();
    }
    if (date !== undefined) {
      if (date === null || String(date).trim() === '') {
        return res.status(400).json({ success: false, message: 'date cannot be empty when provided' });
      }
      const parsedDate = parseYmd(date, 'date');
      if (parsedDate?.error) return res.status(400).json({ success: false, message: parsedDate.error });
      doc.date = parsedDate;
    }

    doc.updatedAt = new Date();
    await doc.save();

    res.status(200).json({ success: true, message: 'Wastage updated', data: serialize(doc) });
  } catch (err) {
    console.error('updateWastage error:', err);
    res.status(500).json({ success: false, message: 'Failed to update wastage' });
  }
};

export const deleteWastage = async (req, res) => {
  try {
    const found = await findWastage(req.params.id, req.portalAuth);
    if (found.err) return res.status(found.err.status).json({ success: false, message: found.err.message });

    const { doc } = found;
    if (doc.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Only pending wastage can be deleted (current status: ${doc.status})`
      });
    }

    const id = doc._id;
    await doc.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Wastage deleted',
      data: { id }
    });
  } catch (err) {
    console.error('deleteWastage error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete wastage' });
  }
};

export const rejectWastage = async (req, res) => {
  try {
    const found = await findWastage(req.params.id, req.portalAuth);
    if (found.err) return res.status(found.err.status).json({ success: false, message: found.err.message });

    const { doc } = found;
    if (doc.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Wastage cannot be rejected (current status: ${doc.status})`
      });
    }

    doc.status = 'rejected';
    doc.updatedAt = new Date();
    await doc.save();

    res.status(200).json({ success: true, message: 'Wastage rejected', data: serialize(doc) });
  } catch (err) {
    console.error('rejectWastage error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject wastage' });
  }
};

export const acceptWastage = async (req, res) => {
  try {
    const found = await findWastage(req.params.id, req.portalAuth);
    if (found.err) return res.status(found.err.status).json({ success: false, message: found.err.message });

    const { doc } = found;
    if (doc.status === 'accepted') {
      return res.status(400).json({ success: false, message: 'Wastage already accepted' });
    }
    if (doc.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Wastage cannot be accepted (current status: ${doc.status})`
      });
    }

    doc.status = 'accepted';
    doc.updatedAt = new Date();
    await doc.save();

    const qtyDoc = await getOutletProductQuantityModel().findOne({ outletId: doc.outletId });
    if (qtyDoc?.products && typeof qtyDoc.products === 'object') {
      const current = Number(qtyDoc.products[doc.productId]?.quantity) || 0;
      qtyDoc.products[doc.productId] = {
        productId: doc.productId,
        quantity: Math.max(0, current - doc.quantity)
      };
      qtyDoc.markModified('products');
      qtyDoc.updatedAt = new Date();
      await qtyDoc.save();
    }

    res.status(200).json({
      success: true,
      message: 'Wastage accepted and stock deducted',
      data: serialize(doc)
    });
  } catch (err) {
    console.error('acceptWastage error:', err);
    res.status(500).json({ success: false, message: 'Failed to accept wastage' });
  }
};
