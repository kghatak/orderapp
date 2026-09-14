import {
  formatDateKey,
  getIstDayBounds,
  getSnapshotForDate,
  getSnapshotsInRange,
  getYesterdayDateKey,
  mergeSnapshotsToDashboardResponse,
  saveDashboardSnapshot,
  snapshotToDashboardResponse,
} from '../services/dashboardSnapshotService.js';
import { canonicalizeTenantId, TENANTS } from '../../util/tenantMiddleware.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

const readDashboardTenantId = (req, queryTenantId = '') => {
  const fromHeader = req.headers['x-tenant-id'] || req.headers['user-tenantid'] || '';
  return canonicalizeTenantId(fromHeader || queryTenantId || '');
};

// POS snapshots are still global (cron saves tenantId '' / NM2026). Admin now
// sends X-Tenant-Id on every call, so look up that tenant first, then legacy docs.
const loadSnapshotForTenant = async (businessDate, tenantId) => {
  if (tenantId) {
    const snap = await getSnapshotForDate(businessDate, tenantId);
    if (snap) return snap;
  }
  return (
    (await getSnapshotForDate(businessDate, '')) ||
    (await getSnapshotForDate(businessDate, TENANTS.NAANU_MILK))
  );
};

const mergeSnapshotsByDate = (...lists) => {
  const byDate = new Map();
  for (const rows of lists) {
    for (const row of rows) {
      if (!byDate.has(row.businessDate)) byDate.set(row.businessDate, row);
    }
  }
  return [...byDate.values()].sort((a, b) =>
    String(a.businessDate).localeCompare(String(b.businessDate)),
  );
};

const loadSnapshotsInRangeForTenant = async (startDate, endDate, tenantId) => {
  const [byTenant, byEmpty, byNaanu] = await Promise.all([
    tenantId ? getSnapshotsInRange(startDate, endDate, tenantId) : Promise.resolve([]),
    getSnapshotsInRange(startDate, endDate, ''),
    getSnapshotsInRange(startDate, endDate, TENANTS.NAANU_MILK),
  ]);
  return mergeSnapshotsByDate(byTenant, byEmpty, byNaanu);
};

const countInclusiveDays = (startDate, endDate) => {
  const { start } = getIstDayBounds(startDate);
  const { start: endStart } = getIstDayBounds(endDate);
  const diffMs = endStart.getTime() - start.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
};

