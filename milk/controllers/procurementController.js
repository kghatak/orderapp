import { Procurement } from '../models/Procurement.js';
import { Supplier } from '../models/Supplier.js';
import { sendWhatsAppTemplate } from '../../util/whatsapp.js';

const FAT_METER_MIN_READING = 28;
const MILK_TYPES = ['cow', 'buffalo', 'mixed'];

const RATE_FIELD_BY_MILK_TYPE = {
  cow: 'cowRatePerFat',
  buffalo: 'buffaloRatePerFat',
  mixed: 'ratePerFat'
};

/** Pick supplier base rate for the procurement milk type. */
const resolveSupplierRatePerFat = (supplier, milkType) => {
  const legacyRate = supplier.ratePerFat ?? 0;
  if (milkType === 'buffalo') {
    return supplier.buffaloRatePerFat > 0 ? supplier.buffaloRatePerFat : legacyRate;
  }
  if (milkType === 'mixed') {
    return legacyRate;
  }
  return supplier.cowRatePerFat > 0 ? supplier.cowRatePerFat : legacyRate;
};

const missingRateMessage = (milkType) => {
  const field = RATE_FIELD_BY_MILK_TYPE[milkType] || 'ratePerFat';
  return `Supplier ${field} is not set. Update the supplier rate before recording ${milkType} procurement.`;
};

const validateSupplierRate = (supplier, milkType) => {
  if (resolveSupplierRatePerFat(supplier, milkType) > 0) return null;
  return missingRateMessage(milkType);
};

const validateMixedLineRates = (supplier, lines) => {
  for (const line of lines) {
    const rateError = validateSupplierRate(supplier, line.milkType);
    if (rateError) return rateError;
  }
  return null;
};

/** Flat ₹ deduction when fat meter reading is below 28 (e.g. 27→₹1, 26→₹2). */
const fatMeterDeduction = (fatMeterReading, { ignoreZero = false } = {}) => {
  if (fatMeterReading == null || fatMeterReading === '') return 0;
  const reading = Number(fatMeterReading);
  if (ignoreZero && reading === 0) return 0;
  if (reading < FAT_METER_MIN_READING) {
    return FAT_METER_MIN_READING - reading;
  }
  return 0;
};

/** gross = qty × fat × ratePerFat; total = gross − fat-meter deduction */
const computeProcurementAmount = (quantity, fat, ratePerFat, fatMeterReading, options = {}) => {
  const gross = (quantity || 0) * (fat || 0) * (ratePerFat || 0);
  const deduction = fatMeterDeduction(fatMeterReading, options);
  const amount = Math.max(0, gross - deduction);
  return { gross, deduction, amount };
};

const isMixedPayload = (body) =>
  body.milkType === 'mixed'
  || (Array.isArray(body.lines) && body.lines.length > 0)
  || body.cowQuantity != null
  || body.cowFat != null
  || body.buffaloQuantity != null
  || body.buffaloFat != null;

const parseMixedInputLines = (body) => {
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    return body.lines
      .filter((line) => line.milkType === 'cow' || line.milkType === 'buffalo')
      .map((line) => ({
        milkType: line.milkType,
        quantity: Number(line.quantity) || 0,
        fat: Number(line.fat) || 0,
        snf: Number(line.snf) || 0,
        fatMeterReading: line.fatMeterReading != null ? Number(line.fatMeterReading) : null
      }));
  }

  const lines = [];
  if (body.cowQuantity != null || body.cowFat != null || body.cowFatMeterReading != null) {
    lines.push({
      milkType: 'cow',
      quantity: Number(body.cowQuantity) || 0,
      fat: Number(body.cowFat) || 0,
      snf: Number(body.cowSnf) || 0,
      fatMeterReading: body.cowFatMeterReading != null ? Number(body.cowFatMeterReading) : null
    });
  }
  if (body.buffaloQuantity != null || body.buffaloFat != null || body.buffaloFatMeterReading != null) {
    lines.push({
      milkType: 'buffalo',
      quantity: Number(body.buffaloQuantity) || 0,
      fat: Number(body.buffaloFat) || 0,
      snf: Number(body.buffaloSnf) || 0,
      fatMeterReading: body.buffaloFatMeterReading != null ? Number(body.buffaloFatMeterReading) : null
    });
  }
  return lines;
};

const computeLine = (supplier, line) => {
  const ratePerFat = resolveSupplierRatePerFat(supplier, line.milkType);
  const { amount } = computeProcurementAmount(
    line.quantity,
    line.fat,
    ratePerFat,
    line.fatMeterReading
  );
  return {
    milkType: line.milkType,
    quantity: line.quantity,
    fat: line.fat,
    snf: line.snf || 0,
    fatMeterReading: line.fatMeterReading ?? 0,
    ratePerFat,
    amount
  };
};

const computeMixedProcurement = (supplier, inputLines) => {
  const lines = inputLines.map((line) => computeLine(supplier, line));
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const amount = lines.reduce((sum, line) => sum + line.amount, 0);
  const fatWeight = lines.reduce((sum, line) => sum + line.quantity * line.fat, 0);
  const snfWeight = lines.reduce((sum, line) => sum + line.quantity * (line.snf || 0), 0);
  const fat = quantity > 0 ? fatWeight / quantity : 0;
  const snf = quantity > 0 ? snfWeight / quantity : 0;
  const rateWeight = lines.reduce((sum, line) => sum + line.quantity * line.fat, 0);
  const ratePerFat = rateWeight > 0
    ? lines.reduce((sum, line) => sum + line.quantity * line.fat * line.ratePerFat, 0) / rateWeight
    : 0;

  return { lines, quantity, fat, snf, amount, ratePerFat, fatMeterReading: 0 };
};

