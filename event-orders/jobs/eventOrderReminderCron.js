import cron from 'node-cron';
import { isEventOrderMongoConnected } from '../config/eventOrderDb.js';
import { computeReminder, istCalendarDate, orderReminderDate, reminderSettingsFor } from '../eventOrderMath.js';
import { getEventOrderModel } from '../models/EventOrder.js';
import { eventOrderStaffPhones } from '../whatsapp/messages.js';
import { sendStaffEventReminder } from '../whatsapp/sendEventOrderWhatsApp.js';

let cronTask = null;

export async function runEventOrderStaffReminders(now = new Date()) {
  if (!isEventOrderMongoConnected()) return { sent: 0, failed: 0 };
  const orders = await getEventOrderModel()
    .find({
      status: { $in: ['Confirmed', 'Preparing', 'Ready'] },
      $or: [
        { 'whatsappReminder.status': 'scheduled', 'whatsappReminder.scheduledAt': { $lte: now } },
        { 'whatsappReminder.status': 'sent', 'whatsappReminder.sentDates.2': { $exists: false } },
      ],
    })
    .limit(50);

  let sent = 0;
  let failed = 0;
  for (const order of orders) {
    const at = new Date();
    const today = istCalendarDate(at);
    const eventDate = orderReminderDate(order);
    const previous = typeof order.whatsappReminder?.toObject === 'function'
      ? order.whatsappReminder.toObject()
      : { ...(order.whatsappReminder || {}) };
    const dueDay = previous.scheduledAt ? istCalendarDate(new Date(previous.scheduledAt)) : '';
    const dueNow = previous.status === 'scheduled' && previous.scheduledAt && new Date(previous.scheduledAt) <= at && dueDay === today;
    if (!dueNow) {
      order.whatsappReminder = computeReminder({
        eventDate,
        orderStatus: order.status,
        previous,
        now: at,
        settings: reminderSettingsFor(order.reminderTime),
      });
      if (order.whatsappReminder.status !== 'sent') {
        order.whatsappReminder.recipient = eventOrderStaffPhones().join(', ');
      }
      order.markModified('whatsappReminder');
      await order.save();
      continue;
    }

    const result = await sendStaffEventReminder(order);
    const history = Array.isArray(previous.history) ? previous.history : [];
    if (result.ok) {
      const sentDates = [...new Set([...(previous.sentDates || []), today])];
      const next = computeReminder({
        eventDate,
        orderStatus: order.status,
        previous: { ...previous, status: 'scheduled', sentDates, sentAt: at, history },
        now: at,
        settings: reminderSettingsFor(order.reminderTime),
      });
      order.whatsappReminder = {
        ...next,
        sentAt: at,
        recipient: result.recipients || eventOrderStaffPhones().join(', '),
        errorMessage: '',
        history: [...history, {
          status: 'sent',
          recipient: result.recipients || eventOrderStaffPhones().join(', '),
          sentAt: at,
        }],
      };
      order.audit.push({
        action: 'whatsapp',
        at,
        userId: 'whatsapp',
        name: 'Reminder',
        detail: `Staff were reminded. This daily reminder is one of the last 3 days before the event.`,
      });
      sent += 1;
    } else {
      const attemptedDates = [...new Set([...(previous.attemptedDates || []), today])];
      const errorMessage = result.error || 'Staff reminder was not sent.';
      const next = computeReminder({
        eventDate,
        orderStatus: order.status,
        previous: { ...previous, status: 'scheduled', attemptedDates, history },
        now: at,
        settings: reminderSettingsFor(order.reminderTime),
      });
      order.whatsappReminder = {
        ...next,
        errorMessage,
        history,
      };
      if (next.status !== 'scheduled') order.whatsappReminder.status = 'failed';
      order.audit.push({
        action: 'whatsapp',
        at,
        userId: 'whatsapp',
        name: 'Reminder',
        detail: `Staff reminder failed. ${errorMessage}`,
      });
      failed += 1;
    }
    order.markModified('whatsappReminder');
    if (order.audit.length > 100) order.audit.splice(0, order.audit.length - 100);
    await order.save();
  }
  return { sent, failed };
}

export function startEventOrderReminderCron() {
  if (process.env.EVENT_ORDER_REMINDER_CRON_ENABLED === 'false') {
    console.log('Event order reminder cron disabled');
    return;
  }
  const schedule = process.env.EVENT_ORDER_REMINDER_CRON || '*/15 * * * *';
  cronTask = cron.schedule(
    schedule,
    async () => {
      try {
        const result = await runEventOrderStaffReminders();
        if (result.sent || result.failed) {
          console.log(`Event order staff reminders: ${result.sent} sent, ${result.failed} failed`);
        }
      } catch (err) {
        console.error('Event order reminder cron failed:', err);
      }
    },
    { timezone: 'Asia/Kolkata' },
  );
  console.log(`Event order staff reminder cron scheduled (${schedule}, Asia/Kolkata)`);
  runEventOrderStaffReminders().catch((err) => {
    console.error('Event order reminder startup check failed:', err);
  });
}
