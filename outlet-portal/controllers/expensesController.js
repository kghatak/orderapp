import mongoose from 'mongoose';
import { getExpenseModel } from '../models/Expense.js';
import { generateExpenseId } from '../util/businessIds.js';
const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Resolve expense Mongo document by `_id` or business `expenseId`, scoped to tenant/outlet.
 */
const findExpenseDoc = async (Expense, rawId, scope) => {
  const id = rawId != null ? String(rawId) : '';
  if (!id.trim()) {
    return null;
  }
  if (mongoose.isValidObjectId(id)) {
    const byMongo = await Expense.findOne({ _id: id, ...scope });
    if (byMongo) {
      return byMongo;
    }
  }
  return Expense.findOne({ expenseId: id.trim(), ...scope });
};

/**
 * GET /expenses
 * Query: limit (default 50, max 100), skip
 */
export const listExpenses = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);

    const Expense = getExpenseModel();
    const filter = { tenantId: auth.tenantId, outletId: auth.outletId };

    const [rows, total] = await Promise.all([
      Expense.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Expense.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: rows.map(({ _id, __v, ...rest }) => ({ id: _id, ...rest })),
      pagination: { total, limit, skip, hasMore: skip + rows.length < total }
    });
  } catch (err) {
    console.error('List expenses error:', err);
    res.status(500).json({ success: false, message: 'Failed to list expenses' });
  }
};

/**
 * GET /expenses/:id  — MongoDB ObjectId or business expenseId (e.g. OUTID099-EXP-1730000000000)
 */
export const getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;
    const auth = req.portalAuth;
    const Expense = getExpenseModel();
    const scope = { tenantId: auth.tenantId, outletId: auth.outletId };

    const doc = await findExpenseDoc(Expense, id, scope);
    const row = doc ? doc.toObject() : null;

    if (!row) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    const { _id, __v, ...rest } = row;
    res.status(200).json({ success: true, data: { id: _id, ...rest } });
  } catch (err) {
    console.error('Get expense error:', err);
    res.status(500).json({ success: false, message: 'Failed to get expense' });
  }
};
/**
 * POST /expenses
 * Authorization: Bearer <outlet-portal login token>
 */
export const createExpense = async (req, res) => {
  try {
    const { outletId, type, categoryLabel, amount, date } = req.body;
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

    if (!type || typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({ success: false, message: 'type is required' });
    }

    if (!categoryLabel || typeof categoryLabel !== 'string' || !categoryLabel.trim()) {
      return res.status(400).json({ success: false, message: 'categoryLabel is required' });
    }

    if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
      return res.status(400).json({ success: false, message: 'amount is required' });
    }

    const amt = roundMoney(amount);
    if (amt < 0) {
      return res.status(400).json({ success: false, message: 'amount must be zero or positive' });
    }

    const expenseDate =
      date !== undefined && date !== null && String(date).trim() !== ''
        ? new Date(String(date))
        : new Date();
    if (Number.isNaN(expenseDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'date must be a valid date (e.g. 2026-05-10)'
      });
    }

    const expenseId = generateExpenseId(auth.outletId);
    const Expense = getExpenseModel();
    const doc = await Expense.create({
      expenseId,
      tenantId: auth.tenantId,
      outletId: auth.outletId,
      firestoreUserId: auth.userId,
      type: type.trim(),
      categoryLabel: categoryLabel.trim(),
      amount: amt,
      date: expenseDate
    });
    const row = doc.toObject();
    const { _id, __v, ...rest } = row;
    res.status(201).json({
      success: true,
      message: 'Expense recorded',
      data: { id: _id, ...rest }
    });
  } catch (err) {
    console.error('Create expense error:', err);
    res.status(500).json({ success: false, message: 'Failed to create expense' });
  }
};

/**
 * PATCH /expenses/:id
 * MongoDB ObjectId or business expenseId.
 * Body: optional type, categoryLabel, amount, date, outletId (must match token)
 */
export const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const auth = req.portalAuth;
    const { outletId, type, categoryLabel, amount, date } = req.body || {};

    if (outletId !== undefined && outletId !== null && String(outletId).trim() !== '') {
      if (String(outletId).trim() !== auth.outletId) {
        return res.status(403).json({
          success: false,
          message: 'outletId does not match authenticated outlet user'
        });
      }
    }

    const hasPatch =
      type !== undefined ||
      categoryLabel !== undefined ||
      amount !== undefined ||
      date !== undefined;

    if (!hasPatch) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: type, categoryLabel, amount, date'
      });
    }

    const Expense = getExpenseModel();
    const scope = { tenantId: auth.tenantId, outletId: auth.outletId };
    const doc = await findExpenseDoc(Expense, id, scope);

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    if (type !== undefined) {
      if (typeof type !== 'string' || !type.trim()) {
        return res.status(400).json({ success: false, message: 'type cannot be empty' });
      }
      doc.type = type.trim();
    }
    if (categoryLabel !== undefined) {
      if (typeof categoryLabel !== 'string' || !categoryLabel.trim()) {
        return res.status(400).json({ success: false, message: 'categoryLabel cannot be empty' });
      }
      doc.categoryLabel = categoryLabel.trim();
    }
    if (amount !== undefined) {
      if (amount === null || Number.isNaN(Number(amount))) {
        return res.status(400).json({ success: false, message: 'amount must be a valid number' });
      }
      const amt = roundMoney(amount);
      if (amt < 0) {
        return res.status(400).json({ success: false, message: 'amount must be zero or positive' });
      }
      doc.amount = amt;
    }
    if (date !== undefined) {
      if (date === null || String(date).trim() === '') {
        return res.status(400).json({ success: false, message: 'date cannot be empty when provided' });
      }
      const expenseDate = new Date(String(date));
      if (Number.isNaN(expenseDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'date must be a valid date (e.g. 2026-05-10)'
        });
      }
      doc.date = expenseDate;
    }

    await doc.save();
    const row = doc.toObject();
    const { _id, __v, ...rest } = row;
    res.status(200).json({
      success: true,
      message: 'Expense updated',
      data: { id: _id, ...rest }
    });
  } catch (err) {
    console.error('Update expense error:', err);
    res.status(500).json({ success: false, message: 'Failed to update expense' });
  }
};

/**
 * DELETE /expenses/:id
 * MongoDB ObjectId or business expenseId.
 */
export const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const auth = req.portalAuth;
    const Expense = getExpenseModel();
    const scope = { tenantId: auth.tenantId, outletId: auth.outletId };

    const doc = await findExpenseDoc(Expense, id, scope);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    await doc.deleteOne();
    res.status(200).json({
      success: true,
      message: 'Expense deleted',
      data: {
        expenseId: doc.expenseId,
        id: doc._id
      }
    });
  } catch (err) {
    console.error('Delete expense error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete expense' });
  }
};
