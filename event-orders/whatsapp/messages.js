/** Plain-text pieces for the event-order WhatsApp templates. */

export const DEFAULT_STAFF_PHONES = ['6363124639', '9591321921', '9876543210'];

const TEMPLATE_DEFAULTS = {
  EVENT_ORDER_WA_TEMPLATE_CREATED: 'event_order_created_v2',
  EVENT_ORDER_WA_TEMPLATE_STAFF_CONFIRMED: 'event_order_staff_confirmed_v2',
  EVENT_ORDER_WA_TEMPLATE_STAFF_CANCELLED: 'event_order_staff_cancelled_v2',
  EVENT_ORDER_WA_TEMPLATE_STAFF_EDIT: 'event_order_staff_edit_v2',
  EVENT_ORDER_WA_TEMPLATE_STAFF_REMINDER: 'event_order_staff_reminder_v2',
};

export function eventOrderStaffPhones() {
  const raw = process.env.EVENT_ORDER_STAFF_PHONES;
  if (!raw || !String(raw).trim()) return [...DEFAULT_STAFF_PHONES];
  const phones = String(raw)
    .split(/[,;\s]+/)
    .map((value) => value.replace(/\D/g, '').slice(-10))
    .filter((value) => value.length === 10);
  return phones.length ? [...new Set(phones)] : [...DEFAULT_STAFF_PHONES];
}

export function eventOrderTemplate(envName) {
  const fallback = TEMPLATE_DEFAULTS[envName] || '';
  return String(process.env[envName] || fallback).trim();
}

export function customerReplyAction(text) {
  const value = String(text || '').trim().toLowerCase();
  if (value === 'confirm' || value === 'confirmed') return 'confirm';
  if (value === 'cancel' || value === 'cancelled') return 'cancel';
  if (value === 'edit') return 'edit';
  return '';
}

export function statusForCustomerReply(action) {
  if (action === 'confirm') return 'Confirmed';
  if (action === 'cancel') return 'Cancelled';
  if (action === 'edit') return 'Enquiry';
  return '';
}

function blank(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function formatInr(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatEventDateLabel(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 6, 30, 0));
  return noonUtc.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatEventTimeLabel(value) {
  if (!value) return '—';
  const [hour, minute] = String(value).split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return String(value);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function formatQty(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function clip(value, max = 900) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function eventSummary(order) {
  const type = blank(order?.event?.type);
  const name = String(order?.event?.name || '').trim();
  if (!name || type === '—') return type === '—' ? name || '—' : type;
  return `${type} — ${name}`;
}

function itemsText(order) {
  const lines = (order?.items || []).map((item) => {
    const name = blank(item?.name);
    const qty = `${formatQty(item?.quantity)} ${blank(item?.unit)}`.trim();
    return `${name} — ${qty} — ${formatInr(item?.amount)}`;
  });
  return clip(lines.length ? lines.join('\n') : '—');
}

function sharedFields(order) {
  return {
    customer_name: blank(order?.customer?.name),
    phone: blank(order?.customer?.phone),
    order_id: blank(order?.orderId),
    event_summary: eventSummary(order),
    event_date: formatEventDateLabel(order?.event?.date),
    event_time: formatEventTimeLabel(order?.event?.time),
    venue: blank(order?.event?.venue),
    delivery: blank(order?.event?.deliveryType),
    address: clip(blank(order?.customer?.address), 300),
    items: itemsText(order),
    total: formatInr(order?.pricing?.totalAmount),
    advance: formatInr(order?.pricing?.advanceAmount),
    balance: formatInr(order?.pricing?.balanceAmount),
  };
}

function eventDetailsText(fields) {
  const when = [fields.event_date, fields.event_time].filter((part) => part && part !== '—').join(' at ');
  const summary = fields.event_summary && fields.event_summary !== '—' ? fields.event_summary : 'Event';
  return when ? `${summary} on ${when}` : summary;
}

function placeText(fields, { includeAddress = true } = {}) {
  const parts = [`Venue: ${fields.venue}`, `Delivery type: ${fields.delivery}`];
  if (includeAddress) parts.push(`Address: ${fields.address}`);
  return parts.join('. ');
}

function paymentText(fields) {
  return `Total - ${fields.total}. Advance - ${fields.advance}. Balance - ${fields.balance}`;
}

export function customerOrderMessage(order) {
  const fields = sharedFields(order);
  return {
    template: eventOrderTemplate('EVENT_ORDER_WA_TEMPLATE_CREATED'),
    phone: order?.customer?.phone,
    params: {
      customer_name: fields.customer_name,
      order_id: fields.order_id,
      event_details: eventDetailsText(fields),
      place: placeText(fields),
      items: fields.items,
      payment: paymentText(fields),
    },
  };
}

export function staffConfirmedMessage(order) {
  const fields = sharedFields(order);
  return {
    template: eventOrderTemplate('EVENT_ORDER_WA_TEMPLATE_STAFF_CONFIRMED'),
    params: {
      customer_name: fields.customer_name,
      phone: fields.phone,
      order_id: fields.order_id,
      event_details: eventDetailsText(fields),
      place: placeText(fields, { includeAddress: false }),
      items: fields.items,
      payment: paymentText(fields),
    },
  };
}

export function staffCancelledMessage(order) {
  const fields = sharedFields(order);
  return {
    template: eventOrderTemplate('EVENT_ORDER_WA_TEMPLATE_STAFF_CANCELLED'),
    params: {
      customer_name: fields.customer_name,
      phone: fields.phone,
      order_id: fields.order_id,
      event_details: eventDetailsText(fields),
      items: fields.items,
      payment: paymentText(fields),
    },
  };
}

export function staffEditMessage(order) {
  const fields = sharedFields(order);
  return {
    template: eventOrderTemplate('EVENT_ORDER_WA_TEMPLATE_STAFF_EDIT'),
    params: {
      customer_name: fields.customer_name,
      phone: fields.phone,
      order_id: fields.order_id,
      event_details: eventDetailsText(fields),
      place: placeText(fields, { includeAddress: false }),
      items: fields.items,
      payment: paymentText(fields),
    },
  };
}

export function staffReminderMessage(order) {
  const fields = sharedFields(order);
  return {
    template: eventOrderTemplate('EVENT_ORDER_WA_TEMPLATE_STAFF_REMINDER'),
    params: {
      customer_name: fields.customer_name,
      phone: fields.phone,
      order_id: fields.order_id,
      event_details: eventDetailsText(fields),
      place: placeText(fields, { includeAddress: false }),
      items: fields.items,
      balance: fields.balance,
    },
  };
}

export function staffMessageForReply(action, order) {
  if (action === 'confirm') return staffConfirmedMessage(order);
  if (action === 'cancel') return staffCancelledMessage(order);
  if (action === 'edit') return staffEditMessage(order);
  return null;
}
