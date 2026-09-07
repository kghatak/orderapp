import { getSaleModel } from '../models/Sale.js';
import { getDashboardDailySnapshotModel } from '../models/DashboardDailySnapshot.js';
import { getFirestoreDB } from '../../util/firebase.js';
import { getIstBoundariesForCalendarDate } from '../../util/istDateBoundaries.js';

export const TZ = 'Asia/Kolkata';

export const roundMoney = (n) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const formatDateKey = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);

export const getYesterdayDateKey = () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return formatDateKey(yesterday);
};

export const getIstDayBounds = (dateKey) => {
  const start = new Date(`${dateKey}T00:00:00+05:30`);
  const end = new Date(`${dateKey}T23:59:59.999+05:30`);
  return { start, end };
};

const computeTrend = (currentTotal, previousTotal) => {
  if (previousTotal === 0) return currentTotal > 0 ? 100 : 0;
  return roundMoney(((currentTotal - previousTotal) / previousTotal) * 100);
};

const formatCompareLabel = (dateKey) => {
  if (!dateKey) return undefined;
  const { start } = getIstDayBounds(dateKey);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
  }).format(start);
};

const buildMatch = (start, end, tenantId) => {
  const match = {
    createdAt: { $gte: start, $lte: end },
  };
  if (tenantId) match.tenantId = tenantId;
  return match;
};

const splitPaymentSum = (modes) => ({
  $sum: {
    $map: {
      input: { $ifNull: ['$payments', []] },
      as: 'p',
      in: {
        $cond: [{ $in: ['$$p.mode', modes] }, '$$p.amount', 0],
      },
    },
  },
});

const PAYMENT_SUMMARY_KEYS = [
  { key: 'cash', label: 'Cash', modes: ['cash'] },
  { key: 'net-banking', label: 'Net Banking', modes: ['transfer by bank', 'bank', 'net banking', 'upi'] },
  { key: 'cheque', label: 'Cheque', modes: ['cheque', 'check'] },
];

const ORDER_STATUS_ORDER = [
  'pending',
  'accepted',
  'processing',
  'dispatched',
  'delivered',
  'cancelled',
];

const formatStatusLabel = (status) => {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const mapOutletPaymentMode = (paymentMode) => {
  const normalized = String(paymentMode || '')
    .trim()
    .toLowerCase();

  for (const item of PAYMENT_SUMMARY_KEYS) {
    if (item.modes.some((mode) => normalized === mode || normalized.includes(mode))) {
      return item;
    }
  }

  return null;
};

const toBreakdownWithPercent = (items) => {
  const total = roundMoney(items.reduce((sum, row) => sum + (row.value || 0), 0));
  return {
    total,
    items: items.map((row) => ({
      ...row,
      value: roundMoney(row.value || 0),
      percent: total > 0 ? roundMoney(((row.value || 0) / total) * 100) : 0,
    })),
  };
};

const mergeBreakdownItems = (snapshots, field) => {
  const map = new Map();
  for (const snapshot of snapshots) {
    for (const row of snapshot[field] ?? []) {
      const existing = map.get(row.key);
      if (existing) {
        existing.value = roundMoney(existing.value + (row.value || 0));
      } else {
        map.set(row.key, {
          key: row.key,
          label: row.label,
          value: roundMoney(row.value || 0),
        });
      }
    }
  }
  return [...map.values()];
};

export const aggregatePosByOutlet = async (Sale, match) => {
  const rows = await Sale.aggregate([
    { $match: match },
    {
      $addFields: {
        upiAmount: {
          $cond: [
            { $eq: ['$paymentMode', 'UPI'] },
            '$total',
            {
              $cond: [
                { $eq: ['$paymentMode', 'Split'] },
                splitPaymentSum(['UPI']),
                0,
              ],
            },
          ],
        },
        cashAmount: {
          $cond: [
            { $in: ['$paymentMode', ['Cash', 'Card']] },
            '$total',
            {
              $cond: [
                { $eq: ['$paymentMode', 'Split'] },
                splitPaymentSum(['Cash', 'Card']),
                0,
              ],
            },
          ],
        },
        dueAmount: {
          $cond: [{ $eq: ['$paymentMode', 'Due'] }, '$total', 0],
        },
      },
    },
    {
      $group: {
        _id: { tenantId: '$tenantId', outletId: '$outletId' },
        transactionCount: { $sum: 1 },
        upi: { $sum: '$upiAmount' },
        cash: { $sum: '$cashAmount' },
        due: { $sum: '$dueAmount' },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { revenue: -1 } },
    {
      $project: {
        _id: 0,
        tenantId: '$_id.tenantId',
        outletId: '$_id.outletId',
        transactionCount: 1,
        upi: { $round: ['$upi', 2] },
        cash: { $round: ['$cash', 2] },
        due: { $round: ['$due', 2] },
        revenue: { $round: ['$revenue', 2] },
      },
    },
  ]);

  return rows;
};

const aggregateTopOutlets = async (Sale, match) => {
  const rows = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: { tenantId: '$tenantId', outletId: '$outletId' },
        transactionCount: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        tenantId: '$_id.tenantId',
        outletId: '$_id.outletId',
        transactionCount: 1,
        revenue: { $round: ['$revenue', 2] },
      },
    },
  ]);

  return rows;
};

