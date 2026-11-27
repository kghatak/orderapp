import { getFirestoreDB } from '../../util/firebase.js';
import { belongsToTenant, withMongoTenant } from '../../util/tenantMiddleware.js';
import { getEventOrderModel, nextEventOrderId } from '../models/EventOrder.js';
import { eventOrderStaffPhones } from '../whatsapp/messages.js';
import { sendCustomerOrderCreated } from '../whatsapp/sendEventOrderWhatsApp.js';
import {
  EVENT_STATUSES,
  EVENT_TYPES,
  EventOrderError,
  assertEnum,
  assertEventDate,
  assertEventDateNotPast,
  buildPayment,
  cleanText,
  computePricing,
  computeReminder,
  initialPayments,
  addCalendarDays,
  istCalendarDate,
  describeOrderChanges,
  normalizeCustomer,
  normalizeEvent,
  normalizeItems,
} from '../eventOrderMath.js';

function sendError(res, err) {
  if (err instanceof EventOrderError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  if (err?.name === 'ValidationError') {
    return res.status(400).json({ success: false, message: 'Event order details are invalid.' });
  }
  if (err?.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Could not assign an order number. Please retry.',
    });
  }
  console.error('Event order error:', err);
  return res.status(500).json({ success: false, message: 'Event order request failed.' });
}

function present(doc) {
  if (!doc) return null;
  const object = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  object.id = String(object._id);
  return object;
}

function actorFrom(req) {
  return {
    userId: req.adminUser.userId,
    name: req.adminUser.name,
  };
}

function plain(value) {
  if (!value) return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function categoryLabel(category) {
  if (!category) return '';
  if (typeof category === 'string') return cleanText(category, 80);
  if (typeof category === 'object') return cleanText(category.title || category.name || '', 80);
  return '';
}

async function loadProduct(tenantId, productId) {
  let doc;
  try {
    doc = await getFirestoreDB().collection('products').doc(productId).get();
  } catch {
    throw new EventOrderError(400, 'A selected product was not found.');
  }
  if (!doc.exists || !belongsToTenant(doc.data()?.tenantId, tenantId)) {
    throw new EventOrderError(400, 'A selected product was not found.');
  }
  const data = doc.data() || {};
  const name = cleanText(data.name, 200);
  if (!name) throw new EventOrderError(400, 'A selected product has no name.');
  const price = Number(data.price);
  return {
    id: doc.id,
    name,
    price: Number.isFinite(price) ? price : 0,
    unit: cleanText(data.unit, 40),
    category: categoryLabel(data.category),
  };
}

async function resolveItems(tenantId, rawItems) {
  if (!Array.isArray(rawItems)) {
    throw new EventOrderError(400, 'Add at least one item.');
  }
  const resolved = [];
  for (const raw of rawItems) {
    const productId = cleanText(raw?.productId, 128);
    const custom = raw?.custom === true || !productId;
    if (custom) {
      resolved.push({ ...raw, productId: '' });
      continue;
    }
    const product = await loadProduct(tenantId, productId);
    const rateMissing = raw?.rate === undefined || raw?.rate === null || raw?.rate === '';
    resolved.push({
      ...raw,
      productId: product.id,
      name: cleanText(raw?.name, 200) || product.name,
      unit: product.unit || cleanText(raw?.unit, 40),
      category: cleanText(raw?.category, 80) || product.category,
      rate: rateMissing ? product.price : raw.rate,
    });
  }
  return normalizeItems(resolved);
}

function reminderFor(order, { eventDate, status, now }) {
  const reminder = computeReminder({
    eventDate,
    orderStatus: status,
    previous: plain(order?.whatsappReminder),
    now,
  });
  if (reminder.status !== 'sent') reminder.recipient = eventOrderStaffPhones().join(', ');
  return reminder;
}

function applyPricing(order, { discount, discountType, additionalCharges }) {
  order.pricing = computePricing({
    items: (order.items || []).map(plain),
    discount,
    discountType,
    additionalCharges,
    payments: (order.payments || []).map(plain),
  });
  order.markModified('pricing');
}

async function findOrder(tenantId, rawId) {
  let id = String(rawId || '').trim();
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep the raw id */
  }
  const filter = isObjectId(id)
    ? { _id: id }
    : /^EO-\d+$/i.test(id)
      ? { orderId: id.toUpperCase() }
      : null;
  if (!filter) throw new EventOrderError(404, 'Event order not found.');
  const order = await getEventOrderModel().findOne(withMongoTenant(filter, tenantId));
  if (!order) throw new EventOrderError(404, 'Event order not found.');
  return order;
}

