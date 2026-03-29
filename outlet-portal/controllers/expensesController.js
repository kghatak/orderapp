import mongoose from 'mongoose';
import { getExpenseModel } from '../models/Expense.js';
import { generateExpenseId } from '../util/businessIds.js';
const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
      Expense.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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

    let row = null;
    if (mongoose.isValidObjectId(id)) {
      row = await Expense.findOne({ _id: id, ...scope }).lean();
    }
    if (!row && typeof id === 'string' && id.trim()) {
      row = await Expense.findOne({ expenseId: id.trim(), ...scope }).lean();
    }

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
    const { outletId, type, categoryLabel, amount } = req.body;
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

    const expenseId = generateExpenseId(auth.outletId);
    const Expense = getExpenseModel();
    const doc = await Expense.create({
      expenseId,
      tenantId: auth.tenantId,
      outletId: auth.outletId,
      firestoreUserId: auth.userId,
      type: type.trim(),
      categoryLabel: categoryLabel.trim(),
      amount: amt
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
