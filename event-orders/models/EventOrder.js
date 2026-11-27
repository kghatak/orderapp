import mongoose from 'mongoose';
import { getEventOrderConnection } from '../config/eventOrderDb.js';
import {
  DELIVERY_TYPES,
  EVENT_STATUSES,
  EVENT_TYPES,
  PAYMENT_MODES,
  REMINDER_STATUSES,
} from '../eventOrderMath.js';

const actorSchema = new mongoose.Schema({
  userId: { type: String, default: '' },
  name: { type: String, default: '' },
}, { _id: false });

const itemSchema = new mongoose.Schema({
  productId: { type: String, default: '' },
  name: { type: String, required: true },
  category: { type: String, default: '' },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  rate: { type: Number, required: true },
  amount: { type: Number, required: true },
  custom: { type: Boolean, default: false },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  mode: { type: String, enum: PAYMENT_MODES, required: true },
  notes: { type: String, default: '' },
  paidAt: { type: Date, required: true },
  recordedBy: { type: actorSchema, required: true },
});

const reminderHistorySchema = new mongoose.Schema({
  status: { type: String, default: '' },
  recipient: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  providerMessageId: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  manual: { type: Boolean, default: false },
  attemptedAt: { type: Date, default: null },
}, { _id: false });

const customerNoticeSchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  sentAt: { type: Date, default: null },
  errorMessage: { type: String, default: '' },
  reply: { type: String, default: '' },
  repliedAt: { type: Date, default: null },
  replyMessageId: { type: String, default: '' },
}, { _id: false });

const reminderSchema = new mongoose.Schema({
  scheduledAt: { type: Date, default: null },
  status: { type: String, enum: REMINDER_STATUSES, default: 'not_applicable' },
  recipient: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  providerMessageId: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  history: { type: [reminderHistorySchema], default: [] },
}, { _id: false });

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true },
  at: { type: Date, required: true },
  userId: { type: String, default: '' },
  name: { type: String, default: '' },
  detail: { type: String, default: '' },
}, { _id: false });

const eventOrderSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  orderId: { type: String, required: true },
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    alternatePhone: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  event: {
    type: { type: String, enum: EVENT_TYPES, required: true },
    name: { type: String, default: '' },
    date: { type: String, required: true },
    time: { type: String, default: '' },
    venue: { type: String, default: '' },
    guestCount: { type: Number, default: null },
    deliveryType: { type: String, enum: DELIVERY_TYPES, required: true },
  },
  items: { type: [itemSchema], required: true },
  pricing: {
    subtotal: { type: Number, required: true },
    discount: { type: Number, required: true },
    additionalCharges: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    advanceAmount: { type: Number, required: true },
    balanceAmount: { type: Number, required: true },
  },
  payments: { type: [paymentSchema], default: [] },
  paymentNotes: { type: String, default: '' },
  status: { type: String, enum: EVENT_STATUSES, required: true, default: 'Enquiry' },
  notes: { type: String, default: '' },
  whatsappReminder: { type: reminderSchema, default: () => ({}) },
  whatsappCustomer: { type: customerNoticeSchema, default: () => ({}) },
  audit: { type: [auditSchema], default: [] },
  createdBy: { type: actorSchema, required: true },
  updatedBy: { type: actorSchema, required: true },
}, { timestamps: true, collection: 'eventOrders' });

eventOrderSchema.index({ tenantId: 1, orderId: 1 }, { unique: true });
eventOrderSchema.index({ tenantId: 1, 'event.date': 1, status: 1 });
eventOrderSchema.index({ tenantId: 1, 'customer.phone': 1 });
eventOrderSchema.index({ 'customer.phone': 1, createdAt: -1 });
eventOrderSchema.index({ status: 1, 'whatsappReminder.status': 1, 'whatsappReminder.scheduledAt': 1 });

const counterSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
}, { collection: 'eventOrderCounters' });

export const getEventOrderModel = () => {
  const conn = getEventOrderConnection();
  return conn.models.EventOrder || conn.model('EventOrder', eventOrderSchema);
};

export const getEventOrderCounterModel = () => {
  const conn = getEventOrderConnection();
  return conn.models.EventOrderCounter || conn.model('EventOrderCounter', counterSchema);
};

export async function nextEventOrderId(tenantId) {
  const counter = await getEventOrderCounterModel().findOneAndUpdate(
    { tenantId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `EO-${String(counter.seq).padStart(5, '0')}`;
}
