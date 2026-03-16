import mongoose from 'mongoose';

const milkUserSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  role: { type: String, enum: ['admin', 'supplier'], required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: '' },
  password: { type: String, required: true },
  fcmToken: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

milkUserSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
milkUserSchema.index({ tenantId: 1, role: 1 });

export const MilkUser = mongoose.model('MilkUser', milkUserSchema);
