/** Plain-text pieces for the event-order WhatsApp templates. */

export const DEFAULT_STAFF_PHONES = ['6363124639', '9255919666', '8570839171', '7678887476', '8307084996', '9812712739', '9717225445', '9653530327'];

const TEMPLATE_DEFAULTS = {
  EVENT_ORDER_WA_TEMPLATE_CREATED: 'event_order_created_v3',
  EVENT_ORDER_WA_TEMPLATE_CREATED_HI: 'event_order_created_hi_v3',
  EVENT_ORDER_WA_TEMPLATE_STAFF_CONFIRMED: 'event_order_staff_confirmed_v3',
  EVENT_ORDER_WA_TEMPLATE_STAFF_CANCELLED: 'event_order_staff_cancelled_v3',
  EVENT_ORDER_WA_TEMPLATE_STAFF_EDIT: 'event_order_staff_edit_v3',
  EVENT_ORDER_WA_TEMPLATE_STAFF_REMINDER: 'event_order_staff_reminder_v3',
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

const CONFIRM_REPLIES = new Set(['confirm', 'confirmed', 'पुष्टि करें']);
const CANCEL_REPLIES = new Set(['cancel', 'cancelled', 'रद्द करें']);
const EDIT_REPLIES = new Set(['edit', 'बदलें']);

export function customerReplyAction(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (CONFIRM_REPLIES.has(value)) return 'confirm';
  if (CANCEL_REPLIES.has(value)) return 'cancel';
  if (EDIT_REPLIES.has(value)) return 'edit';
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

const SLOT_LABELS = {
  hi: { Morning: 'सुबह', Afternoon: 'दोपहर', Evening: 'शाम' },
};

function customerLanguage(order) {
  return order?.customer?.language === 'hi' ? 'hi' : 'en';
}

function slotLabel(slot, language) {
  const text = String(slot || '').trim();
  return SLOT_LABELS[language]?.[text] || text;
}

function formatEventDateLabel(value, language = 'en') {
  if (!value) return '—';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 6, 30, 0));
  return noonUtc.toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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

function clipLines(value, max = 900) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function itemsText(order, language = 'en') {
  const lines = (order?.items || []).map((item) => {
    const name = blank(item?.name);
    const qty = `${formatQty(item?.quantity)} ${blank(item?.unit)}`.trim();
    const when = [formatEventDateLabel(item?.date, language), slotLabel(item?.timeSlot, language)]
      .filter((part) => part && part !== '—')
      .join(', ');
    const booking = when
      ? (language === 'hi' ? `${name} को ${when}` : `${name} on ${when}`)
      : name;
    return `${booking} — ${qty} — ${formatInr(item?.amount)}`;
  });
  const empty = language === 'hi' ? 'कोई आइटम नहीं' : 'No items';
  return clipLines(lines.length ? lines.join('\n') : empty);
}

function sharedFields(order, language = 'en') {
  return {
    customer_name: blank(order?.customer?.name),
    phone: blank(order?.customer?.phone),
    order_id: blank(order?.orderId),
    address: clip(blank(order?.customer?.address), 300),
    items: itemsText(order, language),
    total: formatInr(order?.pricing?.totalAmount),
    advance: formatInr(order?.pricing?.advanceAmount),
    balance: formatInr(order?.pricing?.balanceAmount),
    language,
  };
}

function placeText(fields) {
  if (fields.address && fields.address !== '—') return fields.address;
  return fields.language === 'hi' ? 'नहीं दिया गया' : 'Not provided';
}

function paymentText(fields) {
  if (fields.language === 'hi') {
    return `कुल - ${fields.total}. अग्रिम - ${fields.advance}. बाकी - ${fields.balance}`;
  }
  return `Total - ${fields.total}. Advance - ${fields.advance}. Balance - ${fields.balance}`;
}

export function customerOrderMessage(order) {
  const language = customerLanguage(order);
  const fields = sharedFields(order, language);
  return {
    template: eventOrderTemplate(language === 'hi'
      ? 'EVENT_ORDER_WA_TEMPLATE_CREATED_HI'
      : 'EVENT_ORDER_WA_TEMPLATE_CREATED'),
    language,
    phone: order?.customer?.phone,
    params: {
      customer_name: fields.customer_name,
      order_id: fields.order_id,
      items: fields.items,
      place: placeText(fields),
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
      items: fields.items,
      place: placeText(fields),
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
      items: fields.items,
      place: placeText(fields),
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
      items: fields.items,
      place: placeText(fields),
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
