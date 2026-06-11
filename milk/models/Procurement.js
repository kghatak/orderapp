import mongoose from 'mongoose';

const procurementLineSchema = new mongoose.Schema({
  milkType: { type: String, enum: ['cow', 'buffalo'], required: true },
  quantity: { type: Number, required: true },
  fat: { type: Number, default: 0 },
  snf: { type: Number, default: 0 },
  fatMeterReading: { type: Number, default: 0 },
  ratePerFat: { type: Number, required: true },
  amount: { type: Number, required: true }
}, { _id: false });

const procurementSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  date: { type: Date, required: true },
  shift: { type: String, enum: ['morning', 'evening'], required: true },
  milkType: { type: String, enum: ['cow', 'buffalo', 'mixed'], default: 'cow' },
  quantity: { type: Number, required: true }, // Kg
  fat: { type: Number, default: 0 },
  snf: { type: Number, default: 0 },
  fatMeterReading: { type: Number, default: 0 },
  lines: { type: [procurementLineSchema], default: undefined },
  ratePerFat: { type: Number, required: true }, // snapshot of supplier rate for milkType at entry time
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
