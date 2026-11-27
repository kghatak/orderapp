import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerOrderMessage,
  customerReplyAction,
  staffReminderMessage,
  statusForCustomerReply,
} from './messages.js';

const order = {
  orderId: 'EO-00001',
  customer: { name: 'Test', phone: '9654454444', address: 'Pehowa' },
  items: [{ name: 'Chena Toast', quantity: 1, unit: 'KGS', amount: 540, date: '2026-11-26', timeSlot: 'Morning' }],
  pricing: { totalAmount: 540, advanceAmount: 0, balanceAmount: 540 },
};

test('customer buttons map to confirm, cancel, and edit', () => {
  assert.equal(customerReplyAction('Confirm'), 'confirm');
  assert.equal(customerReplyAction(' cancel '), 'cancel');
  assert.equal(customerReplyAction('Edit'), 'edit');
  assert.equal(customerReplyAction('पुष्टि करें'), 'confirm');
  assert.equal(customerReplyAction('रद्द करें'), 'cancel');
  assert.equal(customerReplyAction('बदलें'), 'edit');
  assert.equal(customerReplyAction('hello'), '');
  assert.equal(statusForCustomerReply('confirm'), 'Confirmed');
  assert.equal(statusForCustomerReply('cancel'), 'Cancelled');
  assert.equal(statusForCustomerReply('edit'), 'Enquiry');
});

test('the new-order message lists each item with its date', () => {
  const message = customerOrderMessage(order);
  assert.equal(message.template, 'event_order_created_v3');
  assert.equal(message.phone, '9654454444');
  assert.equal(message.params.order_id, 'EO-00001');
  assert.equal(message.params.event_details, undefined);
  assert.match(message.params.items, /Chena Toast on /);
  assert.match(message.params.items, /26 Nov, 2026/);
  assert.match(message.params.items, /Morning/);
  const twoItems = customerOrderMessage({
    ...order,
    items: [
      order.items[0],
      { name: 'Ladoo', quantity: 2, unit: 'Kg', amount: 200, date: '2026-11-27', timeSlot: 'Evening' },
    ],
  });
  const [firstLine, secondLine] = twoItems.params.items.split('\n');
  assert.match(firstLine, /Chena Toast on /);
  assert.match(secondLine, /Ladoo on /);
  assert.equal(message.params.place, 'Pehowa');
  assert.match(message.params.payment, /Balance/);
  assert.equal(message.language, 'en');

  const hindi = customerOrderMessage({
    ...order,
    customer: { ...order.customer, language: 'hi' },
  });
  assert.equal(hindi.language, 'hi');
  assert.equal(hindi.template, 'event_order_created_hi_v3');
  assert.match(hindi.params.items, /को /);
  assert.match(hindi.params.items, /सुबह/);
  assert.equal(hindi.params.place, 'Pehowa');
  assert.match(hindi.params.payment, /बाकी/);
});

test('the staff reminder names the customer and each item date', () => {
  const message = staffReminderMessage(order);
  assert.equal(message.template, 'event_order_staff_reminder_v3');
  assert.equal(message.params.phone, '9654454444');
  assert.equal(message.params.event_details, undefined);
  assert.match(message.params.items, /26 Nov, 2026/);
  assert.equal(message.params.place, 'Pehowa');
});
