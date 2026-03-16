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

    const procurements = await Procurement.find({
      tenantId,
      date: { $gte: start, $lte: end }
    }).lean();

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

    const totalProcurement = procurements.reduce((s, p) => s + (p.amount || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const pending = totalProcurement - totalPaid;

    res.json({
      success: true,
      data: {
        supplierId,
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