function listFilter(tenantId, query) {
  const extra = {};
  if (query.status) {
    extra.status = assertEnum(query.status, EVENT_STATUSES, 'Order status is invalid.');
  }
  if (query.eventType) {
    extra['event.type'] = assertEnum(query.eventType, EVENT_TYPES, 'Event type is invalid.');
  }

  const today = istCalendarDate();
  if (query.scope === 'today') {
    extra['event.date'] = today;
    if (!query.status) extra.status = { $ne: 'Cancelled' };
  } else if (query.scope === 'next7') {
    extra['event.date'] = { $gte: today, $lte: addCalendarDays(today, 6) };
    if (!query.status) extra.status = { $nin: ['Cancelled', 'Completed'] };
  } else if (query.scope === 'pending') {
    if (!query.status) extra.status = { $nin: ['Cancelled', 'Completed'] };
  } else if (query.eventDateFrom || query.eventDateTo) {
    const range = {};
    if (query.eventDateFrom) range.$gte = assertEventDate(query.eventDateFrom);
    if (query.eventDateTo) range.$lte = assertEventDate(query.eventDateTo);
    extra['event.date'] = range;
  }

  const q = cleanText(query.q, 80);
  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    extra.$or = [
      { orderId: regex },
      { 'customer.name': regex },
      { 'customer.phone': regex },
      { 'customer.alternatePhone': regex },
    ];
  }
  return withMongoTenant(extra, tenantId);
}

