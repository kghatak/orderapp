import cron from 'node-cron';
import { isEventOrderMongoConnected } from '../config/eventOrderDb.js';
import { getEventOrderModel } from '../models/EventOrder.js';
import { eventOrderStaffPhones } from '../whatsapp/messages.js';
import { sendStaffEventReminder } from '../whatsapp/sendEventOrderWhatsApp.js';

let cronTask = null;

export async function runEventOrderStaffReminders(now = new Date()) {
  if (!isEventOrderMongoConnected()) return { sent: 0, failed: 0 };
  const orders = await getEventOrderModel()
    .find({
      status: { $in: ['Confirmed', 'Preparing', 'Ready'] },
      'whatsappReminder.status': 'scheduled',
      'whatsappReminder.scheduledAt': { $lte: now },
    })
    .limit(50);

  let sent = 0;
  let failed = 0;
  for (const order of orders) {
    const result = await sendStaffEventReminder(order);
    const at = new Date();
    if (result.ok) {
      order.whatsappReminder.status = 'sent';
      order.whatsappReminder.sentAt = at;
      order.whatsappReminder.recipient = result.recipients || eventOrderStaffPhones().join(', ');
      order.whatsappReminder.errorMessage = '';
      order.whatsappReminder.history.push({
        status: 'sent',
        recipient: order.whatsappReminder.recipient,
        sentAt: at,
      });
      order.audit.push({
        action: 'whatsapp',
        at,
        userId: 'whatsapp',
        name: 'Reminder',
        detail: 'Staff were reminded that this confirmed event is in 3 days.',
      });
      sent += 1;
    } else {
      order.whatsappReminder.status = 'failed';
      order.whatsappReminder.errorMessage = result.error || 'Staff reminder was not sent.';
      order.audit.push({
        action: 'whatsapp',
        at,
        userId: 'whatsapp',
        name: 'Reminder',
        detail: `Staff reminder failed. ${order.whatsappReminder.errorMessage}`,
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