const validateMixedLines = (lines) => {
  if (!lines.length) {
    return 'At least one cow or buffalo line is required for mixed procurement';
  }
  for (const line of lines) {
    if (line.quantity == null || line.fat == null) {
      return 'Each line must include quantity and fat';
    }
  }
  return null;
};

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
    const body = req.body;
    const { supplierId, date, shift, milkType, quantity, fat, snf, fatMeterReading, remarks } = body;

    if (!supplierId || !date || !shift) {
      return res.status(400).json({
        success: false,
        message: 'supplierId, date, and shift are required'
      });
    }

    if (!['morning', 'evening'].includes(shift)) {
      return res.status(400).json({
        success: false,
        message: "shift must be 'morning' or 'evening'"
      });
    }

    if (milkType && !MILK_TYPES.includes(milkType)) {
      return res.status(400).json({
        success: false,
        message: "milkType must be 'cow', 'buffalo', or 'mixed'"
      });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const mixedEntry = isMixedPayload(body);
    let procurementData;

    if (mixedEntry) {
      const inputLines = parseMixedInputLines(body);
      const lineError = validateMixedLines(inputLines);
      if (lineError) {
        return res.status(400).json({ success: false, message: lineError });
      }

      const rateError = validateMixedLineRates(supplier, inputLines);
      if (rateError) {
        return res.status(400).json({ success: false, message: rateError });
      }

      const computed = computeMixedProcurement(supplier, inputLines);
      procurementData = {
        tenantId,
        supplierId,
        date: new Date(date),
        shift,
        milkType: 'mixed',
        ...computed,
        recordedBy: user._id,
        remarks: remarks || ''
      };
    } else {
      if (quantity == null || fat == null) {
        return res.status(400).json({
          success: false,
          message: 'quantity and fat are required'
        });
      }

      const procurementMilkType = milkType || supplier.milkType || 'cow';
      const rateError = validateSupplierRate(supplier, procurementMilkType);
      if (rateError) {
        return res.status(400).json({ success: false, message: rateError });
      }

      const baseRate = resolveSupplierRatePerFat(supplier, procurementMilkType);
      const { amount } = computeProcurementAmount(quantity, fat, baseRate, fatMeterReading);

      procurementData = {
        tenantId,
        supplierId,
        date: new Date(date),
        shift,
        milkType: procurementMilkType,
        quantity: quantity || 0,
        fat: fat || 0,
        snf: snf || 0,
        fatMeterReading: fatMeterReading || 0,
        ratePerFat: baseRate,
        amount,
        recordedBy: user._id,
        remarks: remarks || ''
      };
    }

    const procurement = new Procurement(procurementData);
    await procurement.save();
    await procurement.populate('supplierId', 'supplierCode name phone village');

    if (supplier.phone) {
      sendWhatsAppTemplate(
        supplier.phone,
        'milk_delivery_alert',
        {
          quantity: `${procurement.quantity} Kg`,
          amount: `${procurement.amount.toFixed(2)}`,
          name: supplier.name,
          fat_percentage: `${procurement.fat}`,
        }
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
    const body = req.body;
    const { shift, milkType, quantity, fat, snf, fatMeterReading, ratePerFat, remarks } = body;

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
    if (milkType !== undefined) {
      if (!MILK_TYPES.includes(milkType)) {
        return res.status(400).json({
          success: false,
          message: "milkType must be 'cow', 'buffalo', or 'mixed'"
        });
      }
      procurement.milkType = milkType;
    }
    if (remarks != null) procurement.remarks = remarks;

    const supplier = await Supplier.findOne({ _id: procurement.supplierId, tenantId });
    const mixedUpdate = isMixedPayload(body);

    if (mixedUpdate) {
      procurement.milkType = 'mixed';
      const inputLines = parseMixedInputLines(body);
      const lineError = validateMixedLines(inputLines);
      if (lineError) {
        return res.status(400).json({ success: false, message: lineError });
      }

      const rateError = validateMixedLineRates(supplier, inputLines);
      if (rateError) {
        return res.status(400).json({ success: false, message: rateError });
      }

      const computed = computeMixedProcurement(supplier, inputLines);
      procurement.lines = computed.lines;
      procurement.quantity = computed.quantity;
      procurement.fat = computed.fat;
      procurement.snf = computed.snf;
      procurement.amount = computed.amount;
      procurement.ratePerFat = computed.ratePerFat;
      procurement.fatMeterReading = computed.fatMeterReading;
    } else {
      if (quantity != null) procurement.quantity = quantity;
      if (fat != null) procurement.fat = fat;
      if (snf != null) procurement.snf = snf;
      if (fatMeterReading != null) procurement.fatMeterReading = fatMeterReading;
      procurement.lines = undefined;

      if (ratePerFat != null) {
        procurement.ratePerFat = ratePerFat;
      } else if (supplier) {
        const rateError = validateSupplierRate(supplier, procurement.milkType);
        if (rateError) {
          return res.status(400).json({ success: false, message: rateError });
        }
        procurement.ratePerFat = resolveSupplierRatePerFat(supplier, procurement.milkType);
      }
      const { amount } = computeProcurementAmount(
        procurement.quantity,
        procurement.fat,
        procurement.ratePerFat,
        procurement.fatMeterReading,
        { ignoreZero: fatMeterReading == null }
      );
      procurement.amount = amount;
    }

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