export const getEventOrderSummary = async (req, res) => {
  try {
    const today = istCalendarDate();
    const next7End = addCalendarDays(today, 6);
    const count = (extra) => getEventOrderModel().countDocuments(withMongoTenant(extra, req.tenantId));
    const [
      total,
      pending,
      next7Days,
      todayCount,
      pendingConfirmation,
      preparing,
      completed,
      cancelled,
    ] = await Promise.all([
      count({}),
      count({ status: { $nin: ['Cancelled', 'Completed'] } }),
      count({
        'event.date': { $gte: today, $lte: next7End },
        status: { $nin: ['Cancelled', 'Completed'] },
      }),
      count({ 'event.date': today, status: { $ne: 'Cancelled' } }),
      count({ status: 'Enquiry' }),
      count({ status: 'Preparing' }),
      count({ status: 'Completed' }),
      count({ status: 'Cancelled' }),
    ]);
    res.json({
      success: true,
      data: {
        total,
        pending,
        next7Days,
        today: todayCount,
        pendingConfirmation,
        preparing,
        completed,
        cancelled,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
};

export const listEventOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = listFilter(req.tenantId, req.query);
    const [rows, total] = await Promise.all([
      getEventOrderModel().find(filter)
        .sort({ 'event.date': 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      getEventOrderModel().countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: rows.map(present),
      total,
      page,
      limit,
    });
  } catch (err) {
    sendError(res, err);
  }
};

export const getEventOrder = async (req, res) => {
  try {
    const order = await findOrder(req.tenantId, req.params.id);
    res.json({ success: true, data: present(order) });
  } catch (err) {
    sendError(res, err);
  }
};

export const createEventOrder = async (req, res) => {
  try {
    const body = req.body || {};
    const customer = normalizeCustomer(body.customer);
    const event = normalizeEvent(body.event);
    assertEventDateNotPast(event.date);
    const items = await resolveItems(req.tenantId, body.items);
    const status = assertEnum(body.status || 'Enquiry', EVENT_STATUSES, 'Order status is invalid.');
    const actor = actorFrom(req);
    const now = new Date();
    const payments = initialPayments({
      advanceAmount: body.advanceAmount,
      mode: body.paymentMode,
      notes: body.paymentNotes,
      actor,
      now,
    });
    const pricing = computePricing({
      items,
      discount: body.discount,
      discountType: body.discountType,
      additionalCharges: body.additionalCharges,
      payments,
    });
    const orderId = await nextEventOrderId(req.tenantId);
    const whatsappReminder = reminderFor(null, {
      eventDate: event.date,
      status,
      now,
    });
    const doc = await getEventOrderModel().create({
      tenantId: req.tenantId,
      orderId,
      customer,
      event,
      items,
      pricing,
      payments,
      paymentNotes: cleanText(body.paymentNotes, 500),
      status,
      notes: cleanText(body.notes, 2000),
      whatsappReminder,
      audit: [{
        action: 'created',
        at: now,
        userId: actor.userId,
        name: actor.name,
        detail: `Created as ${status}.`,
      }],
      createdBy: actor,
      updatedBy: actor,
    });
    const notice = await sendCustomerOrderCreated(doc);
    doc.whatsappCustomer = notice;
    doc.audit.push({
      action: 'whatsapp',
      at: new Date(),
      userId: actor.userId,
      name: actor.name,
      detail: notice.status === 'sent'
        ? `WhatsApp order details sent to ${customer.phone}.`
        : `WhatsApp order details were not sent. ${notice.errorMessage || ''}`.trim(),
    });
    doc.markModified('whatsappCustomer');
    await doc.save();
    res.status(201).json({ success: true, data: present(doc) });
  } catch (err) {
    sendError(res, err);
  }
};

export const updateEventOrder = async (req, res) => {
  try {
    const body = req.body || {};
    const order = await findOrder(req.tenantId, req.params.id);
    const before = {
      customer: plain(order.customer) || {},
      event: plain(order.event) || {},
      items: (order.items || []).map((item) => plain(item)),
      notes: order.notes || '',
      paymentNotes: order.paymentNotes || '',
      discount: order.pricing?.discount || 0,
      additionalCharges: order.pricing?.additionalCharges || 0,
    };
    const customer = normalizeCustomer(body.customer);
    const event = normalizeEvent(body.event);
    if (event.date !== order.event?.date) assertEventDateNotPast(event.date);
    const items = await resolveItems(req.tenantId, body.items);
    const status = assertEnum(body.status || order.status, EVENT_STATUSES, 'Order status is invalid.');
    const actor = actorFrom(req);
    const now = new Date();
    const previousStatus = order.status;

    order.customer = customer;
    order.event = event;
    order.items = items;
    order.status = status;
    const notes = cleanText(body.notes, 2000);
    const paymentNotes = cleanText(body.paymentNotes, 500);
    order.notes = notes;
    order.paymentNotes = paymentNotes;
    order.markModified('customer');
    order.markModified('event');
    order.markModified('items');
    applyPricing(order, {
      discount: body.discount,
      discountType: body.discountType,
      additionalCharges: body.additionalCharges,
    });
    order.whatsappReminder = reminderFor(order, {
      eventDate: event.date,
      status,
      now,
    });
    order.markModified('whatsappReminder');
    order.updatedBy = actor;
    const changes = describeOrderChanges(before, {
      customer,
      event,
      items,
      notes,
      paymentNotes,
      discount: order.pricing?.discount || 0,
      additionalCharges: order.pricing?.additionalCharges || 0,
    });
    if (previousStatus !== status) {
      order.audit.push({
        action: 'status',
        at: now,
        userId: actor.userId,
        name: actor.name,
        detail: `Status changed from ${previousStatus} to ${status}.`,
      });
    }
    if (changes.length > 0) {
      order.audit.push({
        action: 'updated',
        at: now,
        userId: actor.userId,
        name: actor.name,
        detail: changes.join('\n'),
      });
    }
    if (order.audit.length > 100) {
      order.audit.splice(0, order.audit.length - 100);
    }
    await order.save();
    res.json({ success: true, data: present(order) });
  } catch (err) {
    sendError(res, err);
  }
};

export const updateEventOrderStatus = async (req, res) => {
  try {
    const order = await findOrder(req.tenantId, req.params.id);
    const status = assertEnum(req.body?.status, EVENT_STATUSES, 'Order status is invalid.');
    const note = cleanText(req.body?.note, 500);
    if (status === order.status && !note) {
      return res.json({ success: true, data: present(order) });
    }
    const actor = actorFrom(req);
    const now = new Date();
    const previousStatus = order.status;
    order.status = status;
    order.whatsappReminder = reminderFor(order, {
      eventDate: order.event.date,
      status,
      now,
    });
    order.markModified('whatsappReminder');
    order.updatedBy = actor;
    const detail = status === previousStatus
      ? `Note: ${note}`
      : `Status changed from ${previousStatus} to ${status}.${note ? ` Note: ${note}` : ''}`;
    order.audit.push({
      action: 'status',
      at: now,
      userId: actor.userId,
      name: actor.name,
      detail,
    });
    if (order.audit.length > 100) {
      order.audit.splice(0, order.audit.length - 100);
    }
    await order.save();
    res.json({ success: true, data: present(order) });
  } catch (err) {
    sendError(res, err);
  }
};

export const addEventOrderPayment = async (req, res) => {
  try {
    const order = await findOrder(req.tenantId, req.params.id);
    const actor = actorFrom(req);
    const now = new Date();
    const payment = buildPayment({
      amount: req.body?.amount,
      mode: req.body?.mode,
      notes: req.body?.notes,
      paidAt: req.body?.paidAt,
      actor,
      now,
    });
    order.payments.push(payment);
    applyPricing(order, {
      discount: order.pricing.discount,
      additionalCharges: order.pricing.additionalCharges,
    });
    order.updatedBy = actor;
    order.audit.push({
      action: 'payment',
      at: now,
      userId: actor.userId,
      name: actor.name,
      detail: `Recorded ${payment.mode} payment of ₹${payment.amount.toFixed(2)}.`,
    });
    if (order.audit.length > 100) {
      order.audit.splice(0, order.audit.length - 100);
    }
    await order.save();
    res.status(201).json({ success: true, data: present(order) });
  } catch (err) {
    sendError(res, err);
  }
};

export const removeEventOrderPayment = async (req, res) => {
  try {
    const order = await findOrder(req.tenantId, req.params.id);
    const paymentId = String(req.params.paymentId || '');
    const payment = (order.payments || []).find((entry) => String(entry._id) === paymentId);
    if (!payment) throw new EventOrderError(404, 'Payment not found.');
    const actor = actorFrom(req);
    const now = new Date();
    order.payments = order.payments.filter((entry) => String(entry._id) !== paymentId);
    order.markModified('payments');
    applyPricing(order, {
      discount: order.pricing.discount,
      additionalCharges: order.pricing.additionalCharges,
    });
    order.updatedBy = actor;
    order.audit.push({
      action: 'payment_removed',
      at: now,
      userId: actor.userId,
      name: actor.name,
      detail: `Removed a ${payment.mode} payment of ₹${Number(payment.amount).toFixed(2)}.`,
    });
    if (order.audit.length > 100) {
      order.audit.splice(0, order.audit.length - 100);
    }
    await order.save();
    res.json({ success: true, data: present(order) });
  } catch (err) {
    sendError(res, err);
  }
};
