import mongoose from 'mongoose';
import { getExpenseModel } from '../models/Expense.js';
import { generateExpenseId } from '../util/businessIds.js';
const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseYmd = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const d = String(value).trim();
  if (!DATE_RE.test(d)) return { error: `${label} must be in yyyy-mm-dd format` };
  return d;
};

const dayRangeUtc = (ymd) => {
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(`${ymd}T23:59:59.999Z`);
  return { start, end };
};

const formatYmd = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const assertOutletScope = (req, res) => {
  const auth = req.portalAuth;
  const outletId = req.query.outletId;
  if (!outletId || typeof outletId !== 'string' || !outletId.trim()) {
    res.status(400).json({ success: false, message: 'outletId query parameter is required' });
    return null;
  }
  if (outletId.trim() !== auth.outletId) {
    res.status(403).json({ success: false, message: 'outletId does not match authenticated outlet' });
    return null;
  }
  return { auth, outletId: outletId.trim() };
};

const serializeExpenseDetail = (row) => {
  const { _id, __v, date, ...rest } = row;
  return {
    _id,
    ...rest,
    date: formatYmd(date)
  };
};

/** Include on create/update when sent; skips undefined/null/non-strings */
const optionalTrimmedStringFields = (body, keys) => {
  const out = {};
  for (const key of keys) {
    const v = body[key];
    if (typeof v === 'string') {
      out[key] = v.trim();
    }
  }
  return out;
};

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
 * Query:
 *   outletId (required for groupBy=date and date filter)
 *   groupBy=date — paginated date summaries (skip, limit default 10)
 *   date=yyyy-mm-dd — all expenses for one day
 *   skip, limit — flat list or date summaries (default limit 50 flat, 10 grouped)
 */
export const listExpenses = async (req, res) => {
  try {
    const auth = req.portalAuth;
    const { groupBy, date } = req.query;
    const Expense = getExpenseModel();

    if (groupBy === 'date') {
      const scope = assertOutletScope(req, res);
      if (!scope) return;

      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);
      const match = { tenantId: scope.auth.tenantId, outletId: scope.outletId };

      const [result] = await Expense.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            totalAmount: { $sum: '$amount' },
            recordCount: { $sum: 1 }
          }
        },
        { $sort: { _id: -1 } },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  _id: 0,
                  date: '$_id',
                  totalAmount: { $round: ['$totalAmount', 2] },
                  recordCount: 1
                }
              }
            ],
            meta: [{ $count: 'total' }]
          }
        }
      ]);

      const rows = result?.data || [];
      const total = result?.meta?.[0]?.total ?? 0;

      return res.status(200).json({
        success: true,
        data: rows.map((row) => ({
          date: row.date,
          totalAmount: roundMoney(row.totalAmount),
          recordCount: row.recordCount
        })),
        pagination: { total, skip, limit }
      });
    }

    if (date !== undefined && date !== null && String(date).trim() !== '') {
      const scope = assertOutletScope(req, res);
      if (!scope) return;

      const parsedDate = parseYmd(date, 'date');
      if (parsedDate?.error) {
        return res.status(400).json({ success: false, message: parsedDate.error });
      }

      const { start, end } = dayRangeUtc(parsedDate);
      const rows = await Expense.find({
        tenantId: scope.auth.tenantId,
        outletId: scope.outletId,
        date: { $gte: start, $lte: end }
      })
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        data: rows.map(serializeExpenseDetail)
      });
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);
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
 * Body: outletId (must match token), type, categoryLabel, amount, date (optional ISO date),
 *       optional strings: paidFrom, remarks, employee
 * Authorization: Bearer <outlet-portal login token>
 */
export const createExpense = async (req, res) => {
  try {
    const { outletId, type, categoryLabel, amount, date } = req.body;
    const extras = optionalTrimmedStringFields(req.body, ['paidFrom', 'remarks', 'employee']);
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
      date: expenseDate,
      ...extras
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
 * Body: optional type, categoryLabel, amount, date, paidFrom, remarks, employee, outletId (must match token)
 */
export const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const auth = req.portalAuth;
    const body = req.body || {};
    const {
      outletId,
      type,
      categoryLabel,
      amount,
      date,
      paidFrom,
      remarks,
      employee
    } = body;

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
      date !== undefined ||
      paidFrom !== undefined ||
      remarks !== undefined ||
      employee !== undefined;

    if (!hasPatch) {
      return res.status(400).json({
        success: false,
        message:
          'Provide at least one of: type, categoryLabel, amount, date, paidFrom, remarks, employee'
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
    if (paidFrom !== undefined) {
      if (typeof paidFrom !== 'string') {
        return res.status(400).json({ success: false, message: 'paidFrom must be a string' });
      }
      doc.paidFrom = paidFrom.trim();
    }
    if (remarks !== undefined) {
      if (typeof remarks !== 'string') {
        return res.status(400).json({ success: false, message: 'remarks must be a string' });
      }
      doc.remarks = remarks.trim();
    }
    if (employee !== undefined) {
      if (typeof employee !== 'string') {
        return res.status(400).json({ success: false, message: 'employee must be a string' });
      }
      doc.employee = employee.trim();
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
