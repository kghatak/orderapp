import { isEventOrderMongoConnected } from '../config/eventOrderDb.js';
import { getEventOrderModel } from '../models/EventOrder.js';
import { computeReminder } from '../eventOrderMath.js';
import { customerReplyAction, eventOrderStaffPhones, statusForCustomerReply } from './messages.js';
import { sendStaffForCustomerReply } from './sendEventOrderWhatsApp.js';

function phoneLast10(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function pushAudit(order, detail) {
  order.audit.push({
    action: 'whatsapp',
    at: new Date(),
    userId: 'whatsapp',
    name: 'Customer',
    detail,
  });
  if (order.audit.length > 100) order.audit.splice(0, order.audit.length - 100);
}

function reminderAfterReply(order, status, now) {
  const reminder = computeReminder({
    eventDate: order.event?.date,
    orderStatus: status,
    previous: typeof order.whatsappReminder?.toObject === 'function'
      ? order.whatsappReminder.toObject()
      : order.whatsappReminder,
    now,
  });
  if (reminder.status !== 'sent') reminder.recipient = eventOrderStaffPhones().join(', ');
  return reminder;
}

export async function handleEventOrderCustomerReply({ phone, message, messageUuid }) {
  const action = customerReplyAction(message);
  if (!action) return { matched: false };
  if (!isEventOrderMongoConnected()) return { matched: false, reason: 'database' };

  const last10 = phoneLast10(phone);
  if (last10.length !== 10) return { matched: false, reason: 'phone' };

  const orders = await getEventOrderModel()
    .find({
      'customer.phone': { $regex: `${last10}$` },
      status: { $ne: 'Completed' },
    })
    .sort({ createdAt: -1 })
    .limit(5);
  const order = orders[0];
  if (!order) {
    console.warn(`Event order reply "${message}" did not match an open order.`);
    return { matched: false, reason: 'order' };
  }

  if (messageUuid && order.whatsappCustomer?.replyMessageId === messageUuid) {
    return { matched: true, duplicate: true, orderId: order.orderId };
  }

  const nextStatus = statusForCustomerReply(action);
  if (order.status === nextStatus && order.whatsappCustomer?.reply === action) {
    return { matched: true, duplicate: true, orderId: order.orderId };
  }

  const now = new Date();
  const previousStatus = order.status;
  order.status = nextStatus;
  order.whatsappCustomer = {
    ...(typeof order.whatsappCustomer?.toObject === 'function'
      ? order.whatsappCustomer.toObject()
      : order.whatsappCustomer || {}),
    reply: action,
    repliedAt: now,
    replyMessageId: messageUuid || '',
  };
  order.markModified('whatsappCustomer');
  order.whatsappReminder = reminderAfterReply(order, nextStatus, now);
  order.markModified('whatsappReminder');
  order.updatedBy = { userId: 'whatsapp', name: 'Customer' };
  pushAudit(order, `Customer chose ${action}. Status changed from ${previousStatus} to ${nextStatus}.`);
  await order.save();

  const staff = await sendStaffForCustomerReply(action, order);
  if (!staff.ok) {
    console.error(`Event order ${order.orderId} staff ${action} WhatsApp was not sent: ${staff.error || 'unknown error'}`);
    pushAudit(order, `Staff WhatsApp was not sent. ${staff.error || ''}`.trim());
    await order.save();
  } else {
    console.log(`Event order ${order.orderId} staff ${action} WhatsApp sent.`);
  }
  return { matched: true, orderId: order.orderId, status: nextStatus, staffSent: staff.ok };
}
