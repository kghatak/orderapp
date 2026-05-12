/**
 * Expenses: {outletId}-EXP-{timestamp} (Date.now() ms)
 * Sales: numeric string saleId from `sequencecounters` — 1001, 1002, … per tenant+outlet.
 */

import { getSaleModel } from '../models/Sale.js';
import { getSequenceCounterModel } from '../models/SequenceCounter.js';

function cleanOutletSegment(outletId) {
  const s = String(outletId || 'OUTLET').trim();
  return s.replace(/[^a-zA-Z0-9_-]/g, '') || 'OUTLET';
}

/** First issued sale id is this + 1 (i.e. 1001). */
const SALE_SEQUENCE_MIN = 1000;

/**
 * Max purely-numeric saleId for this outlet (ignores legacy prefixed ids).
 */
async function computeNumericSaleMax(tenantId, outletId) {
  const Sale = getSaleModel();
  const rows = await Sale.find({ tenantId, outletId }, { saleId: 1 }).lean();
  let max = 0;
  for (const row of rows) {
    const sid = row.saleId;
    if (sid == null || typeof sid !== 'string') continue;
    const t = sid.trim();
    if (!/^\d+$/.test(t)) continue;
    const n = parseInt(t, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function saleCounterKey(tenantId, outletId) {
  const t = String(tenantId ?? '').trim();
  const o = cleanOutletSegment(outletId);
  return `sale:${t}:${o}`;
}

/**
 * Next sale id: "1001", "1002", … per tenant + outlet (Mongo `sequencecounters`).
 */
export async function generateNextSaleId(tenantId, outletId) {
  const key = saleCounterKey(tenantId, outletId);
  const t = String(tenantId ?? '').trim();

  const Counter = getSequenceCounterModel();
  const existing = await Counter.findById(key).lean();
  if (!existing) {
    const maxSale = await computeNumericSaleMax(t, outletId);
    const initialSeq = Math.max(maxSale, SALE_SEQUENCE_MIN);
    await Counter.updateOne({ _id: key }, { $setOnInsert: { seq: initialSeq } }, { upsert: true });
  }

  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true });
  if (!doc || !Number.isFinite(doc.seq)) {
    throw new Error('Sale sequence counter did not return a sequence');
  }
  return String(doc.seq);
}

export function generateExpenseId(outletId) {
  const o = cleanOutletSegment(outletId);
  return `${o}-EXP-${Date.now()}`;
}
