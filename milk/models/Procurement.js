import mongoose from 'mongoose';

const procurementSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  date: { type: Date, required: true },
  quantity: { type: Number, required: true }, // litres
  fat: { type: Number, default: 0 },
  snf: { type: Number, default: 0 },
  rate: { type: Number, required: true }, // per litre
  amount: { type: Number, required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'MilkPayment', default: null },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'MilkUser', default: null },
  remarks: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

procurementSchema.index({ tenantId: 1, date: -1 });
procurementSchema.index({ tenantId: 1, supplierId: 1, date: -1 });
procurementSchema.index({ tenantId: 1, paymentStatus: 1 });

export const Procurement = mongoose.model('Procurement', procurementSchema);
