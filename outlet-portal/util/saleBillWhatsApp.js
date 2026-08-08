import { sendWhatsAppTemplate } from '../../util/whatsapp.js';

const DEFAULT_TEMPLATE = 'pos_bill_receipt';

/**
 * Public base URL for bill links (no trailing slash).
 * Set PUBLIC_BILL_BASE_URL in production, e.g. https://your-api.azurewebsites.net
 */
export function getPublicBillBaseUrl() {
  const base = (
    process.env.PUBLIC_BILL_BASE_URL ||
    process.env.APP_PUBLIC_URL ||
    ''
  ).replace(/\/$/, '');
  return base || null;
}

export function buildPublicBillUrl(billToken) {
  const base = getPublicBillBaseUrl();
  if (!base || !billToken) return null;
  return `${base}/bill/${billToken}`;
}

export function buildPublicBillPdfUrl(billToken) {
  const viewUrl = buildPublicBillUrl(billToken);
  if (!viewUrl) return null;
  return `${viewUrl}/pdf`;
}

/**
 * Send WhatsApp message with bill view link after a POS sale.
 * Fire-and-forget — logs errors but does not throw.
 *
 * @param {{ phone: string, customerName?: string, saleId: string, total: number, billToken: string }} params
 * @returns {Promise<boolean>} true if send was attempted with a valid URL
 */
export async function sendSaleBillWhatsApp({ phone, customerName, saleId, total, billToken }) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) return false;

  const billUrl = buildPublicBillUrl(billToken);
  if (!billUrl) {
    console.warn(
      'WhatsApp bill: PUBLIC_BILL_BASE_URL not set — skipping bill link message'
    );
    return false;
  }

  const templateName = process.env.MSG91_POS_BILL_TEMPLATE || DEFAULT_TEMPLATE;
  const name = (customerName || 'Customer').trim() || 'Customer';
  const amount = `₹${Number(total).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  try {
    await sendWhatsAppTemplate(phone, templateName, [
      name,
      String(saleId),
      amount,
      billUrl
    ]);
    return true;
  } catch (err) {
    console.error('sendSaleBillWhatsApp failed:', err?.message || err);
    return false;
  }
}
