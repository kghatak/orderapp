import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EventOrderError,
  buildPayment,
  computePricing,
  computeReminder,
  describeOrderChanges,
  resolveDiscount,
  initialPayments,
  addCalendarDays,
  istCalendarDate,
  normalizeCustomer,
  normalizeItems,
  normalizePhone,
  normalizeReminderTime,
  reminderInstant,
  roundMoney,
} from './eventOrderMath.js';

const actor = { userId: 'UID0001', name: 'Admin' };
const settings = { days: 3, time: '10:00' };

test('reminder for 25 Dec 2026 is 22 Dec 2026 at 10:00 IST', () => {
  const instant = reminderInstant('2026-12-25', settings);
  assert.equal(instant.toISOString(), '2026-12-22T04:30:00.000Z');
  assert.equal(istCalendarDate(instant), '2026-12-22');
});

test('a chosen reminder time is used on each of the last 3 days', () => {
  assert.equal(normalizeReminderTime('15:30'), '15:30');
  assert.equal(normalizeReminderTime(''), '04:00');
  assert.throws(
    () => normalizeReminderTime('25:00'),
    (err) => err instanceof EventOrderError && /Reminder time/.test(err.message),
  );
  const afternoon = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    now: new Date('2026-12-01T00:00:00.000Z'),
    settings: { days: 3, time: '15:30' },
  });
  assert.equal(afternoon.status, 'scheduled');
  assert.equal(afternoon.scheduledAt.toISOString(), '2026-12-22T10:00:00.000Z');
});

test('reminder rolls into the previous month', () => {
  const instant = reminderInstant('2027-01-01', settings);
  assert.equal(instant.toISOString(), '2026-12-29T04:30:00.000Z');
});

test('next 7 days is an inclusive 7-day calendar window', () => {
  assert.equal(addCalendarDays('2026-11-21', 6), '2026-11-27');
  assert.equal(addCalendarDays('2026-12-28', 6), '2027-01-03');
});

test('IST calendar date follows Asia/Kolkata, including midnight', () => {
  assert.equal(istCalendarDate(new Date('2026-12-21T18:30:00.000Z')), '2026-12-22');
  assert.equal(istCalendarDate(new Date('2026-12-21T18:29:00.000Z')), '2026-12-21');
});

test('confirmed order is reminded on each of the last 3 days', () => {
  const future = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    now: new Date('2026-12-01T00:00:00.000Z'),
    settings,
  });
  assert.equal(future.status, 'scheduled');
  assert.equal(future.scheduledAt.toISOString(), '2026-12-22T04:30:00.000Z');

  const sameDayAfterTen = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    now: new Date('2026-12-22T12:00:00.000Z'),
    settings,
  });
  assert.equal(sameDayAfterTen.status, 'scheduled');
  assert.equal(sameDayAfterTen.scheduledAt.toISOString(), '2026-12-22T04:30:00.000Z');

  const secondDay = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    previous: { ...sameDayAfterTen, sentDates: ['2026-12-22'], sentAt: sameDayAfterTen.scheduledAt },
    now: new Date('2026-12-22T12:00:00.000Z'),
    settings,
  });
  assert.equal(secondDay.status, 'scheduled');
  assert.equal(secondDay.scheduledAt.toISOString(), '2026-12-23T04:30:00.000Z');

  const missedFirstDay = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    now: new Date('2026-12-23T04:30:00.000Z'),
    settings,
  });
  assert.equal(missedFirstDay.status, 'scheduled');
  assert.equal(missedFirstDay.scheduledAt.toISOString(), '2026-12-23T04:30:00.000Z');

  const finished = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    previous: { sentDates: ['2026-12-22', '2026-12-23', '2026-12-24'], status: 'sent' },
    now: new Date('2026-12-24T12:00:00.000Z'),
    settings,
  });
  assert.equal(finished.status, 'sent');
});