const aggregateTopProducts = async (Sale, match) => {
  const rows = await Sale.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: { productId: '$items.productId', name: '$items.name' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { quantity: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        productId: '$_id.productId',
        name: '$_id.name',
        quantity: { $round: ['$quantity', 2] },
        revenue: { $round: ['$revenue', 2] },
      },
    },
  ]);

  return rows;
};

/**
 * Outlet payments breakdown for Payment Summary donut
 * (Firestore `payments`: Cash / Transfer by Bank / Cheque).
 */
const aggregatePaymentSummaryItems = async (businessDate) => {
  const empty = PAYMENT_SUMMARY_KEYS.map(({ key, label }) => ({
    key,
    label,
    value: 0,
  }));

  try {
    const db = getFirestoreDB();
    const { dayStartTimestamp, dayEndTimestamp } =
      getIstBoundariesForCalendarDate(businessDate);

    const countedIds = new Set();
    const totals = Object.fromEntries(PAYMENT_SUMMARY_KEYS.map(({ key }) => [key, 0]));

    const addPayment = (doc) => {
      if (countedIds.has(doc.id)) return;
      const data = doc.data() || {};
      if (data.paymentType === 'opening_balance') return;
      if (String(data.status || '').toLowerCase() !== 'approved') return;

      countedIds.add(doc.id);
      const mapped = mapOutletPaymentMode(data.paymentMode);
      if (!mapped) return;

      totals[mapped.key] += parseFloat(data.amount || 0);
    };

    // Business paymentDate only (same as ledger / opening-closing)
    const byPaymentDate = await db
      .collection('payments')
      .where('status', '==', 'approved')
      .where('paymentDate', '>=', dayStartTimestamp)
      .where('paymentDate', '<=', dayEndTimestamp)
      .get();
    byPaymentDate.forEach(addPayment);

    return PAYMENT_SUMMARY_KEYS.map(({ key, label }) => ({
      key,
      label,
      value: roundMoney(totals[key] || 0),
    }));
  } catch (err) {
    console.error(
      `[Dashboard EOD] Outlet payment summary failed for ${businessDate}:`,
      err.message || err,
    );
    return empty;
  }
};

/**
 * Delivery KPIs + order-status overview from Firestore
 * (same sources as opening/closing balance EOD jobs).
 */
