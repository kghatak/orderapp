import { Supplier } from '../models/Supplier.js';
import { Procurement } from '../models/Procurement.js';
import { MilkPayment } from '../models/MilkPayment.js';

export const listSuppliers = async (req, res) => {
  try {
    const { tenantId } = req;
    const { page = 1, limit = 50, search, isActive } = req.query;

    const filter = { tenantId };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { supplierCode: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { village: { $regex: search, $options: 'i' } }
      ];
    }
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [suppliers, total] = await Promise.all([
      Supplier.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Supplier.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: suppliers,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
    });
  } catch (err) {
    console.error('List suppliers error:', err);
    res.status(500).json({ success: false, message: 'Failed to list suppliers' });
  }
};

export const getSupplier = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const supplier = await Supplier.findOne({ _id: id, tenantId }).lean();
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    res.json({ success: true, data: supplier });
  } catch (err) {
    console.error('Get supplier error:', err);
    res.status(500).json({ success: false, message: 'Failed to get supplier' });
  }
};

const generateSupplierCode = async (tenantId) => {
  const last = await Supplier.findOne({ tenantId })
    .sort({ supplierCode: -1 })
    .select('supplierCode')
    .lean();
  const match = last?.supplierCode?.match(/^SUP(\d+)$/i);
  const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
  return `SUP${String(nextNum).padStart(5, '0')}`;
};

export const createSupplier = async (req, res) => {
  try {
    const { tenantId } = req;
    const { name, phone, village, address, milkType, bankAccountNo, bankName, ifscCode } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'name and phone are required'
      });
    }

    const supplierCode = await generateSupplierCode(tenantId);

    const supplier = new Supplier({
      tenantId,
      supplierCode,
      name,
      phone,
      village: village || '',
      address: address || '',
      milkType: milkType || 'cow',
      bankAccountNo: bankAccountNo || '',
      bankName: bankName || '',
      ifscCode: ifscCode || ''
    });
    await supplier.save();

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: supplier
    });
  } catch (err) {
    console.error('Create supplier error:', err);
    res.status(500).json({ success: false, message: 'Failed to create supplier' });
  }
};

export const updateSupplier = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const updates = req.body;

    const allowed = ['name', 'phone', 'village', 'address', 'milkType', 'bankAccountNo', 'bankName', 'ifscCode', 'isActive'];
    const toUpdate = {};
    for (const k of allowed) {
      if (updates[k] !== undefined) toUpdate[k] = updates[k];
    }
    toUpdate.updatedAt = new Date();

    const supplier = await Supplier.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: toUpdate },
      { new: true }
    );

    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    res.json({ success: true, message: 'Supplier updated', data: supplier });
  } catch (err) {
    console.error('Update supplier error:', err);
    res.status(500).json({ success: false, message: 'Failed to update supplier' });
  }
};

export const deleteSupplier = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const supplier = await Supplier.findOne({ _id: id, tenantId });
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const [procurementCount, paymentCount] = await Promise.all([
      Procurement.countDocuments({ supplierId: id }),
      MilkPayment.countDocuments({ supplierId: id })
    ]);

    if (procurementCount > 0 || paymentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete supplier with existing records. Remove ${procurementCount} procurement(s) and ${paymentCount} payment(s) first, or use update to set isActive: false.`
      });
    }

    await Supplier.deleteOne({ _id: id, tenantId });

    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (err) {
    console.error('Delete supplier error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete supplier' });
  }
};
