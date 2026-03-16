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
