import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

const outletPosRowSchema = new mongoose.Schema(
  {
    outletId: { type: String, required: true },
    outletName: { type: String, default: '' },
    tenantId: { type: String, default: '' },
    transactionCount: { type: Number, default: 0 },
    upi: { type: Number, default: 0 },
    cash: { type: Number, default: 0 },
    due: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
  },
  { _id: false },
);

const breakdownItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    value: { type: Number, default: 0 },
  },
  { _id: false },
);

const dashboardDailySnapshotSchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true },
    tenantId: { type: String, default: '' },
    dailyRevenueTotal: { type: Number, default: 0 },
    dailyTransactionsTotal: { type: Number, default: 0 },
    newPosOutletsTotal: { type: Number, default: 0 },
    /** Delivery / outlet KPIs (Firestore) — stored same as POS totals */
    totalSales: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    totalOutlets: { type: Number, default: 0 },
    totalOutletsActive: { type: Number, default: 0 },
    totalOutletsInactive: { type: Number, default: 0 },
    totalReturnOrders: { type: Number, default: 0 },
    totalReturnAmount: { type: Number, default: 0 },
    paymentSummaryItems: { type: [breakdownItemSchema], default: [] },
    orderStatusItems: { type: [breakdownItemSchema], default: [] },
    posByOutlet: { type: [outletPosRowSchema], default: [] },
    topOutlets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    topProducts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    snapshotAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'dashboard_daily_snapshots' },
);

dashboardDailySnapshotSchema.index({ businessDate: 1, tenantId: 1 }, { unique: true });
dashboardDailySnapshotSchema.index({ businessDate: -1 });

export const getDashboardDailySnapshotModel = () => {
  const conn = getPortalConnection();
  return (
    conn.models.DashboardDailySnapshot ||
    conn.model('DashboardDailySnapshot', dashboardDailySnapshotSchema)
  );
};
