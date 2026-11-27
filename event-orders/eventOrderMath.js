/** Pure event-order calculations. Dates use the Asia/Kolkata calendar. */

export class EventOrderError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'EventOrderError';
    this.status = status;
  }
}

export const EVENT_TYPES = [
  'Wedding',
  'Birthday',
  'Anniversary',
  'Engagement',
  'Griha Pravesh',
  'Festival',
  'Party',
  'Other',
];

export const EVENT_STATUSES = [
  'Enquiry',
  'Confirmed',
  'Preparing',
  'Ready',
  'Delivered',
  'Completed',
  'Cancelled',
];

/** Statuses that still receive the automatic three-day reminder. */
export const REMINDER_ACTIVE_STATUSES = ['Confirmed', 'Preparing', 'Ready'];

export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Other'];
export const DELIVERY_TYPES = ['Delivery', 'Self Pickup'];
export const REMINDER_STATUSES = [
  'scheduled',
  'passed',
  'not_applicable',
  'cancelled',
  'sent',
  'failed',
];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(n) * 100) + 1e-8)) / 100;
}

export function roundQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(n) * 1000) + 1e-8)) / 1000;
}

export function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/** Add whole calendar days to a YYYY-MM-DD date. The result stays a calendar date. */
export function addCalendarDays(dateStr, days) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function istCalendarDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Reminder clock. EVENT_ORDER_REMINDER_DAYS and EVENT_ORDER_REMINDER_TIME override the defaults. */
export function reminderSettings() {
  const daysRaw = Number(process.env.EVENT_ORDER_REMINDER_DAYS);
  const days = Number.isInteger(daysRaw) && daysRaw >= 0 && daysRaw <= 30 ? daysRaw : 3;
  const timeRaw = String(process.env.EVENT_ORDER_REMINDER_TIME || '10:00').trim();
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : '10:00';
  return { days, time };
}

/** UTC instant for `time` on the IST calendar day `days` before eventDate (YYYY-MM-DD). */
export function reminderInstant(eventDate, settings = reminderSettings()) {
  const [year, month, day] = String(eventDate).split('-').map(Number);
  const [hour, minute] = String(settings.time).split(':').map(Number);
  const utcClock = Date.UTC(year, month - 1, day - settings.days, hour, minute, 0, 0);
  return new Date(utcClock - IST_OFFSET_MS);
}

export function computeReminder({
  eventDate,
  orderStatus,
  previous,
  now = new Date(),
  settings = reminderSettings(),
}) {
  const history = Array.isArray(previous?.history) ? previous.history : [];
  if (previous?.status === 'sent') {
    return {
      scheduledAt: previous.scheduledAt || null,
      status: 'sent',
      recipient: previous.recipient || '',
      sentAt: previous.sentAt || null,
      providerMessageId: previous.providerMessageId || '',
      errorMessage: previous.errorMessage || '',
      history,
    };
  }

  const base = {
    scheduledAt: null,
    recipient: '',
    sentAt: null,
    providerMessageId: '',
    errorMessage: '',
    history,
  };

  if (orderStatus === 'Cancelled') {
    return {
      ...base,
      status: 'cancelled',
      errorMessage: 'Cancelled orders are not reminded.',
    };
  }

  if (!REMINDER_ACTIVE_STATUSES.includes(orderStatus)) {
    return { ...base, status: 'not_applicable' };
  }

  const scheduledAt = reminderInstant(eventDate, settings);
  const reminderDay = istCalendarDate(scheduledAt);
  const today = istCalendarDate(now);
  const passed = reminderDay < today;
  return {
    ...base,
    scheduledAt,
    status: passed ? 'passed' : 'scheduled',
    errorMessage: passed
      ? 'The reminder date has passed, so an automatic reminder will not be sent.'
      : '',
  };
}

export function resolveDiscount(subtotal, discount, discountType) {
  const raw = Number(discount ?? 0);
  if (!Number.isFinite(raw) || raw < 0) {
    throw new EventOrderError(400, 'Discount cannot be negative.');
  }
  if (discountType === 'percent') {
    if (raw > 100) throw new EventOrderError(400, 'Discount cannot be more than 100%.');
    return roundMoney((Number(subtotal) || 0) * raw / 100);
  }
  if (discountType && discountType !== 'amount') {
    throw new EventOrderError(400, 'Discount type is invalid.');
  }
  return roundMoney(raw);
}

export function computePricing({ items, discount, discountType, additionalCharges, payments }) {
  const subtotal = roundMoney(
    (items || []).reduce((sum, item) => sum + Number(item.amount), 0),
  );
  const discountAmount = resolveDiscount(subtotal, discount, discountType);
  const charges = roundMoney(additionalCharges ?? 0);
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    throw new EventOrderError(400, 'Discount cannot be negative.');
  }
  if (!Number.isFinite(charges) || charges < 0) {
    throw new EventOrderError(400, 'Additional charges cannot be negative.');
  }
  if (discountAmount > subtotal) {
    throw new EventOrderError(400, 'Discount cannot be more than the item subtotal.');
  }
  const totalAmount = roundMoney(subtotal - discountAmount + charges);
  const advanceAmount = roundMoney(
    (payments || []).reduce((sum, payment) => sum + Number(payment.amount), 0),
  );
  return {
    subtotal,
    discount: discountAmount,
    additionalCharges: charges,
    totalAmount,
    advanceAmount,
    balanceAmount: roundMoney(totalAmount - advanceAmount),
  };
}

