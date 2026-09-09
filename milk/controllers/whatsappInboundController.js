import { Supplier } from '../models/Supplier.js';
import { SupplierWhatsAppReply } from '../models/SupplierWhatsAppReply.js';
import { phoneMatchVariants } from '../../util/whatsapp.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const parseMaybeJson = (value) => {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const toDateKeyIST = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const dateFromKey = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const isOutbound = (payload) => {
  const direction = payload.direction ?? payload.Direction;
  if (direction === 1 || direction === '1' || String(direction).toLowerCase() === 'outbound') {
    return true;
  }
  return false;
};

const extractPhone = (payload) => {
  const fromMessages = parseMaybeJson(payload.messages);
  const firstMessage = Array.isArray(fromMessages) ? fromMessages[0] : null;
  return (
    payload.customerNumber ||
    payload.customer_number ||
    firstMessage?.from ||
    payload.from ||
    ''
  );
};

const extractUuid = (payload) => {
  const fromMessages = parseMaybeJson(payload.messages);
  const firstMessage = Array.isArray(fromMessages) ? fromMessages[0] : null;
  return (
    payload.uuid ||
    payload.message_uuid ||
    firstMessage?.id ||
    payload.requestId ||
    payload.request_id ||
    null
  );
};

const extractText = (payload) => {
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text.trim();

  const content = parseMaybeJson(payload.content);
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (content && typeof content.text === 'string' && content.text.trim()) return content.text.trim();

  const messages = parseMaybeJson(payload.messages);
  if (Array.isArray(messages) && messages[0]) {
    const msg = messages[0];
    const body = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title;
    if (body) return String(body).trim();
    if (msg.caption) return String(msg.caption).trim();
  }

  const button = parseMaybeJson(payload.button);
  if (button?.text) return String(button.text).trim();

  if (payload.caption) return String(payload.caption).trim();
  if (payload.reaction) return String(payload.reaction).trim();

  return '';
};

const extractContentType = (payload) => {
  if (payload.contentType) return payload.contentType;
  if (payload.message_type) return payload.message_type;
  const messages = parseMaybeJson(payload.messages);
  if (Array.isArray(messages) && messages[0]?.type) return messages[0].type;
  return 'text';
};

const extractReceivedAt = (payload) => {
  const ts = payload.ts || payload.requestedAt || payload.requested_at;
  if (ts) {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const messages = parseMaybeJson(payload.messages);
  const unix = messages?.[0]?.timestamp;
  if (unix) {
    const n = Number(unix);
    if (!Number.isNaN(n)) return new Date(n * 1000);
  }
  return new Date();
};

const findSuppliersByPhone = async (phone) => {
  const variants = phoneMatchVariants(phone);
  if (!variants.length) return [];

  const exact = await Supplier.find({ phone: { $in: variants } }).lean();
  if (exact.length) return exact;

  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (last10.length !== 10) return [];
  return Supplier.find({ phone: { $regex: `${last10}$` } }).lean();
};

const saveReplyForSupplier = async ({ payload, phone, receivedAt, dateKey, date, message, contentType, messageUuid, supplier }) => {
  const doc = {
    tenantId: supplier?.tenantId || null,
    supplierId: supplier?._id || null,
    supplierName: supplier?.name || payload.customerName || '',
    supplierCode: supplier?.supplierCode || '',
    phone,
    dateKey,
    date,
    receivedAt,
    contentType,
    message,
    raw: payload,
    messageUuid: messageUuid || undefined,
    matched: Boolean(supplier)
  };

  try {
    await SupplierWhatsAppReply.create(doc);
    return true;
  } catch (err) {
    if (err?.code === 11000) {
      return false;
    }
    throw err;
  }
};

const processInboundPayload = async (payload) => {
  if (!payload || typeof payload !== 'object') return { skipped: true, reason: 'empty' };
  if (isOutbound(payload)) return { skipped: true, reason: 'outbound' };

  const phone = String(extractPhone(payload) || '').replace(/\D/g, '');
  if (!phone) return { skipped: true, reason: 'no_phone' };

  const receivedAt = extractReceivedAt(payload);
  const dateKey = toDateKeyIST(receivedAt);
  const date = dateFromKey(dateKey);
  const message = extractText(payload);
  const contentType = extractContentType(payload);
  const messageUuid = extractUuid(payload);

  const suppliers = await findSuppliersByPhone(phone);
  if (!suppliers.length) {
    await saveReplyForSupplier({
      payload,
      phone,
      receivedAt,
      dateKey,
      date,
      message,
      contentType,
      messageUuid,
      supplier: null
    });
    return { stored: 1, matched: false, dateKey };
  }

  let stored = 0;
  for (const supplier of suppliers) {
    const ok = await saveReplyForSupplier({
      payload,
      phone,
      receivedAt,
      dateKey,
      date,
      message,
      contentType,
      messageUuid,
      supplier
    });
    if (ok) stored += 1;
  }
  return { stored, matched: true, dateKey, supplierCount: suppliers.length };
};

const verifyWebhookSecret = (req) => {
  const expected = process.env.MSG91_WEBHOOK_SECRET;
  if (!expected) return true;
  const header =
    req.headers['x-webhook-secret'] ||
    req.headers['x-msg91-secret'] ||
    '';
  const queryToken = req.query?.token || '';
  return header === expected || queryToken === expected;
};

/**
 * Public MSG91 inbound webhook. Configure this URL in MSG91 WhatsApp → Webhook (New)
 * for "On Inbound Request Received".
 */
export const handleWhatsAppInbound = async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
  }

  try {
    const body = req.body;
    const events = Array.isArray(body) ? body : [body];
    const results = [];
    for (const event of events) {
      results.push(await processInboundPayload(event));
    }
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('WhatsApp inbound webhook error:', err);
    return res.status(500).json({ success: false, message: 'Failed to store inbound message' });
  }
};

export const listWhatsAppReplies = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { date, fromDate, toDate, supplierId, page = 1, limit = 100 } = req.query;

    const filter = { tenantId };
    if (user?.role === 'supplier') {
      const supplier = await Supplier.findOne({ tenantId, userId: user._id }).lean();
      if (!supplier) {
        return res.status(404).json({ success: false, message: 'Supplier profile not found' });
      }
      filter.supplierId = supplier._id;
    } else if (supplierId) {
      filter.supplierId = supplierId;
    }

    if (date) {
      filter.dateKey = date;
    } else if (fromDate || toDate) {
      filter.dateKey = {};
      if (fromDate) filter.dateKey.$gte = fromDate;
      if (toDate) filter.dateKey.$lte = toDate;
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [replies, total] = await Promise.all([
      SupplierWhatsAppReply.find(filter)
        .sort({ dateKey: -1, receivedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      SupplierWhatsAppReply.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: replies,
      pagination: { page: parseInt(page, 10), limit: parseInt(limit, 10), total }
    });
  } catch (err) {
    console.error('List WhatsApp replies error:', err);
    res.status(500).json({ success: false, message: 'Failed to list WhatsApp replies' });
  }
};
