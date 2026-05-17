import { MilkPayment } from '../models/MilkPayment.js';
import { Procurement } from '../models/Procurement.js';
import { Supplier } from '../models/Supplier.js';

export const listPayments = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { page = 1, limit = 50, supplierId, fromDate, toDate } = req.query;

    const filter = { tenantId };
    if (user.role === 'supplier') {
      const supplier = await Supplier.findOne({ tenantId, userId: user._id });
      if (!supplier) return res.status(404).json({ success: false, message: 'Supplier profile not found' });
      filter.supplierId = supplier._id;
    } else if (supplierId) filter.supplierId = supplierId;

    if (fromDate) filter.paymentDate = { ...filter.paymentDate, $gte: new Date(fromDate) };
    if (toDate) filter.paymentDate = { ...filter.paymentDate, $lte: new Date(toDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [payments, total] = await Promise.all([
      MilkPayment.find(filter)
        .populate('supplierId', 'supplierCode name phone village')
        .sort({ paymentDate: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      MilkPayment.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
    });
  } catch (err) {
    console.error('List payments error:', err);
    res.status(500).json({ success: false, message: 'Failed to list payments' });
  }
};

export const getPayment = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { id } = req.params;

    const payment = await MilkPayment.findOne({ _id: id, tenantId })
      .populate('supplierId', 'supplierCode name phone village')
      .populate('procurementIds')
      .lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (user.role === 'supplier') {
      const supplier = await Supplier.findOne({ tenantId, userId: user._id });
      if (!supplier || payment.supplierId._id.toString() !== supplier._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    res.json({ success: true, data: payment });
  } catch (err) {
    console.error('Get payment error:', err);
    res.status(500).json({ success: false, message: 'Failed to get payment' });
  }
};

export const createPayment = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { supplierId, amount, paymentDate, paymentMode, referenceNo, procurementIds, remarks } = req.body;

    if (!supplierId || amount == null || !paymentDate) {
      return res.status(400).json({
        success: false,
        message: 'supplierId, amount, and paymentDate are required'
      });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const payment = new MilkPayment({
      tenantId,
      supplierId,
      amount,
      paymentDate: new Date(paymentDate),
      paymentMode: paymentMode || 'cash',
      referenceNo: referenceNo || '',
      procurementIds: procurementIds || [],
      remarks: remarks || '',
      paidBy: user._id
    });
    await payment.save();

    if (procurementIds && procurementIds.length > 0) {
      await Procurement.updateMany(
        { _id: { $in: procurementIds }, tenantId },
        { $set: { paymentStatus: 'paid', paymentId: payment._id, updatedAt: new Date() } }
      );
    }

    await payment.populate('supplierId', 'supplierCode name phone village');

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: payment
    });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ success: false, message: 'Failed to create payment' });
  }
};

export const paymentBalances = async (req, res) => {
  try {
    const { tenantId } = req;
    const { fromDate, toDate } = req.query;

    const procMatch = { tenantId };
    const payMatch = { tenantId };
    if (fromDate) {
      procMatch.date = { ...procMatch.date, $gte: new Date(fromDate) };
      payMatch.paymentDate = { ...payMatch.paymentDate, $gte: new Date(fromDate) };
    }
    if (toDate) {
      procMatch.date = { ...procMatch.date, $lte: new Date(toDate) };
      payMatch.paymentDate = { ...payMatch.paymentDate, $lte: new Date(toDate) };
    }

    const [procAgg, payAgg, suppliers] = await Promise.all([
      Procurement.aggregate([
        { $match: procMatch },
        { $group: {
          _id: '$supplierId',
          totalMilk: { $sum: '$quantity' },
          totalAmount: { $sum: '$amount' },
          procurementCount: { $sum: 1 }
        }}
      ]),
      MilkPayment.aggregate([
        { $match: payMatch },
        { $group: {
          _id: '$supplierId',
          paidAmount: { $sum: '$amount' },
          paymentCount: { $sum: 1 }
        }}
      ]),
      Supplier.find({ tenantId, isActive: true })
        .select('supplierCode name phone village ratePerFat')
        .sort({ name: 1 })
        .lean()
    ]);

    const procMap = new Map(procAgg.map(p => [p._id.toString(), p]));
    const payMap = new Map(payAgg.map(p => [p._id.toString(), p]));

    const balances = suppliers.map(s => {
      const proc = procMap.get(s._id.toString()) || {};
      const pay = payMap.get(s._id.toString()) || {};
      const totalAmount = proc.totalAmount || 0;
      const paidAmount = pay.paidAmount || 0;
      return {
        supplierId: s._id,
        supplierCode: s.supplierCode,
        supplierName: s.name,
        phone: s.phone,
        village: s.village,
        ratePerFat: s.ratePerFat,
        totalMilk: proc.totalMilk || 0,
        totalAmount,
        paidAmount,
        pendingAmount: totalAmount - paidAmount,
        procurementCount: proc.procurementCount || 0,
        paymentCount: pay.paymentCount || 0
      };
    });

    res.json({ success: true, data: balances });
  } catch (err) {
    console.error('Payment balances error:', err);
    res.status(500).json({ success: false, message: 'Failed to get payment balances' });
  }
};
