/**
 * Human-readable IDs per outlet (not global serial).
 * Format: {outletId}-SALE-{timestamp} / {outletId}-EXP-{timestamp} (Date.now() ms)
 */

function cleanOutletSegment(outletId) {
  const s = String(outletId || 'OUTLET').trim();
  return s.replace(/[^a-zA-Z0-9_-]/g, '') || 'OUTLET';
}

export function generateSaleId(outletId) {
  const o = cleanOutletSegment(outletId);
  return `${o}-SALE-${Date.now()}`;
}

export function generateExpenseId(outletId) {
  const o = cleanOutletSegment(outletId);
  return `${o}-EXP-${Date.now()}`;
}