const aggregateDeliveryAndOutletSummary = async (businessDate) => {
  const db = getFirestoreDB();
  const { dayStartTimestamp, dayEndTimestamp } =
    getIstBoundariesForCalendarDate(businessDate);

  const emptyStatusItems = ORDER_STATUS_ORDER.map((status) => ({
    key: status,
    label: formatStatusLabel(status),
    value: 0,
  }));

  const empty = {
    totalSales: 0,
    totalOrders: 0,
    totalOutlets: 0,
    totalOutletsActive: 0,
    totalOutletsInactive: 0,
    totalReturnOrders: 0,
    totalReturnAmount: 0,
    orderStatusItems: emptyStatusItems,
  };

  try {
    const [outletsSnap, deliveredSnap, returnsSnap, createdOrdersSnap] =
      await Promise.all([
        db.collection('outlets').get(),
        db
          .collection('orders')
          .where('status', '==', 'delivered')
          .where('deliveredDate', '>=', dayStartTimestamp)
          .where('deliveredDate', '<=', dayEndTimestamp)
          .get(),
        db
          .collection('returns')
          .where('status', '==', 'collected')
          .where('collectedDate', '>=', dayStartTimestamp)
          .where('collectedDate', '<=', dayEndTimestamp)
          .get(),
        db
          .collection('orders')
          .where('Created at', '>=', dayStartTimestamp)
          .where('Created at', '<=', dayEndTimestamp)
          .get(),
      ]);

    let active = 0;
    let inactive = 0;
    outletsSnap.forEach((doc) => {
      if (doc.data()?.active === false) inactive += 1;
      else active += 1;
    });

    let totalSales = 0;
    deliveredSnap.forEach((doc) => {
      const data = doc.data() || {};
      totalSales += parseFloat(data['total amount'] || data.totalAmount || 0);
    });

    let totalReturnAmount = 0;
    returnsSnap.forEach((doc) => {
      totalReturnAmount += parseFloat(doc.data()?.totalAmount || 0);
    });

    const statusTotals = {};
    createdOrdersSnap.forEach((doc) => {
      const status = String(doc.data()?.status || 'pending')
        .trim()
        .toLowerCase() || 'pending';
      statusTotals[status] = (statusTotals[status] || 0) + 1;
    });

    // Always include known statuses so the donut legend stays stable day-to-day
    const allKeys = [
      ...ORDER_STATUS_ORDER,
      ...Object.keys(statusTotals).filter((status) => !ORDER_STATUS_ORDER.includes(status)),
    ];

    return {
      totalSales: roundMoney(totalSales),
      totalOrders: deliveredSnap.size,
      totalOutlets: outletsSnap.size,
      totalOutletsActive: active,
      totalOutletsInactive: inactive,
      totalReturnOrders: returnsSnap.size,
      totalReturnAmount: roundMoney(totalReturnAmount),
      orderStatusItems: allKeys.map((status) => ({
        key: status,
        label: formatStatusLabel(status),
        value: statusTotals[status] || 0,
      })),
    };
  } catch (err) {
    console.error(
      `[Dashboard EOD] Firestore summary failed for ${businessDate}:`,
      err.message || err,
    );
    return empty;
  }
};

const resolveOutletNames = async (outletIds) => {
  const uniqueIds = [...new Set(outletIds.filter(Boolean))];
  if (!uniqueIds.length) return {};

  const db = getFirestoreDB();
  const names = {};
  const BATCH_SIZE = 10;

  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);
    const refs = batch.map((id) => db.collection('outlets').doc(id));
    const docs = await db.getAll(...refs);

    for (const doc of docs) {
      if (!doc.exists) continue;
      const data = doc.data();
      names[doc.id] = data.name || data.outletName || doc.id;
    }
  }

  for (const id of uniqueIds) {
    if (!names[id]) names[id] = id;
  }

  return names;
};

const attachOutletNames = (rows, outletNames) =>
  rows.map((row) => ({
    ...row,
    outletName: outletNames[row.outletId] || row.outletId,
  }));

export const buildDashboardSnapshotForDate = async (businessDate, tenantId = '') => {
  const { start, end } = getIstDayBounds(businessDate);
  const Sale = getSaleModel();
  const match = buildMatch(start, end, tenantId || null);

  const [
    revenueAgg,
    transactionAgg,
    topOutlets,
    posByOutlet,
    topProducts,
    paymentSummaryItems,
    deliverySummary,
  ] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $count: 'total' },
    ]),
    aggregateTopOutlets(Sale, match),
    aggregatePosByOutlet(Sale, match),
    aggregateTopProducts(Sale, match),
    aggregatePaymentSummaryItems(businessDate),
    aggregateDeliveryAndOutletSummary(businessDate),
  ]);

  const outletNames = await resolveOutletNames([
    ...topOutlets.map((outlet) => outlet.outletId),
    ...posByOutlet.map((outlet) => outlet.outletId),
  ]);

  return {
    businessDate,
    tenantId: tenantId || '',
    dailyRevenueTotal: roundMoney(revenueAgg[0]?.total ?? 0),
    dailyTransactionsTotal: transactionAgg[0]?.total ?? 0,
    totalSales: deliverySummary.totalSales,
    totalOrders: deliverySummary.totalOrders,
    totalOutlets: deliverySummary.totalOutlets,
    totalOutletsActive: deliverySummary.totalOutletsActive,
    totalOutletsInactive: deliverySummary.totalOutletsInactive,
    totalReturnOrders: deliverySummary.totalReturnOrders,
    totalReturnAmount: deliverySummary.totalReturnAmount,
    paymentSummaryItems,
    orderStatusItems: deliverySummary.orderStatusItems,
    posByOutlet: attachOutletNames(posByOutlet, outletNames),
    topOutlets: attachOutletNames(topOutlets, outletNames),
    topProducts,
    snapshotAt: new Date(),
  };
};

