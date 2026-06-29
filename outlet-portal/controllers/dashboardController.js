import { getSaleModel } from '../models/Sale.js';
import { getFirestoreDB } from '../../util/firebase.js';

const TZ = 'Asia/Kolkata';

const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const formatDateKey = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);

const parseDateRange = (query) => {
  const now = new Date();
  const end = query.end ? new Date(query.end) : new Date(now);
  const start = query.start
    ? new Date(query.start)
    : new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

  if (!query.end) {
    end.setHours(23, 59, 59, 999);
  }
  if (!query.start) {
    start.setHours(0, 0, 0, 0);
  }

  return { start, end };
};

const previousPeriod = (start, end) => {
  const periodMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - periodMs);
  return { start: prevStart, end: prevEnd };
};

const computeTrend = (currentTotal, previousTotal) => {
  if (previousTotal === 0) return currentTotal > 0 ? 100 : 0;
  return roundMoney(((currentTotal - previousTotal) / previousTotal) * 100);
};

const fillDateSeries = (rows, start, end) => {
  const map = new Map(rows.map((row) => [row.date, row.value]));
  const result = [];
  const cursor = new Date(start);
  const endDay = new Date(end);

  while (formatDateKey(cursor) <= formatDateKey(endDay)) {
    const key = formatDateKey(cursor);
    result.push({ date: key, value: map.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
};

const sumSeries = (rows) => rows.reduce((sum, row) => sum + (row.value || 0), 0);

const buildMatch = (start, end, tenantId) => {
  const match = {
    createdAt: { $gte: start, $lte: end }
  };
  if (tenantId) match.tenantId = tenantId;
  return match;
};

const aggregateDailyRevenue = async (Sale, match) => {
  const rows = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ }
        },
        value: { $sum: '$total' }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return rows.map((row) => ({
    date: row._id,
    value: roundMoney(row.value)
  }));
};

const aggregateDailyTransactions = async (Sale, match) => {
  const rows = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ }
        },
        value: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return rows.map((row) => ({
    date: row._id,
    value: row.value
  }));
};

const aggregateNewPosOutlets = async (Sale, start, end, tenantId) => {
  const pipeline = [
    {
      $group: {
        _id: { tenantId: '$tenantId', outletId: '$outletId' },
        firstSaleAt: { $min: '$createdAt' }
      }
    },
    {
      $match: {
        firstSaleAt: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$firstSaleAt', timezone: TZ }
        },
        value: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ];

  if (tenantId) {
    pipeline.unshift({ $match: { tenantId } });
  }

  const rows = await Sale.aggregate(pipeline);

  return rows.map((row) => ({
    date: row._id,
    value: row.value
  }));
};

const aggregateTopOutlets = async (Sale, match) => {
  const rows = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: { tenantId: '$tenantId', outletId: '$outletId' },
        transactionCount: { $sum: 1 },
        revenue: { $sum: '$total' }
      }
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        tenantId: '$_id.tenantId',
        outletId: '$_id.outletId',
        transactionCount: 1,
        revenue: { $round: ['$revenue', 2] }
      }
    }
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
        revenue: { $sum: '$items.lineTotal' }
      }
    },
    { $sort: { quantity: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        productId: '$_id.productId',
        name: '$_id.name',
        quantity: { $round: ['$quantity', 2] },
        revenue: { $round: ['$revenue', 2] }
      }
    }
  ]);

  return rows;
};

const buildMetric = (currentRows, previousRows, start, end) => {
  const data = fillDateSeries(currentRows, start, end);
  const total = roundMoney(sumSeries(data));
  const previousTotal = roundMoney(sumSeries(previousRows));

  return {
    data,
    total,
    trend: computeTrend(total, previousTotal)
  };
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

export const getDashboard = async (req, res) => {
  try {
    const { start, end } = parseDateRange(req.query);
    const tenantId = req.query.tenantId ? String(req.query.tenantId).trim() : null;
    const { start: prevStart, end: prevEnd } = previousPeriod(start, end);

    const Sale = getSaleModel();
    const match = buildMatch(start, end, tenantId);
    const prevMatch = buildMatch(prevStart, prevEnd, tenantId);

    const [
      revenueRows,
      prevRevenueRows,
      transactionRows,
      prevTransactionRows,
      newPosRows,
      prevNewPosRows,
      recentSales,
      topOutlets,
      topProducts
    ] = await Promise.all([
      aggregateDailyRevenue(Sale, match),
      aggregateDailyRevenue(Sale, prevMatch),
      aggregateDailyTransactions(Sale, match),
      aggregateDailyTransactions(Sale, prevMatch),
      aggregateNewPosOutlets(Sale, start, end, tenantId),
      aggregateNewPosOutlets(Sale, prevStart, prevEnd, tenantId),
      Sale.find(match)
        .sort({ createdAt: -1 })
        .limit(10)
        .select('saleId outletId tenantId total paymentMode paymentStatus createdAt customer.name')
        .lean(),
      aggregateTopOutlets(Sale, match),
      aggregateTopProducts(Sale, match)
    ]);

    const dailyRevenue = buildMetric(revenueRows, prevRevenueRows, start, end);
    const dailyTransactions = buildMetric(transactionRows, prevTransactionRows, start, end);
    const newPosOutlets = buildMetric(newPosRows, prevNewPosRows, start, end);

    const outletNames = await resolveOutletNames([
      ...recentSales.map((sale) => sale.outletId),
      ...topOutlets.map((outlet) => outlet.outletId)
    ]);

    res.json({
      success: true,
      data: {
        period: {
          start: start.toISOString(),
          end: end.toISOString()
        },
        dailyRevenue,
        dailyTransactions,
        newPosOutlets,
        recentSales: recentSales.map((sale) => ({
          id: sale._id.toString(),
          saleId: sale.saleId,
          outletId: sale.outletId,
          outletName: outletNames[sale.outletId] || sale.outletId,
          tenantId: sale.tenantId,
          total: roundMoney(sale.total),
          paymentMode: sale.paymentMode,
          paymentStatus: sale.paymentStatus,
          customerName: sale.customer?.name || '',
          createdAt: sale.createdAt
        })),
        topOutlets: topOutlets.map((outlet) => ({
          ...outlet,
          outletName: outletNames[outlet.outletId] || outlet.outletId
        })),
        topProducts
      }
    });
  } catch (err) {
    console.error('Outlet portal dashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
};
