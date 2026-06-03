import axios from 'axios';

const MSG91_BULK_API_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
const MSG91_TEXT_API_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsappmessage';

const TEMPLATE_NAMESPACE = 'c71e92fc_33d8_4cfa_9deb_9c910d378e4d';

// Read at call-time so dotenv.config() in the entry file has already run
function getCredentials() {
  return {
    authKey: process.env.MSG91_AUTH_KEY,
    number: process.env.MSG91_WHATSAPP_NUMBER,
  };
}

/**
 * Normalize a phone number to MSG91 format: 12-digit with country code, no + or spaces.
 * Assumes India (+91) if only 10 digits are given.
 */
function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

/**
 * Build the components object expected by the MSG91 bulk API.
 * bodyParams[0] → body_1, bodyParams[1] → body_2, etc.
 *
 * @param {string[]} bodyParams
 * @returns {Record<string, { type: string, value: string }>}
 */
function buildComponents(bodyParams) {
  const components = {};
  bodyParams.forEach((value, i) => {
    components[`body_${i + 1}`] = { type: 'text', value: String(value) };
  });
  return components;
}

/**
 * Send a plain text WhatsApp message via MSG91.
 * Only works within the 24-hour session window (after the user has messaged you first).
 * For outbound business-initiated messages use sendWhatsAppTemplate instead.
 */
export async function sendWhatsAppText(toPhone, body) {
  const { authKey, number } = getCredentials();
  if (!authKey || !number) {
    console.warn('WhatsApp: MSG91_AUTH_KEY or MSG91_WHATSAPP_NUMBER not configured, skipping');
    return;
  }

  const to = normalizePhone(toPhone);

  try {
    const response = await axios.post(
      MSG91_TEXT_API_URL,
      {
        integrated_number: number,
        content_type: 'text',
        payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body },
        },
      },
      {
        headers: {
          authkey: authKey,
          'content-type': 'application/json',
        },
      }
    );
    console.log(`WhatsApp text sent to ${to}:`, response.data);
  } catch (err) {
    console.error(`WhatsApp text failed for ${to}:`, err.response?.data || err.message);
  }
}

/**
 * Send a pre-approved WhatsApp template message to a single recipient via MSG91 bulk API.
 *
 * @param {string} toPhone - Recipient phone number
 * @param {string} templateName - Approved template name in MSG91 dashboard
 * @param {string[]} bodyParams - Values for body_1, body_2, ... variables in the template
 * @param {string} [languageCode='en'] - Template language code
 */
export async function sendWhatsAppTemplate(toPhone, templateName, bodyParams = [], languageCode = 'en') {
  return sendWhatsAppTemplateBulk([toPhone], templateName, bodyParams, languageCode);
}

/**
 * Send a pre-approved WhatsApp template message to multiple recipients in a single API call.
 * Required for all business-initiated (outbound) messages outside the 24h session window.
 *
 * @param {string[]} toPhones - List of recipient phone numbers
 * @param {string} templateName - Approved template name in MSG91 dashboard
 * @param {string[]} bodyParams - Values for body_1, body_2, ... variables in the template
 * @param {string} [languageCode='en'] - Template language code
 */
export async function sendWhatsAppTemplateBulk(toPhones, templateName, bodyParams = [], languageCode = 'en') {
  const { authKey, number } = getCredentials();
  if (!authKey || !number) {
    console.warn('WhatsApp: MSG91_AUTH_KEY or MSG91_WHATSAPP_NUMBER not configured, skipping');
    return;
  }

  const normalizedNumbers = toPhones.map(normalizePhone);
  const components = buildComponents(bodyParams);

  try {
    const response = await axios.post(
      MSG91_BULK_API_URL,
      {
        integrated_number: number,
        content_type: 'template',
        payload: {
          messaging_product: 'whatsapp',
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode, policy: 'deterministic' },
            namespace: TEMPLATE_NAMESPACE,
            to_and_components: [
              {
                to: normalizedNumbers,
                components,
              },
            ],
          },
        },
      },
      {
        headers: {
          authkey: authKey,
          'content-type': 'application/json',
        },
      }
    );
    console.log(`WhatsApp template "${templateName}" sent to ${normalizedNumbers.length} recipient(s):`, response.data);
  } catch (err) {
    console.error(`WhatsApp template "${templateName}" bulk send failed:`, err.response?.data || err.message);
  }
}