export const saveDashboardSnapshot = async (businessDate, tenantId = '') => {
  const payload = await buildDashboardSnapshotForDate(businessDate, tenantId);
  const Snapshot = getDashboardDailySnapshotModel();

  const doc = await Snapshot.findOneAndUpdate(
    { businessDate, tenantId: tenantId || '' },
    { $set: payload, $unset: { recentSales: '', newPosOutletsTotal: '' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return doc.toObject();
};

export const getSnapshotForDate = async (businessDate, tenantId = '') => {
  const Snapshot = getDashboardDailySnapshotModel();
  return Snapshot.findOne({ businessDate, tenantId: tenantId || '' }).lean();
};

export const getSnapshotsInRange = async (startDate, endDate, tenantId = '') => {
  const Snapshot = getDashboardDailySnapshotModel();
  return Snapshot.find({
    businessDate: { $gte: startDate, $lte: endDate },
    tenantId: tenantId || '',
  })
    .sort({ businessDate: 1 })
    .lean();
};

const singleDayMetric = (dateKey, value, previousValue) => ({
  data: [{ date: dateKey, value }],
  total: roundMoney(value),
  trend: computeTrend(value, previousValue),
});

const buildSummaryResponse = (snapshot, previousSnapshot, previousDateKey) => {
  const hasPrevious = Boolean(previousSnapshot);
  const compareLabel = hasPrevious ? formatCompareLabel(previousDateKey) : undefined;

  const withTrend = (current, previous) => {
    if (!hasPrevious) {
      return { value: current };
    }
    return {
      value: current,
      trend: computeTrend(current, previous ?? 0),
      compareLabel,
    };
  };

  return {
    totalSales: withTrend(
      roundMoney(snapshot.totalSales ?? 0),
      previousSnapshot?.totalSales ?? 0,
    ),
    totalOrders: withTrend(
      snapshot.totalOrders ?? 0,
      previousSnapshot?.totalOrders ?? 0,
    ),
    totalOutlets: {
      value: snapshot.totalOutlets ?? 0,
      active: snapshot.totalOutletsActive ?? 0,
      inactive: snapshot.totalOutletsInactive ?? 0,
    },
    totalReturnOrders: withTrend(
      snapshot.totalReturnOrders ?? 0,
      previousSnapshot?.totalReturnOrders ?? 0,
    ),
    totalReturnAmount: withTrend(
      roundMoney(snapshot.totalReturnAmount ?? 0),
      previousSnapshot?.totalReturnAmount ?? 0,
    ),
  };
};

export const snapshotToDashboardResponse = (
  snapshot,
  previousSnapshot,
  businessDate,
) => {
  const prevRevenue = previousSnapshot?.dailyRevenueTotal ?? 0;
  const prevTransactions = previousSnapshot?.dailyTransactionsTotal ?? 0;
  const previousDateKey = previousSnapshot?.businessDate;

  const { start, end } = getIstDayBounds(businessDate);

  return {
    source: 'snapshot',
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      businessDate,
    },
    summary: buildSummaryResponse(snapshot, previousSnapshot, previousDateKey),
    paymentSummary: toBreakdownWithPercent(snapshot.paymentSummaryItems ?? []),
    orderStatusOverview: toBreakdownWithPercent(snapshot.orderStatusItems ?? []),
    dailyRevenue: singleDayMetric(
      businessDate,
      snapshot.dailyRevenueTotal,
      prevRevenue,
    ),
    dailyTransactions: singleDayMetric(
      businessDate,
      snapshot.dailyTransactionsTotal,
      prevTransactions,
    ),
    topOutlets: snapshot.topOutlets ?? [],
    posByOutlet: snapshot.posByOutlet ?? [],
    topProducts: snapshot.topProducts ?? [],
  };
};

export const mergeSnapshotsToDashboardResponse = (snapshots, tenantId = '') => {
  if (!snapshots.length) {
    return null;
  }

  const firstDate = snapshots[0].businessDate;
  const lastDate = snapshots[snapshots.length - 1].businessDate;
  const { start } = getIstDayBounds(firstDate);
  const { end } = getIstDayBounds(lastDate);

  const revenueTotal = roundMoney(
    snapshots.reduce((sum, row) => sum + (row.dailyRevenueTotal || 0), 0),
  );
  const transactionsTotal = snapshots.reduce(
    (sum, row) => sum + (row.dailyTransactionsTotal || 0),
    0,
  );

  const totalSales = roundMoney(
    snapshots.reduce((sum, row) => sum + (row.totalSales || 0), 0),
  );
  const totalOrders = snapshots.reduce(
    (sum, row) => sum + (row.totalOrders || 0),
    0,
  );
  const totalReturnOrders = snapshots.reduce(
    (sum, row) => sum + (row.totalReturnOrders || 0),
    0,
  );
  const totalReturnAmount = roundMoney(
    snapshots.reduce((sum, row) => sum + (row.totalReturnAmount || 0), 0),
  );

  const latestSnapshot = snapshots[snapshots.length - 1];

  const posByOutletMap = new Map();
  for (const snapshot of snapshots) {
    for (const row of snapshot.posByOutlet ?? []) {
      const key = `${row.tenantId || tenantId}:${row.outletId}`;
      const existing = posByOutletMap.get(key);
      if (existing) {
        existing.transactionCount += row.transactionCount || 0;
        existing.upi = roundMoney(existing.upi + (row.upi || 0));
        existing.cash = roundMoney(existing.cash + (row.cash || 0));
        existing.due = roundMoney(existing.due + (row.due || 0));
        existing.revenue = roundMoney(existing.revenue + (row.revenue || 0));
      } else {
        posByOutletMap.set(key, { ...row });
      }
    }
  }

  const posByOutlet = [...posByOutletMap.values()].sort(
    (a, b) => b.revenue - a.revenue,
  );

  const paymentSummary = toBreakdownWithPercent(
    mergeBreakdownItems(snapshots, 'paymentSummaryItems'),
  );
  const orderStatusOverview = toBreakdownWithPercent(
    mergeBreakdownItems(snapshots, 'orderStatusItems'),
  );

  return {
    source: 'snapshot',
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      businessDate: lastDate,
    },
    summary: {
      totalSales: { value: totalSales },
      totalOrders: { value: totalOrders },
      totalOutlets: {
        value: latestSnapshot.totalOutlets ?? 0,
        active: latestSnapshot.totalOutletsActive ?? 0,
        inactive: latestSnapshot.totalOutletsInactive ?? 0,
      },
      totalReturnOrders: { value: totalReturnOrders },
      totalReturnAmount: { value: totalReturnAmount },
    },
    paymentSummary,
    orderStatusOverview,
    dailyRevenue: {
      data: snapshots.map((row) => ({
        date: row.businessDate,
        value: row.dailyRevenueTotal,
      })),
      total: revenueTotal,
      trend: 0,
    },
    dailyTransactions: {
      data: snapshots.map((row) => ({
        date: row.businessDate,
        value: row.dailyTransactionsTotal,
      })),
      total: transactionsTotal,
      trend: 0,
    },
    topOutlets: latestSnapshot.topOutlets ?? [],
    posByOutlet,
    topProducts: latestSnapshot.topProducts ?? [],
  };
};

export const runEodDashboardSnapshot = async (businessDate) => {
  const dateKey = businessDate || getYesterdayDateKey();
    const saved = await saveDashboardSnapshot(dateKey);
    return saved;
};
