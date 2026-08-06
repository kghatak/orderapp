const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Digits-only phone pattern; optional non-digits between digits (+91, spaces, dashes). */
const phoneDigitsRegex = (digits) =>
  digits.split('').map((d) => escapeRegex(d)).join('\\D*');

/**
 * Phone filter: 10+ digits → exact last-10 match; 3–9 digits → partial contains.
 * @returns {object | null} Mongo filter clause
 */
export const buildCustomerPhoneFilter = (raw) => {
  const q = raw !== undefined && raw !== null ? String(raw).trim() : '';
  if (!q) return null;

  const phoneDigits = q.replace(/\D/g, '');
  if (phoneDigits.length >= 10) {
    const tail = phoneDigits.slice(-10);
    const exactPattern = phoneDigitsRegex(tail);
    return {
      $or: [
        { 'customer.phone': tail },
        { 'customer.phone': { $regex: `${exactPattern}\\D*$` } }
      ]
    };
  }
  if (phoneDigits.length >= 3) {
    return { 'customer.phone': { $regex: escapeRegex(phoneDigits) } };
  }
  return null;
};

/**
 * Unified search across saleId, customer.name, and customer.phone.
 * @returns {{ $or: object[] } | null}
 */
export const buildSalesSearchOr = (searchRaw) => {
  const q = searchRaw !== undefined && searchRaw !== null ? String(searchRaw).trim() : '';
  if (!q) return null;

  const or = [];
  const phoneDigits = q.replace(/\D/g, '');
  const looksLikeFullPhone =
    phoneDigits.length >= 10 && q.replace(/[\d\s+\-().]/g, '').length === 0;

  const saleIdPart = q.replace(/^#/, '').trim();
  if (saleIdPart && !looksLikeFullPhone) {
    or.push({ saleId: { $regex: escapeRegex(saleIdPart), $options: 'i' } });
  }

  const phoneClause = buildCustomerPhoneFilter(q);
  if (phoneClause) {
    if (phoneClause.$or) {
      or.push(...phoneClause.$or);
    } else {
      or.push(phoneClause);
    }
  }

  if (!looksLikeFullPhone) {
    or.push({ 'customer.name': { $regex: escapeRegex(q), $options: 'i' } });
  }

  return or.length > 0 ? { $or: or } : null;
};

/**
 * Build MongoDB filter for GET /sales list.
 *
 * Query params:
 *   search         — saleId (# ok), customer.name, or customer.phone (OR)
 *   saleId         — explicit sale id partial match
 *   customerName   — explicit customer name partial match
 *   customerPhone  — explicit phone (exact last 10 digits when 10+ digits entered)
 *   paymentMode    — Cash | Card | UPI | Due | Split
 */
export const buildSalesListFilter = ({
  tenantId,
  outletId,
  paymentMode,
  search,
  saleId,
  customerName,
  customerPhone
}) => {
  const filter = { tenantId, outletId };
  const pm = paymentMode !== undefined && paymentMode !== null ? String(paymentMode).trim() : '';
  if (pm) filter.paymentMode = pm;

  const and = [];

  const unified = buildSalesSearchOr(search);
  if (unified) and.push(unified);

  const saleIdTrim = saleId !== undefined && saleId !== null ? String(saleId).replace(/^#/, '').trim() : '';
  if (saleIdTrim) {
    and.push({ saleId: { $regex: escapeRegex(saleIdTrim), $options: 'i' } });
  }

  const nameTrim =
    customerName !== undefined && customerName !== null ? String(customerName).trim() : '';
  if (nameTrim) {
    and.push({ 'customer.name': { $regex: escapeRegex(nameTrim), $options: 'i' } });
  }

  const phoneClause = buildCustomerPhoneFilter(customerPhone);
  if (phoneClause) and.push(phoneClause);

  if (and.length === 1) {
    Object.assign(filter, and[0]);
  } else if (and.length > 1) {
    filter.$and = and;
  }

  return filter;
};
