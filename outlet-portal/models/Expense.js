import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

const expenseSchema = new mongoose.Schema({
  expenseId: { type: String, required: true },
  tenantId: { type: String, required: true, index: true },
  outletId: { type: String, required: true, index: true },
  firestoreUserId: { type: String, index: true },
  type: { type: String, required: true, trim: true },
  categoryLabel: { type: String, required: true, trim: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

expenseSchema.index({ tenantId: 1, outletId: 1, createdAt: -1 });
expenseSchema.index({ expenseId: 1 }, { unique: true, sparse: true });

export const getExpenseModel = () => {
  const conn = getPortalConnection();
  return conn.models.Expense || conn.model('Expense', expenseSchema, 'Expenses');
};
