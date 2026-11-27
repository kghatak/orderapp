import { sendWhatsAppTemplate, sendWhatsAppTemplateBulk } from '../../util/whatsapp.js';
import {
  customerOrderMessage,
  eventOrderStaffPhones,
  staffMessageForReply,
  staffReminderMessage,
} from './messages.js';

async function deliver(phones, template, params) {
  try {
    const result = phones.length === 1
      ? await sendWhatsAppTemplate(phones[0], template, params)
      : await sendWhatsAppTemplateBulk(phones, template, params);
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'WhatsApp was not sent.' };
    }
    return { ok: true, error: '' };
  } catch (err) {
    return { ok: false, error: err?.message || 'WhatsApp was not sent.' };
  }
}

export async function sendCustomerOrderCreated(order) {
  const message = customerOrderMessage(order);
  if (!message.phone) {
    return { status: 'failed', sentAt: null, errorMessage: 'The order has no customer mobile number.' };
  }
  const result = await deliver([message.phone], message.template, message.params);
  return {
    status: result.ok ? 'sent' : 'failed',
    sentAt: result.ok ? new Date() : null,
    errorMessage: result.error || '',
    reply: '',
    repliedAt: null,
    replyMessageId: '',
  };
}

export async function sendStaffForCustomerReply(action, order) {
  const message = staffMessageForReply(action, order);
  if (!message) return { ok: false, error: 'Unknown customer reply.' };
  return deliver(eventOrderStaffPhones(), message.template, message.params);
}

export async function sendStaffEventReminder(order) {
  const message = staffReminderMessage(order);
  const phones = eventOrderStaffPhones();
  const result = await deliver(phones, message.template, message.params);
  return { ...result, recipients: phones.join(', ') };
}