const parseDashboardQuery = (query, req) => {
  const tenantId = readDashboardTenantId(req, query.tenantId);

  if (query.date) {
    const businessDate = String(query.date).trim();
    if (!DATE_KEY_RE.test(businessDate)) {
      return { error: 'date must be YYYY-MM-DD' };
    }
    return { mode: 'single', businessDate, tenantId };
  }

  if (query.start || query.end) {
    const startDate = query.start
      ? String(query.start).trim()
      : getYesterdayDateKey();
    const endDate = query.end ? String(query.end).trim() : startDate;

    if (!DATE_KEY_RE.test(startDate) || !DATE_KEY_RE.test(endDate)) {
      return { error: 'start and end must be YYYY-MM-DD' };
    }
    if (startDate > endDate) {
      return { error: 'start must be on or before end' };
    }

    const dayCount = countInclusiveDays(startDate, endDate);
    if (dayCount > MAX_RANGE_DAYS) {
      return { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` };
    }

    return { mode: 'range', startDate, endDate, tenantId };
  }

  return { mode: 'single', businessDate: getYesterdayDateKey(), tenantId };
};

const getPreviousDateKey = (dateKey) => {
  const { start } = getIstDayBounds(dateKey);
  const prev = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  return formatDateKey(prev);
};

export const getDashboard = async (req, res) => {
  try {
    const parsed = parseDashboardQuery(req.query, req);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const { tenantId } = parsed;

    if (parsed.mode === 'range') {
      // Same day selected via start/end — use previous-day trend like single-date mode
      if (parsed.startDate === parsed.endDate) {
        const businessDate = parsed.startDate;
        const [snapshot, previousSnapshot] = await Promise.all([
          loadSnapshotForTenant(businessDate, tenantId),
          loadSnapshotForTenant(getPreviousDateKey(businessDate), tenantId),
        ]);

        if (!snapshot) {
          return res.status(404).json({
            success: false,
            message: `No dashboard snapshot found for ${businessDate}. Snapshots are created at end of day.`,
          });
        }

        const data = snapshotToDashboardResponse(
          snapshot,
          previousSnapshot,
          businessDate,
        );
        return res.json({ success: true, data });
      }

      const snapshots = await loadSnapshotsInRangeForTenant(
        parsed.startDate,
        parsed.endDate,
        tenantId,
      );

      if (!snapshots.length) {
        return res.status(404).json({
          success: false,
          message: 'No dashboard snapshots found for the selected date range.',
        });
      }

      const data = mergeSnapshotsToDashboardResponse(snapshots, tenantId);
      return res.json({ success: true, data });
    }

    const { businessDate } = parsed;
    const [snapshot, previousSnapshot] = await Promise.all([
      loadSnapshotForTenant(businessDate, tenantId),
      loadSnapshotForTenant(getPreviousDateKey(businessDate), tenantId),
    ]);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: `No dashboard snapshot found for ${businessDate}. Snapshots are created at end of day.`,
      });
    }

    const data = snapshotToDashboardResponse(
      snapshot,
      previousSnapshot,
      businessDate,
    );

    res.json({ success: true, data });
  } catch (err) {
    console.error('Outlet portal dashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
};

export const createDashboardSnapshot = async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET || process.env.DASHBOARD_SNAPSHOT_SECRET;
    const providedSecret =
      req.headers['x-cron-secret'] || req.body?.secret || req.query?.secret;

    if (cronSecret && providedSecret !== cronSecret) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const businessDate = req.body?.date
      ? String(req.body.date).trim()
      : getYesterdayDateKey();

    if (!DATE_KEY_RE.test(businessDate)) {
      return res.status(400).json({
        success: false,
        message: 'date must be YYYY-MM-DD',
      });
    }

    const tenantId = readDashboardTenantId(
      req,
      req.body?.tenantId ? String(req.body.tenantId).trim() : '',
    );

    const saved = await saveDashboardSnapshot(businessDate, tenantId);

    res.json({
      success: true,
      message: `Dashboard snapshot saved for ${businessDate}`,
      data: {
        businessDate: saved.businessDate,
        outletCount: saved.posByOutlet?.length ?? 0,
        totalOrders: saved.totalOrders ?? 0,
        totalSales: saved.totalSales ?? 0,
        totalReturnOrders: saved.totalReturnOrders ?? 0,
        totalReturnAmount: saved.totalReturnAmount ?? 0,
      },
    });
  } catch (err) {
    console.error('Dashboard snapshot create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create dashboard snapshot' });
  }
};

export const listDashboardSnapshotDates = async (req, res) => {
  try {
    const tenantId = readDashboardTenantId(req, req.query.tenantId);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? '30'), 10) || 30, 1),
      365,
    );

    const { getDashboardDailySnapshotModel } = await import(
      '../models/DashboardDailySnapshot.js'
    );
    const Snapshot = getDashboardDailySnapshotModel();

    const tenantFilter = tenantId
      ? { tenantId: { $in: [tenantId, '', TENANTS.NAANU_MILK] } }
      : { tenantId: { $in: ['', TENANTS.NAANU_MILK] } };

    const rows = await Snapshot.find(tenantFilter)
      .sort({ businessDate: -1 })
      .limit(limit)
      .select('businessDate snapshotAt dailyRevenueTotal dailyTransactionsTotal')
      .lean();

    res.json({
      success: true,
      data: rows.map((row) => ({
        businessDate: row.businessDate,
        snapshotAt: row.snapshotAt,
        dailyRevenueTotal: row.dailyRevenueTotal,
        dailyTransactionsTotal: row.dailyTransactionsTotal,
      })),
    });
  } catch (err) {
    console.error('Dashboard snapshot list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list dashboard snapshots' });
  }
};
