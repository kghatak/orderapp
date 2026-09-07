/** Outlets that must not appear on Tally XLSX exports (test / internal). */
export const TALLY_EXCLUDED_OUTLET_IDS = new Set(['OUTID113']);

export const isTallyExcludedOutlet = (outletId) =>
  TALLY_EXCLUDED_OUTLET_IDS.has(String(outletId ?? '').trim());
