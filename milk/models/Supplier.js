import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'MilkUser', default: null },
  supplierCode: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  village: { type: String, default: '' },
  address: { type: String, default: '' },
  state: { type: String, default: '' },
  pinCode: { type: String, default: '' },
  gstNumber: { type: String, default: '' },
  tdsNature: {
    type: String,
    enum: ['not_applicable', 'purchased_of_goods_194q'],
    default: 'not_applicable',
  },
  milkType: { type: String, enum: ['cow', 'buffalo', 'mixed'], default: 'cow' },
  bankAccountNo: { type: String, default: '' },
  bankName: { type: String, default: '' },
  ifscCode: { type: String, default: '' },
  ratePerFat: { type: Number, default: 0 },
  cowRatePerFat: { type: Number, default: 0 },
  buffaloRatePerFat: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

supplierSchema.index({ tenantId: 1, supplierCode: 1 }, { unique: true });
supplierSchema.index({ tenantId: 1, phone: 1 });
supplierSchema.index({ tenantId: 1, createdAt: -1 });

export const Supplier = mongoose.model('Supplier', supplierSchema);