test('cancelled and enquiry orders are not scheduled, and a sent reminder is kept', () => {
  const cancelled = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Cancelled',
    now: new Date('2026-12-01T00:00:00.000Z'),
    settings,
  });
  assert.equal(cancelled.status, 'cancelled');

  const enquiry = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Enquiry',
    now: new Date('2026-12-01T00:00:00.000Z'),
    settings,
  });
  assert.equal(enquiry.status, 'not_applicable');

  const sentAt = new Date('2026-12-22T04:30:00.000Z');
  const kept = computeReminder({
    eventDate: '2026-12-28',
    orderStatus: 'Cancelled',
    previous: {
      status: 'sent',
      scheduledAt: sentAt,
      recipient: '9876543210',
      sentAt,
      providerMessageId: 'msg-1',
      sentDates: ['2026-12-25', '2026-12-26', '2026-12-27'],
      history: [{ status: 'sent' }],
    },
    now: new Date('2026-12-24T00:00:00.000Z'),
    settings,
  });
  assert.equal(kept.status, 'cancelled');
  assert.equal(kept.providerMessageId, 'msg-1');
});

test('changing the event date recalculates a reminder that has not been sent', () => {
  const first = computeReminder({
    eventDate: '2026-12-25',
    orderStatus: 'Confirmed',
    now: new Date('2026-12-01T00:00:00.000Z'),
    settings,
  });
  const moved = computeReminder({
    eventDate: '2026-12-30',
    orderStatus: 'Preparing',
    previous: first,
    now: new Date('2026-12-01T00:00:00.000Z'),
    settings,
  });
  assert.equal(moved.status, 'scheduled');
  assert.equal(moved.scheduledAt.toISOString(), '2026-12-27T04:30:00.000Z');
});

test('pricing uses server amounts, not a client total', () => {
  const items = normalizeItems([
    { name: 'Kaju katli', category: 'Sweets', quantity: 2, unit: 'Kg', rate: 800, productId: 'P1', date: '2026-12-01', timeSlot: 'Morning' },
    { name: 'Extra plates', category: 'Other', quantity: 10, unit: 'Plates', rate: 20, date: '2026-12-01', timeSlot: 'Evening' },
  ]);
  assert.equal(items[0].amount, 1600);
  assert.equal(items[1].custom, true);
  const pricing = computePricing({
    items,
    discount: 100,
    additionalCharges: 50,
    payments: [{ amount: 500 }],
  });
  assert.equal(pricing.subtotal, 1800);
  assert.equal(pricing.totalAmount, 1750);
  assert.equal(pricing.advanceAmount, 500);
  assert.equal(pricing.balanceAmount, 1250);
  assert.equal(roundMoney(10.1 * 2), 20.2);
});

test('referred by is required and each item needs a time of day', () => {
  assert.throws(
    () => normalizeCustomer({ name: 'Asha', phone: '9876543210' }),
    (err) => err instanceof EventOrderError && /Referred by/.test(err.message),
  );
  assert.equal(
    normalizeCustomer({ name: 'Asha', phone: '9876543210', referredBy: 'Ramesh' }).referredBy,
    'Ramesh',
  );
  assert.equal(
    normalizeCustomer({ name: 'Asha', phone: '9876543210', referredBy: 'Ramesh', language: 'hi' }).language,
    'hi',
  );
  assert.equal(
    normalizeCustomer({ name: 'Asha', phone: '9876543210', referredBy: 'Ramesh' }).language,
    'en',
  );
  const items = normalizeItems([
    { name: 'Ladoo', quantity: 1, unit: 'Kg', rate: 10, date: '2026-12-01', timeSlot: 'Morning' },
  ], { now: new Date('2026-11-01T00:00:00.000Z') });
  assert.equal(items[0].timeSlot, 'Morning');
  assert.throws(
    () => normalizeItems([
      { name: 'Ladoo', quantity: 1, unit: 'Kg', rate: 10, date: '2026-12-01', timeSlot: 'Night' },
    ], { now: new Date('2026-11-01T00:00:00.000Z') }),
    (err) => err instanceof EventOrderError && /Morning/.test(err.message),
  );
});

