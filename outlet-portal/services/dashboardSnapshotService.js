import { getSaleModel } from '../models/Sale.js';
import { getDashboardDailySnapshotModel } from '../models/DashboardDailySnapshot.js';
import { getFirestoreDB } from '../../util/firebase.js';

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

const aggregateNewPosOutletsTotal = async (Sale, start, end, tenantId) => {
  const pipeline = [
    {
      $group: {
        _id: { tenantId: '$tenantId', outletId: '$outletId' },
        firstSaleAt: { $min: '$createdAt' },
      },
    },
    {
      $match: {
        firstSaleAt: { $gte: start, $lte: end },
      },
    },
    {
      $count: 'value',
    },
  ];

  if (tenantId) {
    pipeline.unshift({ $match: { tenantId } });
  }

  const rows = await Sale.aggregate(pipeline);
  return rows[0]?.value ?? 0;
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
    newPosOutletsTotal,
    topOutlets,
    posByOutlet,
    topProducts,
  ] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $count: 'total' },
    ]),
    aggregateNewPosOutletsTotal(Sale, start, end, tenantId || null),
    aggregateTopOutlets(Sale, match),
    aggregatePosByOutlet(Sale, match),
    aggregateTopProducts(Sale, match),
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
    newPosOutletsTotal,
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
    { $set: payload, $unset: { recentSales: '' } },
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

export const snapshotToDashboardResponse = (
  snapshot,
  previousSnapshot,
  businessDate,
) => {
  const prevRevenue = previousSnapshot?.dailyRevenueTotal ?? 0;
  const prevTransactions = previousSnapshot?.dailyTransactionsTotal ?? 0;
  const prevNewPos = previousSnapshot?.newPosOutletsTotal ?? 0;

  const { start, end } = getIstDayBounds(businessDate);

  return {
    source: 'snapshot',
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      businessDate,
    },
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
    newPosOutlets: singleDayMetric(
      businessDate,
      snapshot.newPosOutletsTotal,
      prevNewPos,
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
  const newPosTotal = snapshots.reduce(
    (sum, row) => sum + (row.newPosOutletsTotal || 0),
    0,
  );

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

  const latestSnapshot = snapshots[snapshots.length - 1];

  return {
    source: 'snapshot',
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      businessDate: lastDate,
    },
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
    newPosOutlets: {
      data: snapshots.map((row) => ({
        date: row.businessDate,
        value: row.newPosOutletsTotal,
      })),
      total: newPosTotal,
      trend: 0,
    },
    topOutlets: latestSnapshot.topOutlets ?? [],
    posByOutlet,
    topProducts: latestSnapshot.topProducts ?? [],
  };
};

export const runEodDashboardSnapshot = async (businessDate) => {
  const dateKey = businessDate || getYesterdayDateKey();
  console.log(`[Dashboard EOD] Building snapshot for ${dateKey}`);
  const saved = await saveDashboardSnapshot(dateKey);
  console.log(
    `[Dashboard EOD] Saved snapshot for ${dateKey} (${saved.posByOutlet?.length ?? 0} outlets)`,
  );
  return saved;
};
