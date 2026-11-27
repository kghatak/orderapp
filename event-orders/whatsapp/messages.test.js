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
  event: {
    type: 'Birthday',
    name: '',
    date: '2026-11-26',
    time: '15:15',
    venue: '',
    deliveryType: 'Delivery',
  },
  items: [{ name: 'Chena Toast', quantity: 1, unit: 'KGS', amount: 540 }],
  pricing: { totalAmount: 540, advanceAmount: 0, balanceAmount: 540 },
};

test('customer buttons map to confirm, cancel, and edit', () => {
  assert.equal(customerReplyAction('Confirm'), 'confirm');
  assert.equal(customerReplyAction(' cancel '), 'cancel');
  assert.equal(customerReplyAction('Edit'), 'edit');
  assert.equal(customerReplyAction('hello'), '');
  assert.equal(statusForCustomerReply('confirm'), 'Confirmed');
  assert.equal(statusForCustomerReply('cancel'), 'Cancelled');
  assert.equal(statusForCustomerReply('edit'), 'Enquiry');
});

test('the new-order message carries the order details', () => {
  const message = customerOrderMessage(order);
  assert.equal(message.template, 'event_order_created_v2');
  assert.equal(message.phone, '9654454444');
  assert.equal(message.params.order_id, 'EO-00001');
  assert.match(message.params.event_details, /Birthday/);
  assert.match(message.params.event_details, /3:15 PM/);
  assert.match(message.params.items, /Chena Toast/);
  assert.match(message.params.place, /Venue: —/);
  assert.match(message.params.payment, /Balance/);
});

test('the staff reminder names the customer and the event date', () => {
  const message = staffReminderMessage(order);
  assert.equal(message.template, 'event_order_staff_reminder_v2');
  assert.equal(message.params.phone, '9654454444');
  assert.match(message.params.event_details, /26 Nov, 2026/);
  assert.match(message.params.place, /Delivery type: Delivery/);
});