test('an item does not need a category', () => {
  const items = normalizeItems([
    { name: 'Extra plates', quantity: 1, unit: 'Pieces', rate: 10, date: '2026-12-01', timeSlot: 'Afternoon' },
  ]);
  assert.equal(items[0].category, '');
  assert.equal(items[0].amount, 10);
  const productUnit = normalizeItems([
    { name: 'Besan barfi', quantity: 1, unit: 'Pkt', rate: 520, date: '2026-12-01', timeSlot: 'Morning' },
  ]);
  assert.equal(productUnit[0].unit, 'Pkt');
});

test('a percentage discount is calculated from the item subtotal', () => {
  assert.equal(resolveDiscount(540, 10, 'percent'), 54);
  const pricing = computePricing({
    items: [{ amount: 1000 }],
    discount: 10,
    discountType: 'percent',
    additionalCharges: 0,
    payments: [],
  });
  assert.equal(pricing.discount, 100);
  assert.equal(pricing.totalAmount, 900);
  assert.throws(
    () => resolveDiscount(1000, 101, 'percent'),
    (err) => err instanceof EventOrderError && /100%/.test(err.message),
  );
});

test('discount above the subtotal is rejected', () => {
  assert.throws(
    () => computePricing({
      items: [{ amount: 100 }],
      discount: 101,
      additionalCharges: 0,
      payments: [],
    }),
    (err) => err instanceof EventOrderError && err.status === 400,
  );
});

test('phone numbers accept a leading 91 and reject short numbers', () => {
  assert.equal(normalizePhone('+91 98765 43210', true, 'Mobile number'), '9876543210');
  assert.equal(normalizePhone('', false, 'Alternate number'), '');
  assert.throws(
    () => normalizeCustomer({ name: 'Asha', phone: '12345' }),
    (err) => err instanceof EventOrderError,
  );
});

test('an edit lists the fields and items that changed', () => {
  const before = {
    customer: { name: 'Test', phone: '9654454444', alternatePhone: '', address: '' },
    items: [{ productId: 'P1', name: 'Chena Toast', quantity: 1, unit: 'KGS', rate: 540 }],
    discount: 0,
    additionalCharges: 0,
    notes: '',
    paymentNotes: '',
  };
  assert.deepEqual(describeOrderChanges(before, before), []);
  const lines = describeOrderChanges(before, {
    ...before,
    customer: { ...before.customer, name: 'Ravi' },
    items: [
      { productId: 'P1', name: 'Chena Toast', quantity: 2, unit: 'KGS', rate: 540 },
      { productId: 'P2', name: 'Besan Barfi', quantity: 1, unit: 'Kg', rate: 520 },
    ],
    discount: 50,
  });
  assert.deepEqual(lines, [
    'Customer: Test → Ravi.',
    'Chena Toast: 1 KGS at ₹540.00 → 2 KGS at ₹540.00.',
    'Added Besan Barfi, 1 Kg at ₹520.00.',
    'Discount: ₹0.00 → ₹50.00.',
  ]);
});

test('advance creates one payment and a zero advance creates none', () => {
  assert.deepEqual(initialPayments({ advanceAmount: 0, actor, now: new Date() }), []);
  const [payment] = initialPayments({
    advanceAmount: 250,
    mode: 'UPI',
    notes: 'Token',
    actor,
    now: new Date('2026-12-01T05:00:00.000Z'),
  });
  assert.equal(payment.amount, 250);
  assert.equal(payment.mode, 'UPI');
  assert.equal(payment.recordedBy.name, 'Admin');
  assert.throws(
    () => buildPayment({ amount: 0, mode: 'Cash', actor }),
    (err) => err instanceof EventOrderError,
  );
});
