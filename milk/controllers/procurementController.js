import { Procurement } from '../models/Procurement.js';
import { Supplier } from '../models/Supplier.js';
import { sendWhatsAppTemplate } from '../../util/whatsapp.js';

export const listProcurements = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { page = 1, limit = 50, supplierId, fromDate, toDate, paymentStatus, shift } = req.query;

    const filter = { tenantId };
    if (user.role === 'supplier') {
      const supplier = await Supplier.findOne({ tenantId, userId: user._id });
      if (!supplier) return res.status(404).json({ success: false, message: 'Supplier profile not found' });
      filter.supplierId = supplier._id;
    } else if (supplierId) filter.supplierId = supplierId;

    if (fromDate) filter.date = { ...filter.date, $gte: new Date(fromDate) };
    if (toDate) filter.date = { ...filter.date, $lte: new Date(toDate) };
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (shift) filter.shift = shift;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [procurements, total] = await Promise.all([
      Procurement.find(filter)
        .populate('supplierId', 'supplierCode name phone village')
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Procurement.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: procurements,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
    });
  } catch (err) {
    console.error('List procurements error:', err);
    res.status(500).json({ success: false, message: 'Failed to list procurements' });
  }
};

export const getProcurement = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { id } = req.params;

    const procurement = await Procurement.findOne({ _id: id, tenantId })
      .populate('supplierId', 'supplierCode name phone village')
      .lean();

    if (!procurement) {
      return res.status(404).json({ success: false, message: 'Procurement not found' });
    }

    if (user.role === 'supplier') {
      const supplier = await Supplier.findOne({ tenantId, userId: user._id });
      if (!supplier || procurement.supplierId._id.toString() !== supplier._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    res.json({ success: true, data: procurement });
  } catch (err) {
    console.error('Get procurement error:', err);
    res.status(500).json({ success: false, message: 'Failed to get procurement' });
  }
};

export const createProcurement = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { supplierId, date, shift, quantity, fat, snf, fatMeterReading, remarks } = req.body;

    if (!supplierId || !date || !shift || quantity == null || fat == null) {
      return res.status(400).json({
        success: false,
        message: 'supplierId, date, shift, quantity, and fat are required'
      });
    }

    if (!['morning', 'evening'].includes(shift)) {
      return res.status(400).json({
        success: false,
        message: "shift must be 'morning' or 'evening'"
      });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const snappedRate = supplier.ratePerFat || 0;
    const amount = (quantity || 0) * (fat || 0) * snappedRate;

    const procurement = new Procurement({
      tenantId,
      supplierId,
      date: new Date(date),
      shift,
      quantity: quantity || 0,
      fat: fat || 0,
      snf: snf || 0,
      fatMeterReading: fatMeterReading || 0,
      ratePerFat: snappedRate,
      amount,
      recordedBy: user._id,
      remarks: remarks || ''
    });
    await procurement.save();
    await procurement.populate('supplierId', 'supplierCode name phone village');

    if (supplier.phone) {
      sendWhatsAppTemplate(
        supplier.phone,
        'milk_delivery',
        [supplier.name, `${quantity} Kg`, `₹${amount.toFixed(2)}`]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Procurement recorded successfully',
      data: procurement
    });
  } catch (err) {
    console.error('Create procurement error:', err);
    res.status(500).json({ success: false, message: 'Failed to create procurement' });
  }
};

export const updateProcurement = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const { shift, quantity, fat, snf, fatMeterReading, ratePerFat, remarks } = req.body;

    const procurement = await Procurement.findOne({ _id: id, tenantId });
    if (!procurement) {
      return res.status(404).json({ success: false, message: 'Procurement not found' });
    }

    if (procurement.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update paid procurement'
      });
    }

    if (shift !== undefined) {
      if (!['morning', 'evening'].includes(shift)) {
        return res.status(400).json({
          success: false,
          message: "shift must be 'morning' or 'evening'"
        });
      }
      procurement.shift = shift;
    }
    if (quantity != null) procurement.quantity = quantity;
    if (fat != null) procurement.fat = fat;
    if (snf != null) procurement.snf = snf;
    if (fatMeterReading != null) procurement.fatMeterReading = fatMeterReading;
    if (ratePerFat != null) procurement.ratePerFat = ratePerFat;
    if (remarks != null) procurement.remarks = remarks;
    procurement.amount = procurement.quantity * procurement.fat * procurement.ratePerFat;
    procurement.updatedAt = new Date();
    await procurement.save();
    await procurement.populate('supplierId', 'supplierCode name phone village');

    res.json({ success: true, message: 'Procurement updated', data: procurement });
  } catch (err) {
    console.error('Update procurement error:', err);
    res.status(500).json({ success: false, message: 'Failed to update procurement' });
  }
};

export const deleteProcurement = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const procurement = await Procurement.findOne({ _id: id, tenantId });
    if (!procurement) {
      return res.status(404).json({ success: false, message: 'Procurement not found' });
    }

    if (procurement.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete paid procurement. Unlink the payment first.'
      });
    }

    await Procurement.deleteOne({ _id: id, tenantId });
    res.json({ success: true, message: 'Procurement deleted successfully' });
  } catch (err) {
    console.error('Delete procurement error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete procurement' });
  }
};
