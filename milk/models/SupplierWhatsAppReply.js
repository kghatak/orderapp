import mongoose from 'mongoose';

const supplierWhatsAppReplySchema = new mongoose.Schema({
  tenantId: { type: String, default: null, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplierName: { type: String, default: '' },
  supplierCode: { type: String, default: '' },
  phone: { type: String, required: true, index: true },
  /** Calendar date in IST as YYYY-MM-DD for date-wise queries */
  dateKey: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  receivedAt: { type: Date, required: true, default: Date.now },
  contentType: { type: String, default: 'text' },
  /** Extracted WhatsApp text / caption / button text */
  message: { type: String, default: '' },
  /** Full inbound webhook payload from MSG91 */
  raw: { type: mongoose.Schema.Types.Mixed, required: true },
  messageUuid: { type: String, default: null },
  matched: { type: Boolean, default: false }
}, {
  timestamps: true
});

supplierWhatsAppReplySchema.index({ tenantId: 1, dateKey: -1, receivedAt: -1 });
supplierWhatsAppReplySchema.index({ tenantId: 1, supplierId: 1, dateKey: -1 });
supplierWhatsAppReplySchema.index(
  { messageUuid: 1, tenantId: 1, phone: 1 },
  { unique: true, sparse: true }
);

export const SupplierWhatsAppReply = mongoose.model(
  'SupplierWhatsAppReply',
  supplierWhatsAppReplySchema
);