export function assertEnum(value, allowed, message) {
  if (!allowed.includes(value)) throw new EventOrderError(400, message);
  return value;
}

export function assertEventDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new EventOrderError(400, 'Event date is required.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year
    || utc.getUTCMonth() !== month - 1
    || utc.getUTCDate() !== day
  ) {
    throw new EventOrderError(400, 'Event date is invalid.');
  }
  return date;
}

/** A new event date must be today or later on the Asia/Kolkata calendar. */
export function assertEventDateNotPast(date, now = new Date()) {
  if (date < istCalendarDate(now)) {
    throw new EventOrderError(400, 'Event date cannot be in the past.');
  }
  return date;
}

export function assertEventTime(value) {
  const time = String(value || '').trim();
  if (!time) return '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new EventOrderError(400, 'Event time must be HH:MM.');
  }
  return time;
}

export function normalizePhone(value, required, label) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const phone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!phone && !required) return '';
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new EventOrderError(400, `${label} must be a 10-digit mobile number.`);
  }
  return phone;
}

export function normalizeCustomer(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const name = cleanText(source.name ?? source.customerName, 120);
  if (!name) throw new EventOrderError(400, 'Customer name is required.');
  const phone = normalizePhone(source.phone ?? source.mobile, true, 'Mobile number');
  const alternatePhone = normalizePhone(source.alternatePhone, false, 'Alternate number');
  if (alternatePhone && alternatePhone === phone) {
    throw new EventOrderError(400, 'Alternate number must be different from the mobile number.');
  }
  return {
    name,
    phone,
    alternatePhone,
    address: cleanText(source.address, 500),
  };
}

export function normalizeEvent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const guestRaw = source.guestCount;
  let guestCount = null;
  if (guestRaw !== undefined && guestRaw !== null && guestRaw !== '') {
    const guest = Number(guestRaw);
    if (!Number.isInteger(guest) || guest < 0 || guest > 100000) {
      throw new EventOrderError(400, 'Guest count must be a whole number.');
    }
    guestCount = guest;
  }
  return {
    type: assertEnum(source.type ?? source.eventType, EVENT_TYPES, 'Choose an event type.'),
    name: cleanText(source.name ?? source.eventName, 120),
    date: assertEventDate(source.date ?? source.eventDate),
    time: assertEventTime(source.time ?? source.eventTime),
    venue: cleanText(source.venue, 300),
    guestCount,
    deliveryType: assertEnum(
      source.deliveryType || 'Delivery',
      DELIVERY_TYPES,
      'Choose delivery or self pickup.',
    ),
  };
}

export function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new EventOrderError(400, 'Add at least one item.');
  }
  if (rawItems.length > 200) {
    throw new EventOrderError(400, 'An event order can have at most 200 items.');
  }
  return rawItems.map((raw, index) => {
    const label = `Item ${index + 1}`;
    const name = cleanText(raw?.name, 200);
    if (!name) throw new EventOrderError(400, `${label} needs a name.`);
    const category = cleanText(raw?.category, 80);
    const unit = cleanText(raw?.unit, 40);
    if (!unit) throw new EventOrderError(400, `${label} needs a unit.`);
    const quantity = roundQty(raw?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new EventOrderError(400, `${label} quantity must be greater than zero.`);
    }
    const rate = roundMoney(raw?.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new EventOrderError(400, `${label} rate cannot be negative.`);
    }
    const productId = cleanText(raw?.productId, 128);
    return {
      productId,
      name,
      category,
      quantity,
      unit,
      rate,
      amount: roundMoney(quantity * rate),
      custom: !productId,
    };
  });
}

function paymentActor(actor) {
  return {
    userId: cleanText(actor?.userId, 64),
    name: cleanText(actor?.name, 120) || 'Admin',
  };
}

export function parsePaidAt(value, now = new Date()) {
  if (!value) return now;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
      utc.getUTCFullYear() !== year
      || utc.getUTCMonth() !== month - 1
      || utc.getUTCDate() !== day
    ) {
      throw new EventOrderError(400, 'Payment date is invalid.');
    }
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0) - IST_OFFSET_MS);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EventOrderError(400, 'Payment date is invalid.');
  }
  return date;
}

export function buildPayment({ amount, mode, notes, paidAt, actor, now }) {
  const value = roundMoney(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new EventOrderError(400, 'Enter a payment amount greater than zero.');
  }
  return {
    amount: value,
    mode: assertEnum(mode, PAYMENT_MODES, 'Choose a payment mode.'),
    notes: cleanText(notes, 500),
    paidAt: parsePaidAt(paidAt, now || new Date()),
    recordedBy: paymentActor(actor),
  };
}

