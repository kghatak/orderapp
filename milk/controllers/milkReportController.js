import { Procurement } from '../models/Procurement.js';
import { MilkPayment } from '../models/MilkPayment.js';
import { Supplier } from '../models/Supplier.js';

export const dailySummary = async (req, res) => {
  try {
    const { tenantId } = req;
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const [procurements, totalActiveSuppliers] = await Promise.all([
      Procurement.find({ tenantId, date: { $gte: start, $lte: end } }).lean(),
      Supplier.countDocuments({ tenantId, isActive: true })
    ]);

    const totalQuantity = procurements.reduce((s, p) => s + (p.quantity || 0), 0);
    const totalAmount = procurements.reduce((s, p) => s + (p.amount || 0), 0);
    const supplierCount = new Set(procurements.map(p => p.supplierId?.toString())).size;

    res.json({
      success: true,
      data: {
        date: targetDate.toISOString().split('T')[0],
        totalQuantity,
        totalAmount,
        supplierCount,
        totalActiveSuppliers,
        recordCount: procurements.length
      }
    });
  } catch (err) {
    console.error('Daily summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to get daily summary' });
  }
};

export const supplierSummary = async (req, res) => {
  try {
    const { tenantId, user } = req;
    let supplierId = req.query.supplierId;

    if (user.role === 'supplier') {
      const supplier = await Supplier.findOne({ tenantId, userId: user._id });
      if (!supplier) return res.status(404).json({ success: false, message: 'Supplier profile not found' });
      supplierId = supplier._id.toString();
    } else if (!supplierId) {
      return res.status(400).json({ success: false, message: 'supplierId is required for admin' });
    }

    const { fromDate, toDate } = req.query;
    const procFilter = { tenantId, supplierId };
    const payFilter = { tenantId, supplierId };
    if (fromDate) {
      procFilter.date = { ...procFilter.date, $gte: new Date(fromDate) };
      payFilter.paymentDate = { ...payFilter.paymentDate, $gte: new Date(fromDate) };
    }
    if (toDate) {
      procFilter.date = { ...procFilter.date, $lte: new Date(toDate) };
      payFilter.paymentDate = { ...payFilter.paymentDate, $lte: new Date(toDate) };
    }

    const [procurements, payments] = await Promise.all([
      Procurement.find(procFilter).sort({ date: 1 }).lean(),
      MilkPayment.find(payFilter).sort({ paymentDate: 1 }).lean()
    ]);

    const totalMilk = procurements.reduce((s, p) => s + (p.quantity || 0), 0);
    const totalProcurement = procurements.reduce((s, p) => s + (p.amount || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const pending = totalProcurement - totalPaid;

    res.json({
      success: true,
      data: {
        supplierId,
        totalMilk,
        totalProcurement,
        totalPaid,
        pending,
        procurementCount: procurements.length,
        paymentCount: payments.length
      }
    });
  } catch (err) {
    console.error('Supplier summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to get supplier summary' });
  }
};

export const periodSummary = async (req, res) => {
  try {
    const { tenantId } = req;
    const { period = 'daily', date } = req.query;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({
        success: false,
        message: "period must be 'daily', 'weekly', or 'monthly'"
      });
    }

    const anchor = date ? new Date(date) : new Date();
    let start, end;

    if (period === 'daily') {
      start = new Date(anchor); start.setHours(0, 0, 0, 0);
      end = new Date(anchor); end.setHours(23, 59, 59, 999);
    } else if (period === 'weekly') {
      // ISO week: Monday 00:00 to Sunday 23:59
      const day = anchor.getDay();
      const diffToMon = (day + 6) % 7;
      start = new Date(anchor);
      start.setDate(anchor.getDate() - diffToMon);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const [procurements, totalActiveSuppliers] = await Promise.all([
      Procurement.find({ tenantId, date: { $gte: start, $lte: end } }).lean(),
      Supplier.countDocuments({ tenantId, isActive: true })
    ]);

    const totalQuantity = procurements.reduce((s, p) => s + (p.quantity || 0), 0);
    const totalAmount = procurements.reduce((s, p) => s + (p.amount || 0), 0);
    const supplierCount = new Set(procurements.map(p => p.supplierId?.toString())).size;

    res.json({
      success: true,
      data: {
        period,
        fromDate: start.toISOString().split('T')[0],
        toDate: end.toISOString().split('T')[0],
        totalQuantity,
        totalAmount,
        supplierCount,
        totalActiveSuppliers,
        recordCount: procurements.length
      }
    });
  } catch (err) {
    console.error('Period summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to get period summary' });
  }
};
