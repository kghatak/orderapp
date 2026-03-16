import mongoose from 'mongoose';

const milkPaymentSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  amount: { type: Number, required: true },
  paymentDate: { type: Date, required: true },
  paymentMode: { type: String, enum: ['cash', 'bank', 'upi'], default: 'cash' },
  referenceNo: { type: String, default: '' },
  procurementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Procurement' }],
  remarks: { type: String, default: '' },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'MilkUser', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

milkPaymentSchema.index({ tenantId: 1, paymentDate: -1 });
milkPaymentSchema.index({ tenantId: 1, supplierId: 1, paymentDate: -1 });

export const MilkPayment = mongoose.model('MilkPayment', milkPaymentSchema);