function auditText(value, max = 80) {
  const text = cleanText(value, 500);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function auditMoney(value) {
  const amount = roundMoney(value || 0);
  return `₹${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function auditQty(value) {
  const quantity = roundQty(value);
  return Number.isFinite(quantity) ? String(quantity) : '';
}

function itemOffer(item) {
  return `${auditQty(item?.quantity)} ${cleanText(item?.unit, 40)} at ${auditMoney(item?.rate)}`.trim();
}

function sameAuditItem(left, right) {
  const leftId = cleanText(left?.productId, 128);
  const rightId = cleanText(right?.productId, 128);
  if (leftId && rightId) return leftId === rightId;
  return cleanText(left?.name, 200).toLowerCase() === cleanText(right?.name, 200).toLowerCase();
}

function describeItemChanges(beforeItems, afterItems) {
  const before = Array.isArray(beforeItems) ? beforeItems : [];
  const after = Array.isArray(afterItems) ? afterItems : [];
  const used = new Set();
  const lines = [];
  after.forEach((next) => {
    const index = before.findIndex((item, itemIndex) => !used.has(itemIndex) && sameAuditItem(item, next));
    if (index === -1) {
      lines.push(`Added ${cleanText(next?.name, 200)}, ${itemOffer(next)}.`);
      return;
    }
    used.add(index);
    const prev = before[index];
    const prevName = cleanText(prev?.name, 200);
    const nextName = cleanText(next?.name, 200);
    const prevOffer = itemOffer(prev);
    const nextOffer = itemOffer(next);
    if (prevName === nextName && prevOffer === nextOffer) return;
    const nextLabel = prevName === nextName ? nextOffer : `${nextName}, ${nextOffer}`;
    lines.push(`${prevName}: ${prevOffer} → ${nextLabel}.`);
  });
  before.forEach((item, index) => {
    if (!used.has(index)) lines.push(`Removed ${cleanText(item?.name, 200)}, ${itemOffer(item)}.`);
  });
  return lines;
}

function pushTextChange(lines, label, from, to) {
  const left = auditText(from);
  const right = auditText(to);
  if (left === right) return;
  if (!left) lines.push(`${label} set to ${right}.`);
  else if (!right) lines.push(`${label} cleared (was ${left}).`);
  else lines.push(`${label}: ${left} → ${right}.`);
}

function pushMoneyChange(lines, label, from, to) {
  const left = roundMoney(from || 0);
  const right = roundMoney(to || 0);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) return;
  lines.push(`${label}: ${auditMoney(left)} → ${auditMoney(right)}.`);
}

/** Human-readable lines for an event-order edit. Status is recorded separately. */
export function describeOrderChanges(before, after) {
  const previous = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  const previousCustomer = previous.customer || {};
  const nextCustomer = next.customer || {};
  const previousEvent = previous.event || {};
  const nextEvent = next.event || {};
  const lines = [];
  pushTextChange(lines, 'Customer', previousCustomer.name, nextCustomer.name);
  pushTextChange(lines, 'Mobile', previousCustomer.phone, nextCustomer.phone);
  pushTextChange(lines, 'Alternate number', previousCustomer.alternatePhone, nextCustomer.alternatePhone);
  pushTextChange(lines, 'Address', previousCustomer.address, nextCustomer.address);
  pushTextChange(lines, 'Event type', previousEvent.type, nextEvent.type);
  pushTextChange(lines, 'Event name', previousEvent.name, nextEvent.name);
  pushTextChange(lines, 'Event date', previousEvent.date, nextEvent.date);
  pushTextChange(lines, 'Event time', previousEvent.time, nextEvent.time);
  pushTextChange(lines, 'Venue', previousEvent.venue, nextEvent.venue);
  pushTextChange(
    lines,
    'Guests',
    previousEvent.guestCount == null ? '' : previousEvent.guestCount,
    nextEvent.guestCount == null ? '' : nextEvent.guestCount,
  );
  pushTextChange(lines, 'Delivery', previousEvent.deliveryType, nextEvent.deliveryType);
  lines.push(...describeItemChanges(previous.items, next.items));
  pushMoneyChange(lines, 'Discount', previous.discount, next.discount);
  pushMoneyChange(lines, 'Additional charges', previous.additionalCharges, next.additionalCharges);
  pushTextChange(lines, 'Internal notes', previous.notes, next.notes);
  pushTextChange(lines, 'Payment notes', previous.paymentNotes, next.paymentNotes);
  return lines.slice(0, 30);
}

export function initialPayments({ advanceAmount, mode, notes, actor, now }) {
  const amount = roundMoney(advanceAmount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new EventOrderError(400, 'Advance cannot be negative.');
  }
  if (amount === 0) return [];
  if (!PAYMENT_MODES.includes(mode)) {
    throw new EventOrderError(400, 'Choose a payment mode for the advance.');
  }
  return [buildPayment({ amount, mode, notes, actor, now, paidAt: now || new Date() })];
}
