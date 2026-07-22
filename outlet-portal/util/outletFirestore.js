import { getFirestoreDB } from '../../util/firebase.js';

const DEFAULT_OUTLET_ADDRESS = 'Village Buchi, Pundri, Kaithal';
const DEFAULT_STORE_NAME = 'NANNU MILK';

/**
 * Load outlet print header fields from Firestore for bill rendering / WhatsApp.
 * @param {string} outletId
 * @returns {Promise<{ name: string, address: string, gstNo: string }>}
 */
export async function fetchOutletPrintInfo(outletId) {
  const fallback = {
    name: DEFAULT_STORE_NAME,
    address: DEFAULT_OUTLET_ADDRESS,
    gstNo: ''
  };
  if (!outletId) return fallback;

  try {
    const db = getFirestoreDB();
    const doc = await db.collection('outlets').doc(String(outletId)).get();
    if (!doc.exists) return fallback;
    const data = doc.data() || {};
    const name = String(data.name || data.outletName || DEFAULT_STORE_NAME).trim() || DEFAULT_STORE_NAME;
    const address = String(data.address || DEFAULT_OUTLET_ADDRESS).trim() || DEFAULT_OUTLET_ADDRESS;
    const gstNo = String(
      data.gstNo || data.gstNumber || data.gst || data.gstin || ''
    ).trim();
    return { name, address, gstNo };
  } catch (err) {
    console.warn('fetchOutletPrintInfo failed:', err?.message || err);
    return fallback;
  }
}
