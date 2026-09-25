import { Supplier } from '../models/Supplier.js';
import { SupplierWhatsAppReply } from '../models/SupplierWhatsAppReply.js';
import { phoneMatchVariants } from '../../util/whatsapp.js';
import { mongoTenantFilter, withMongoTenant } from '../../util/tenantMiddleware.js';

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

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDateKey = (value) => {
  if (value == null || value === '') return null;
  const key = String(value).trim().slice(0, 10);
  return DATE_KEY_RE.test(key) ? key : null;
};

const buildReplyFilter = async ({ tenantId, user, fromKey, toKey, supplierId }) => {
  const filter = {
    dateKey: { $gte: fromKey, $lte: toKey }
  };

  if (user?.role === 'supplier') {
    const supplier = await Supplier.findOne(withMongoTenant({ userId: user._id }, tenantId)).lean();
    if (!supplier) {
      return { error: { status: 404, message: 'Supplier profile not found' } };
    }
    Object.assign(filter, withMongoTenant({ supplierId: supplier._id }, tenantId));
    return { filter };
  }

  if (supplierId) {
    Object.assign(filter, withMongoTenant({ supplierId }, tenantId));
    return { filter };
  }

  const suppliers = await Supplier.find(withMongoTenant({}, tenantId)).select('phone').lean();
  const phones = [...new Set(suppliers.flatMap((s) => phoneMatchVariants(s.phone)))];
  const tenantClause = mongoTenantFilter(tenantId);
  filter.$or = phones.length
    ? [tenantClause, { phone: { $in: phones } }]
    : [tenantClause];

  return { filter };
};

const toListItem = (reply, includeRaw) => {
  const item = {
    id: reply._id,
    date: reply.dateKey,
    phone: reply.phone,
    supplierId: reply.supplierId,
    supplierName: reply.supplierName,
    supplierCode: reply.supplierCode,
    message: reply.message,
    contentType: reply.contentType,
    receivedAt: reply.receivedAt,
    matched: reply.matched
  };
  if (includeRaw) item.raw = reply.raw;
  return item;
};

export const listWhatsAppReplies = async (req, res) => {
  try {
    const { tenantId, user } = req;
    const { date, fromDate, toDate, supplierId, page = 1, limit = 200, includeRaw } = req.query;

    const fromKey = normalizeDateKey(fromDate || date);
    const toKey = normalizeDateKey(toDate || date);

    if (!fromKey || !toKey) {
      return res.status(400).json({
        success: false,
        message: 'fromDate and toDate are required (YYYY-MM-DD). Use date for a single day.'
      });
    }
    if (fromKey > toKey) {
      return res.status(400).json({
        success: false,
        message: 'toDate must be on or after fromDate'
      });
    }

    const built = await buildReplyFilter({ tenantId, user, fromKey, toKey, supplierId });
    if (built.error) {
      return res.status(built.error.status).json({ success: false, message: built.error.message });
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
    const skip = (pageNum - 1) * limitNum;
    const withRaw = includeRaw === 'true' || includeRaw === '1';

    const [replies, total] = await Promise.all([
      SupplierWhatsAppReply.find(built.filter)
        .sort({ dateKey: -1, receivedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      SupplierWhatsAppReply.countDocuments(built.filter)
    ]);

    const groupedMap = new Map();
    for (const reply of replies) {
      const key = reply.dateKey;
      if (!groupedMap.has(key)) groupedMap.set(key, []);
      groupedMap.get(key).push(toListItem(reply, withRaw));
    }

    const data = [...groupedMap.entries()].map(([day, messages]) => ({
      date: day,
      count: messages.length,
      messages
    }));

    res.json({
      success: true,
      fromDate: fromKey,
      toDate: toKey,
      data,
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error('List WhatsApp replies error:', err);
    res.status(500).json({ success: false, message: 'Failed to list WhatsApp replies' });
  }
};
