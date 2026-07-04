// controllers/outletOpeningClosingBalanceController.js
import ExcelJS from 'exceljs';
import { getFirestoreDB } from '../../util/firebase.js';
import admin from 'firebase-admin';

const roundMoney2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const YMD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** Shared cap for GET range on daily-product-delivery / daily-product-return. */
const MAX_DELIVERY_QUERY_RANGE_DAYS = 93;
/** GET daily-product-* /xlsx: max inclusive calendar days when using from & to query params */
const MAX_XLSX_VOUCHER_RANGE_DAYS = 10;
/** Firestore batch write limit — stay under 500 when writing parent + many outlet subdocs */
const FIRESTORE_BATCH_SET_LIMIT = 450;

/** Split Firestore batch writes into chunks of FIRESTORE_BATCH_SET_LIMIT to stay under the 500-op limit. */
async function commitBatchedDocumentSets(db, writes) {
  if (!writes.length) return;
  for (let i = 0; i < writes.length; i += FIRESTORE_BATCH_SET_LIMIT) {
    const batch = db.batch();
    for (const { ref, data } of writes.slice(i, i + FIRESTORE_BATCH_SET_LIMIT)) {
      batch.set(ref, data);
    }
    await batch.commit();
  }
}

/** Express query value → trimmed string (first element if repeated). */
function firstQueryString(q) {
  if (q == null || q === '') return '';
  const s = Array.isArray(q) ? q[0] : q;
  return String(s ?? '').trim();
}

function parseIsoDateUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar day boundaries for a given instant (used by daily balance job). */
function getIstDayBoundaries(triggeredDate) {
  const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
  const targetYear = istDate.getUTCFullYear();
  const targetMonth = istDate.getUTCMonth();
  const targetDay = istDate.getUTCDate();
  const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);
  return {
    dateStr: `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
    dayStartTimestamp: admin.firestore.Timestamp.fromDate(startOfDayUTC),
    dayEndTimestamp: admin.firestore.Timestamp.fromDate(endOfDayUTC),
  };
}

/** IST calendar date key (YYYY-MM-DD) for a Firestore timestamp. */
function getIstDateKeyFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return getIstDayBoundaries(date).dateStr;
}

/** IST day boundaries for a calendar date string YYYY-MM-DD. */
function getIstBoundariesForCalendarDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return getIstDayBoundaries(noonUtc);
}

/** Add calendar days to a YYYY-MM-DD string. */
function addDaysToDateStr(dateStr, deltaDays) {
  const d = parseIsoDateUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Sum approved payments for one outlet and day.
 * Uses paymentDate (business date); falls back to createdAt only when paymentDate is absent.
 */
async function fetchApprovedPaymentsForDay(db, outletId, dayStartTimestamp, dayEndTimestamp) {
  const countedIds = new Set();
  const paymentsList = [];
  let total = 0;

  const addPayment = (doc) => {
    if (countedIds.has(doc.id)) return;
    countedIds.add(doc.id);
    const data = doc.data();
    const amount = parseFloat(data.amount || 0);
    total += amount;
    paymentsList.push({
      id: doc.id,
      outletId: data.outletId || outletId,
      amount,
      status: data.status,
    });
  };

  const byPaymentDate = await db
    .collection('payments')
    .where('outletId', '==', outletId)
    .where('status', '==', 'approved')
    .where('paymentDate', '>=', dayStartTimestamp)
    .where('paymentDate', '<=', dayEndTimestamp)
    .get();
  byPaymentDate.forEach(addPayment);

  const byCreatedAt = await db
    .collection('payments')
    .where('outletId', '==', outletId)
    .where('status', '==', 'approved')
    .where('createdAt', '>=', dayStartTimestamp)
    .where('createdAt', '<=', dayEndTimestamp)
    .get();
  byCreatedAt.forEach((doc) => {
    if (countedIds.has(doc.id)) return;
    if (doc.data().paymentDate != null) return;
    addPayment(doc);
  });

  return { total, paymentsList };
}

/** Inclusive list of YYYY-MM-DD strings from fromStr through toStr (UTC calendar days). */
function enumerateDateRangeInclusive(fromStr, toStr) {
  const start = parseIsoDateUtc(fromStr);
  const end = parseIsoDateUtc(toStr);
  const dates = [];
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    dates.push(
      `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * @param {object} data - Firestore document data
 * @returns {{ data: object, pagination: object }}
 */
function paginateDailyDeliveryDoc(data, pageNum, limitNum) {
  const allProducts = data.products || [];
  const totalProducts = allProducts.length;
  const totalPages = Math.ceil(totalProducts / limitNum) || 1;
  const offset = (pageNum - 1) * limitNum;
  const paginatedProducts = allProducts.slice(offset, offset + limitNum);
  return {
    data: {
      date: data.date,
      deliveredDate: data.deliveredDate,
      totalOrders: data.totalOrders,
      totalProducts,
      totalDiscountPercentage: data.totalDiscountPercentage,
      totalDiscount: data.totalDiscount,
      totalAmount: data.totalAmount,
      products: paginatedProducts,
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
      status: data.status,
    },
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalProducts,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
  };
}

/**
 * Pagination for DailyProductReturn (same shape as GET single-day response).
 */
function paginateDailyReturnDoc(data, pageNum, limitNum) {
  const allProducts = data.products || [];
  const totalProducts = allProducts.length;
  const totalPages = Math.ceil(totalProducts / limitNum) || 1;
  const offset = (pageNum - 1) * limitNum;
  const paginatedProducts = allProducts.slice(offset, offset + limitNum);
  return {
    data: {
      date: data.date,
      returnDate: data.returnDate,
      totalReturns: data.totalReturns,
      totalProducts,
      totalDiscountPercentage: data.totalDiscountPercentage,
      totalDiscount: data.totalDiscount,
      totalAmount: data.totalAmount,
      products: paginatedProducts,
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
      status: data.status,
    },
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalProducts,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
  };
}

/**
 * Merge `products` arrays across daily snapshots by productId (delivery & return docs share line shape).
 * @param {string} countField — `totalOrders` (delivery) or `totalReturns` (returns)
 */
function mergeDailyProductDocuments(dayDocsData, countField) {
  const map = new Map();
  for (const doc of dayDocsData) {
    const products = doc.products || [];
    for (const p of products) {
      const productId =
        p.productId != null && String(p.productId).trim() !== '' ? String(p.productId).trim() : 'unknown';
      const q = Number(p.totalQuantity);
      const qty = Number.isFinite(q) ? q : 0;
      const amt = Number(p.totalAmount);
      const safeAmt = Number.isFinite(amt) ? amt : 0;
      const disc = Number(p.totalDiscount);
      const safeDisc = Number.isFinite(disc) ? disc : 0;
      const gst = Number(p.gst);
      const safeGst = Number.isFinite(gst) ? gst : 0;

      if (map.has(productId)) {
        const ex = map.get(productId);
        ex.totalQuantity += qty;
        ex.totalAmount += safeAmt;
        ex.totalDiscount += safeDisc;
        ex._gstWeighted += safeGst * qty;
      } else {
        map.set(productId, {
          productId,
          name: p.name || 'Unknown Product',
          unit: p.unit || '',
          totalQuantity: qty,
          totalAmount: safeAmt,
          totalDiscount: safeDisc,
          _gstWeighted: safeGst * qty,
        });
      }
    }
  }

  const merged = [...map.values()].map((row) => {
    const qty = row.totalQuantity;
    const subtotalBeforeDiscount = row.totalAmount + row.totalDiscount;
    const avgPrice = qty > 0 ? subtotalBeforeDiscount / qty : 0;
    const discPct =
      subtotalBeforeDiscount > 0 ? (row.totalDiscount / subtotalBeforeDiscount) * 100 : 0;
    const gstAvg = qty > 0 ? row._gstWeighted / qty : 0;
    return {
      productId: row.productId,
      name: row.name,
      totalQuantity: Math.round(row.totalQuantity * 1000) / 1000,
      unit: row.unit,
      price: Math.round(avgPrice * 100) / 100,
      discountPercentage: Math.round(discPct * 100) / 100,
      totalDiscount: Math.round(row.totalDiscount * 100) / 100,
      totalAmount: Math.round(row.totalAmount * 100) / 100,
      gst: Math.round(gstAvg * 100) / 100,
    };
  });

  merged.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const rollupCount = dayDocsData.reduce((s, d) => {
    const n = Number(d[countField]);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  let totalDiscount = 0;
  let totalAmount = 0;
  merged.forEach((p) => {
    totalDiscount += p.totalDiscount;
    totalAmount += p.totalAmount;
  });
  const subAgg = totalAmount + totalDiscount;
  const aggDiscPct = subAgg > 0 ? (totalDiscount / subAgg) * 100 : 0;

  const totals = {
    totalProducts: merged.length,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalDiscountPercentage: Math.round(aggDiscPct * 100) / 100,
  };
  totals[countField] = rollupCount;

  return {
    mergedProducts: merged,
    totals,
  };
}

function mergeDeliveryProductsAcrossDays(dayDocsData) {
  return mergeDailyProductDocuments(dayDocsData, 'totalOrders');
}

function mergeReturnProductsAcrossDays(dayDocsData) {
  return mergeDailyProductDocuments(dayDocsData, 'totalReturns');
}

/**
 * List price is GST-inclusive. Discount % off list; tax split backed out from discounted inclusive total.
 * @param {boolean} interState — true: IGST only; false: CGST+SGST half each.
 */
const computeDeliveryCsvTaxLine = (itemRate, discountPct, qty, gstPct, interState) => {
  const rate = Number(itemRate) || 0;
  const disc = Number(discountPct) || 0;
  const q = Number(qty) || 0;
  const gst = Number(gstPct) || 0;

  const rateAfterDiscountInclTax = roundMoney2(rate * (1 - disc / 100));
  const billTotalBeforeRounding = roundMoney2(rateAfterDiscountInclTax * q);
  const billTotal = Math.round(billTotalBeforeRounding);
  const gDec = gst / 100;
  const taxableValue = gDec > 0 ? roundMoney2(billTotalBeforeRounding / (1 + gDec)) : billTotalBeforeRounding;

  let igstRate = 0;
  let igstAmt = 0;
  let cgstRate = 0;
  let cgstAmt = 0;
  let sgstRate = 0;
  let sgstAmt = 0;

  if (gst > 0) {
    if (interState) {
      igstRate = gst;
      igstAmt = roundMoney2(taxableValue * gDec);
    } else {
      cgstRate = roundMoney2(gst / 2);
      sgstRate = roundMoney2(gst / 2);
      const halfDec = gDec / 2;
      cgstAmt = roundMoney2(taxableValue * halfDec);
      sgstAmt = roundMoney2(taxableValue * halfDec);
    }
  }

  const taxParts = igstAmt + cgstAmt + sgstAmt;
  const balancingRounding = roundMoney2(billTotalBeforeRounding - taxableValue - taxParts);
  const billRoundOff = roundMoney2(billTotal - billTotalBeforeRounding);
  const rounding = roundMoney2(balancingRounding + billRoundOff);

  return {
    rateAfterDiscountInclTax,
    taxableValueAfterDiscountPerUnit: q > 0 ? roundMoney2(taxableValue / q) : '',
    totalTaxableLine: taxableValue,
    igstRate,
    igstAmt,
    cgstRate,
    cgstAmt,
    sgstRate,
    sgstAmt,
    rounding,
    billTotal,
  };
};

const PRODUCT_VOUCHER_EXPORT_HEADERS = [
  'Voucher Date',
  'Voucher Number',
  'Buyer/Supplier',
  'Address',
  'State',
  'Pin Code',
  'Registration Type',
  'Registration Number',
  'Item Name',
  'Billed Quantity',
  'Item Rate',
  'Unit',
  'Discount %',
  'Item Rate After Discount Including Tax',
  'Taxable Value After Discount',
  'Total',
  'IGST Rate',
  'IGST Amount',
  'CGST Rate',
  'CGST Amount',
  'SGST Rate',
  'SGST Amount',
  'Rounding',
  'Bill Total',
  'Bill To Palace',
  'Ship To Palace',
];

/**
 * Shared data for delivery/return voucher exports (.xlsx).
 * Query: `date=YYYY-MM-DD` or `from` + `to` (inclusive, max MAX_XLSX_VOUCHER_RANGE_DAYS days).
 * @param {'delivery' | 'return'} kind
 */
const buildDailyProductVoucherExportRows = async (req, kind) => {
  const db = getFirestoreDB();
  const { date, from, to, interState, defaultGst, counter } = req.query;

  const fromS = firstQueryString(from);
  const toS = firstQueryString(to);
  const dateS = date != null && String(date).trim() !== '' ? String(date).trim() : '';

  /** @type {string[]} */
  let dateKeys;

  const usedRangeParams = Boolean(fromS && toS);
  if (usedRangeParams) {
    if (!YMD_DATE_REGEX.test(fromS) || !YMD_DATE_REGEX.test(toS)) {
      return {
        ok: false,
        status: 400,
        body: { success: false, error: 'from and to must be YYYY-MM-DD' },
      };
    }
    if (fromS > toS) {
      return {
        ok: false,
        status: 400,
        body: { success: false, error: 'from must be on or before to' },
      };
    }
    dateKeys = enumerateDateRangeInclusive(fromS, toS);
    if (dateKeys.length > MAX_XLSX_VOUCHER_RANGE_DAYS) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: `Date range spans ${dateKeys.length} days; maximum is ${MAX_XLSX_VOUCHER_RANGE_DAYS}`,
        },
      };
    }
  } else if (dateS !== '') {
    if (!YMD_DATE_REGEX.test(dateS)) {
      return {
        ok: false,
        status: 400,
        body: { success: false, error: 'date must be YYYY-MM-DD' },
      };
    }
    dateKeys = [dateS];
  } else {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'Provide date=YYYY-MM-DD or from and to (inclusive range, maximum 10 days)',
      },
    };
  }

  const interStateBool = interState === '1' || interState === 'true' || interState === true;
  const defaultGstNum = defaultGst !== undefined && defaultGst !== '' ? parseFloat(String(defaultGst)) : NaN;
  const fallbackGst = Number.isFinite(defaultGstNum) ? defaultGstNum : 0;

  const isDelivery = kind === 'delivery';
  const collName = isDelivery ? 'DailyProductDelivery' : 'DailyProductReturn';

  /** @type {{ dateKey: string, outletDocs: import('firebase-admin').firestore.QueryDocumentSnapshot[] }[]} */
  const dayBundles = [];

  for (const dateKey of dateKeys) {
    const dateDocRef = db.collection(collName).doc(dateKey);
    const dateDoc = await dateDocRef.get();
    if (!dateDoc.exists) continue;
    const outletsSnapshot = await dateDocRef.collection('outlets').orderBy('outletName').get();
    if (!outletsSnapshot.empty) {
      dayBundles.push({ dateKey, outletDocs: outletsSnapshot.docs });
    }
  }

  if (!dayBundles.length) {
    const rangeLabel = dateKeys.length === 1
      ? dateKeys[0]
      : `${dateKeys[0]}–${dateKeys[dateKeys.length - 1]}`;
    return {
      ok: false,
      status: 404,
      body: {
        success: false,
        message: isDelivery
          ? `No product delivery data found for requested day(s): ${rangeLabel}`
          : `No product return data found for requested day(s): ${rangeLabel}`,
      },
    };
  }

  const productIds = new Set();
  dayBundles.forEach(({ outletDocs }) => {
    outletDocs.forEach((d) => {
      (d.data().products || []).forEach((p) => {
        if (p.productId && p.productId !== 'unknown') productIds.add(p.productId);
      });
    });
  });

  const gstFromCatalog = new Map();
  await Promise.all(
    [...productIds].map(async (id) => {
      const pd = await db.collection('products').doc(id).get();
      const g = pd.exists ? parseFloat(pd.data().gst ?? 0) : 0;
      gstFromCatalog.set(id, Number.isFinite(g) ? g : 0);
    })
  );

  /**
   * Pre-group each outlet's products into [taxable[], nonTaxable[]] using the already-loaded
   * gstFromCatalog map. Each group will get its own voucher number so that taxable and
   * non-taxable items are never mixed on the same voucher.
   * Structure: dayBundlesGrouped[day][outlet] = { outletData, groups: [{gstPct, product}[]] }
   */
  const resolveGst = (product) => {
    const raw = product.gst !== undefined && product.gst !== null && String(product.gst).trim() !== ''
      ? Number(product.gst)
      : undefined;
    // Only trust the stored gst if it is a positive finite number.
    // A stored value of 0 almost always means the field was absent on the
    // original transaction item and defaulted to 0 during aggregation, so
    // we fall back to the product-catalog rate instead.
    if (Number.isFinite(raw) && raw > 0) return raw;
    return gstFromCatalog.get(product.productId) ?? fallbackGst;
  };

  const dayBundlesGrouped = dayBundles.map(({ dateKey, outletDocs }) => ({
    dateKey,
    outlets: outletDocs.map((doc) => {
      const outletData = doc.data();
      const products = outletData.products || [];
      /** @type {{ product: object, gstPct: number }[]} */
      const taxable = [];
      /** @type {{ product: object, gstPct: number }[]} */
      const nonTaxable = [];
      products.forEach((product) => {
        const gstPct = resolveGst(product);
        (gstPct > 0 ? taxable : nonTaxable).push({ product, gstPct });
      });
      /** Each entry is one voucher number worth of product rows */
      const groups = [];
      if (taxable.length) groups.push(taxable);
      if (nonTaxable.length) groups.push(nonTaxable);
      return { outletData, groups };
    }),
  }));

  // Count total voucher groups across all days + outlets for counter reservation
  const totalVoucherGroups = dayBundlesGrouped.reduce(
    (sum, day) => sum + day.outlets.reduce((s, o) => s + o.groups.length, 0),
    0
  );

  const voucherCounterRef = db
    .collection('counters')
    .doc(isDelivery ? 'deliveredvouchercounter' : 'returnvouchercounter');

  const counterParsed =
    counter !== undefined && counter !== '' ? parseInt(String(counter), 10) : NaN;
  const usePayloadCounter = Number.isFinite(counterParsed) && counterParsed >= 1;

  let startVoucherNumber;
  if (usePayloadCounter) {
    startVoucherNumber = counterParsed;
  } else {
    startVoucherNumber = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(voucherCounterRef);
      const last = snap.exists ? Number(snap.data().count) : 0;
      const safeLast = Number.isFinite(last) && last >= 0 ? last : 0;
      const start = safeLast + 1;
      transaction.set(voucherCounterRef, { count: safeLast + totalVoucherGroups }, { merge: true });
      return start;
    });
  }

  /** @type {Array<Array<string|number>>} */
  const rows = [];
  let voucherOffset = 0;

  for (const { dateKey, outlets } of dayBundlesGrouped) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const voucherDate = `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;

    for (const { outletData: outlet, groups } of outlets) {
      const gstNo = outlet.gstNo || '';
      const registrationType = gstNo ? 'Regular' : 'Unregistered/Consumer';
      const registrationNumber = gstNo || '';
      const address = outlet.address != null ? String(outlet.address).trim() : '';
      const state = outlet.state != null ? String(outlet.state).trim() : '';
      const pinCode = (outlet.pincode != null && outlet.pincode !== 0 && outlet.pincode !== '') ? String(outlet.pincode).trim() : ((outlet.pinCode != null && outlet.pinCode !== 0 && outlet.pinCode !== '') ? String(outlet.pinCode).trim() : '');
      const billToPalace = outlet.billToPalace != null ? String(outlet.billToPalace).trim() : '';

      for (const group of groups) {
        // All products in this group share the same voucher number
        const voucherNumber = startVoucherNumber + voucherOffset;
        voucherOffset += 1;

        // Supplier identity columns appear only on the FIRST row of each voucher group
        let isFirstRowOfGroup = true;

        for (const { product, gstPct } of group) {
          const tax = computeDeliveryCsvTaxLine(
            product.price,
            product.discountPercentage || 0,
            product.totalQuantity,
            gstPct,
            interStateBool
          );

          const perUnitTaxable = tax.taxableValueAfterDiscountPerUnit;

          // Address and Pin Code appear only on the first row of each voucher group
          const rowAddress = isFirstRowOfGroup ? address : '';
          const rowPinCodeRaw = isFirstRowOfGroup ? pinCode : '';
          const rowPinCode = rowPinCodeRaw !== '' && /^\d+$/.test(rowPinCodeRaw) ? Number(rowPinCodeRaw) : rowPinCodeRaw;
          isFirstRowOfGroup = false;

          rows.push([
            voucherDate,
            voucherNumber,
            outlet.outletName ?? '',
            rowAddress,
            state,
            rowPinCode,
            registrationType,
            registrationNumber,
            product.name ?? '',
            Number(product.totalQuantity),
            Number(product.price),
            (product.unit || 'kg').toString().toUpperCase(),
            Number(product.discountPercentage || 0),
            tax.rateAfterDiscountInclTax,
            perUnitTaxable === '' ? '' : perUnitTaxable,
            tax.totalTaxableLine,
            tax.igstRate,
            tax.igstAmt,
            tax.cgstRate,
            tax.cgstAmt,
            tax.sgstRate,
            tax.sgstAmt,
            tax.rounding,
            tax.billTotal,
            billToPalace,
            billToPalace,
          ]);
        }
      }
    }
  }

  const prefix = isDelivery ? 'DailyProductDelivery' : 'DailyProductReturn';
  const filenameBase = usedRangeParams
    ? `${prefix}_${fromS}_to_${toS}`
    : `${prefix}_${dateKeys[0]}`;

  return {
    ok: true,
    headers: PRODUCT_VOUCHER_EXPORT_HEADERS,
    rows,
    filenameBase,
  };
};

/**
 * POST /api/balance/calculate-opening-closing
 * 
 * Daily Opening/Closing Balance calculation for all active outlets.
 * Called by Firebase Cloud Function scheduler every day at 6:00 AM IST.
 *
 * Steps:
 *   1. Cleanup old records (older than 1 month)
 *   2. Query all active outlets
 *   3. Create balance calculation record for each outlet
 *   4. Mark each record as success after creation
 *   5. Return summary response
 */
export const calculateDailyOpeningClosingBalance = async (req, res) => {
  const executionStart = new Date();
  let oldRecordsDeleted = 0;

  try {
    const db = getFirestoreDB();
    const { triggeredAt, timeZone, source } = req.body;

    console.log(`📊 [Balance Calculation] Started at ${executionStart.toISOString()}`);
    console.log(`   Triggered at: ${triggeredAt}, TimeZone: ${timeZone}, Source: ${source}`);

    // ──────────────────────────────────────────────
    // Step 1 — Cleanup old records (older than 1 month)
    // ──────────────────────────────────────────────
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoTimestamp = admin.firestore.Timestamp.fromDate(oneMonthAgo);

    console.log(`🧹 [Step 1] Cleaning up records older than ${oneMonthAgo.toISOString()}`);

    const oldRecordsSnapshot = await db
      .collection('OutletOpeningClosingBalance')
      .where('timestamp', '<', oneMonthAgoTimestamp)
      .get();

    if (!oldRecordsSnapshot.empty) {
      const oldDocs = oldRecordsSnapshot.docs;
      // Delete in batches of 500 (Firestore batch limit)
      for (let i = 0; i < oldDocs.length; i += 500) {
        const batch = db.batch();
        const chunk = oldDocs.slice(i, i + 500);
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      oldRecordsDeleted = oldDocs.length;
    }

    console.log(`🧹 [Step 1] Deleted ${oldRecordsDeleted} old records`);

    // ──────────────────────────────────────────────
    // Step 2 — Query all active outlets
    // ──────────────────────────────────────────────
    console.log('🏪 [Step 2] Querying all active outlets...');

    const outletsSnapshot = await db
      .collection('outlets')
      .where('active', '==', true)
      .get();

    if (outletsSnapshot.empty) {
      console.log('🏪 [Step 2] No active outlets found');
      return res.status(200).json({
        success: true,
        message: 'No active outlets found. Nothing to process.',
        summary: {
          totalOutlets: 0,
          successful: 0,
          failed: 0,
          oldRecordsDeleted,
        },
        executedAt: new Date().toISOString(),
      });
    }

    const activeOutlets = [];
    outletsSnapshot.forEach((doc) => {
      const data = doc.data();
      activeOutlets.push({
        id: doc.id,
        name: data.name || 'Unknown Outlet',
        openingBalance: parseFloat(data.openingBalance) || 0,
        openingBalanceDate: data.openingBalanceDate || null,
      });
    });

    console.log(`🏪 [Step 2] Found ${activeOutlets.length} active outlets`);

    // ──────────────────────────────────────────────
    // Compute date boundaries for the triggered date (in IST)
    // ──────────────────────────────────────────────
    const triggeredDate = new Date(triggeredAt || executionStart.toISOString());
    const { dateStr: targetDateStr, dayStartTimestamp, dayEndTimestamp } = getIstDayBoundaries(triggeredDate);

    console.log(`📅 Target date (IST): ${targetDateStr}`);

    // ──────────────────────────────────────────────
    // Step 3 & 4 — Create balance records & mark as success
    // Process all outlets in parallel using Promise.allSettled
    // ──────────────────────────────────────────────
    console.log('📝 [Step 3 & 4] Creating balance records for each outlet...');

    const results = await Promise.allSettled(
      activeOutlets.map(async (outlet) => {
        try {
          // Fetch the previous day's totalClosingBalance for this outlet
          const prevBalanceSnapshot = await db.collection('OutletOpeningClosingBalance')
            .where('OutletID', '==', outlet.id)
            .where('status', '==', 'success')
            .where('timestamp', '<', dayStartTimestamp)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

          let previousDayClosingBalance = 0;
          if (!prevBalanceSnapshot.empty) {
            const prevData = prevBalanceSnapshot.docs[0].data();
            previousDayClosingBalance = parseFloat(prevData.totalClosingBalance || 0);
          }

          // Query delivered orders for this outlet on the triggered date
          const ordersSnapshot = await db.collection('orders')
            .where('outletId', '==', outlet.id)
            .where('status', '==', 'delivered')
            .where('deliveredDate', '>=', dayStartTimestamp)
            .where('deliveredDate', '<=', dayEndTimestamp)
            .get();

          let closingBalanceOrder = 0;
          ordersSnapshot.forEach((doc) => {
            const data = doc.data();
            closingBalanceOrder += parseFloat(data['total amount'] || data.totalAmount || 0);
          });

          // Approved payments: paymentDate (business date), or createdAt when paymentDate is missing
          const { total: closingBalancePayment } = await fetchApprovedPaymentsForDay(
            db,
            outlet.id,
            dayStartTimestamp,
            dayEndTimestamp
          );

          // Query collected returns for this outlet on the triggered date (collectedDate, like orders' deliveredDate)
          const returnsSnapshot = await db.collection('returns')
            .where('outletId', '==', outlet.id)
            .where('status', '==', 'collected')
            .where('collectedDate', '>=', dayStartTimestamp)
            .where('collectedDate', '<=', dayEndTimestamp)
            .get();

          let closingBanlanceReturn = 0;
          returnsSnapshot.forEach((doc) => {
            closingBanlanceReturn += parseFloat(doc.data().totalAmount || 0);
          });

          const anchorPrevDate = outlet.openingBalanceDate
            ? addDaysToDateStr(outlet.openingBalanceDate, -1)
            : null;
          const isOpeningBalanceAnchorDay =
            anchorPrevDate && targetDateStr === anchorPrevDate;

          // Anchor day uses configured opening balance; other days use running formula
          const totalClosingBalance = isOpeningBalanceAnchorDay
            ? outlet.openingBalance
            : previousDayClosingBalance + closingBalanceOrder - closingBanlanceReturn - closingBalancePayment;

          // Step 3 & 4 — Upsert balance record (timestamp = end of IST business day for GET ?date=)
          const balancePayload = {
            OutletID: outlet.id,
            outletName: outlet.name,
            timestamp: dayEndTimestamp,
            status: 'success',
            closingBalanceOrder,
            closingBalancePayment,
            closingBanlanceReturn,
            totalClosingBalance,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          const existingDaySnapshot = await db
            .collection('OutletOpeningClosingBalance')
            .where('OutletID', '==', outlet.id)
            .where('timestamp', '>=', dayStartTimestamp)
            .where('timestamp', '<=', dayEndTimestamp)
            .limit(1)
            .get();

          let docId;
          if (!existingDaySnapshot.empty) {
            const existingRef = existingDaySnapshot.docs[0].ref;
            docId = existingDaySnapshot.docs[0].id;
            await existingRef.update(balancePayload);
          } else {
            const docRef = await db.collection('OutletOpeningClosingBalance').add(balancePayload);
            docId = docRef.id;
          }

          return { outletId: outlet.id, outletName: outlet.name, docId, status: 'success' };
        } catch (error) {
          console.error(`❌ Failed for outlet ${outlet.id} (${outlet.name}):`, error.message);
          throw error;
        }
      })
    );

    // ──────────────────────────────────────────────
    // Step 5 — Return summary response
    // ──────────────────────────────────────────────
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`✅ [Step 5] Completed — Success: ${successful}, Failed: ${failed}`);

    return res.status(200).json({
      success: true,
      message: 'Opening/Closing balance calculation completed',
      summary: {
        totalOutlets: activeOutlets.length,
        successful,
        failed,
        oldRecordsDeleted,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [Balance Calculation] Fatal error:', error);

    // Create a notification in Firestore for admin
    try {
      const db = getFirestoreDB();
      await db.collection('notifications').add({
        userId: 'admin',
        title: '❌ Balance Calculation Failed',
        body: `Opening/Closing balance calculation failed: ${error.message}`,
        type: 'system',
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        error: error.message,
        executedAt: new Date().toISOString(),
      });
    } catch (notifError) {
      console.error('❌ Failed to create error notification:', notifError.message);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      executedAt: new Date().toISOString(),
    });
  }
};

/**
 * POST /api/balance/daily-product-delivery
 *
 * Aggregates all products delivered across all orders for the triggered date
 * and stores them in the DailyProductDelivery collection with the date as document ID.
 */
export const calculateDailyProductDelivery = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { triggeredAt, timeZone, source } = req.body;
    const executionStart = new Date();

    console.log(`📦 [Daily Product Delivery] Started at ${executionStart.toISOString()}`);
    console.log(`   Triggered at: ${triggeredAt}, TimeZone: ${timeZone}, Source: ${source}`);

    const triggeredDate = new Date(triggeredAt || executionStart.toISOString());
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
    const targetYear = istDate.getUTCFullYear();
    const targetMonth = istDate.getUTCMonth();
    const targetDay = istDate.getUTCDate();

    const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

    const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);
    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(startOfDayUTC);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(endOfDayUTC);

    console.log(`📅 Target date (IST): ${dateStr}`);

    const [outletsSnapshot, ordersSnapshot] = await Promise.all([
      db.collection('outlets').where('active', '==', true).get(),
      db.collection('orders')
        .where('status', '==', 'delivered')
        .where('deliveredDate', '>=', dayStartTimestamp)
        .where('deliveredDate', '<=', dayEndTimestamp)
        .get(),
    ]);

    const readOutlet = (dd) => ({
      name: dd.name || dd.outletName || 'Unknown Outlet',
      gstNo: dd.gstNo || dd.gst || dd.gstin || '',
      billToPalace: dd.billToPalace || '',
      state: dd.state || '',
      address: dd.address || '',
      pincode: (dd.pincode != null && dd.pincode !== 0 && dd.pincode !== '') ? String(dd.pincode) : ((dd.pinCode != null && dd.pinCode !== 0 && dd.pinCode !== '') ? String(dd.pinCode) : ''),
    });

    const outletMap = new Map();
    outletsSnapshot.forEach((doc) => outletMap.set(doc.id, readOutlet(doc.data())));

    console.log(`🏪 Found ${outletMap.size} active outlets`);
    console.log(`📦 Found ${ordersSnapshot.size} delivered orders for ${dateStr}`);

    const outletDataMap = new Map();
    const globalProductMap = new Map();
    let totalOrders = 0;

    ordersSnapshot.forEach((doc) => {
      const data = doc.data();
      totalOrders++;
      const outletId = data.outletId || 'unknown';
      const items = data.items || [];
      if (!outletDataMap.has(outletId)) outletDataMap.set(outletId, { orderCount: 0, productMap: new Map() });
      const outletEntry = outletDataMap.get(outletId);
      outletEntry.orderCount++;

      items.forEach((item) => {
        const productId = item.productId || item.prodid || 'unknown';
        const name = item.name || 'Unknown Product';
        const quantity = parseFloat(item.quantity || 0);
        const price = parseFloat(item.price || 0);
        const itemSubtotal = price * quantity;
        const discountPercentage = parseFloat(item.discountPercentage || 0);
        const explicitDiscount = parseFloat(item.discountAmount || 0);
        const discountAmount = explicitDiscount > 0
          ? explicitDiscount
          : (itemSubtotal * discountPercentage / 100);
        const itemAmount = itemSubtotal - discountAmount;
        const lineGst = parseFloat(item.gst ?? item.GST ?? 0) || 0;
        const gstWeighted = lineGst * quantity;

        const accumulate = (map) => {
          if (map.has(productId)) {
            const ex = map.get(productId);
            ex.totalQuantity += quantity;
            ex.totalAmount += itemAmount;
            ex.totalDiscount += discountAmount;
            ex.gstWeighted = (ex.gstWeighted || 0) + gstWeighted;
          } else {
            map.set(productId, { productId, name, totalQuantity: quantity, totalAmount: itemAmount, totalDiscount: discountAmount, gstWeighted });
          }
        };
        accumulate(outletEntry.productMap);
        accumulate(globalProductMap);
      });
    });

    const missingIds = [...outletDataMap.keys()].filter((id) => !outletMap.has(id));
    if (missingIds.length) {
      const docs = await Promise.all(missingIds.map((id) => db.collection('outlets').doc(id).get()));
      docs.forEach((doc, i) => outletMap.set(missingIds[i], readOutlet(doc.exists ? doc.data() : {})));
    }

    const allProductIds = new Set([...globalProductMap.keys()]);
    outletDataMap.forEach((e) => e.productMap.forEach((_, pid) => allProductIds.add(pid)));
    allProductIds.delete('unknown');
    const unitMap = new Map();
    const gstCatalogMap = new Map();
    if (allProductIds.size > 0) {
      const pdocs = await Promise.all([...allProductIds].map((id) => db.collection('products').doc(id).get()));
      [...allProductIds].forEach((id, i) => {
        const d = pdocs[i].exists ? pdocs[i].data() : {};
        unitMap.set(id, d.unit || '');
        const catalogGst = parseFloat(d.gst ?? 0);
        gstCatalogMap.set(id, Number.isFinite(catalogGst) ? catalogGst : 0);
      });
    }

    const buildProductList = (pMap) => Array.from(pMap.values()).map((p) => {
      const sub = p.totalAmount + (p.totalDiscount || 0);
      const avgPrice = p.totalQuantity > 0 ? sub / p.totalQuantity : 0;
      const discPct = sub > 0 ? ((p.totalDiscount || 0) / sub) * 100 : 0;
      return {
        productId: p.productId,
        name: p.name,
        totalQuantity: p.totalQuantity,
        unit: unitMap.get(p.productId) || '',
        price: Math.round(avgPrice * 100) / 100,
        discountPercentage: Math.round(discPct * 100) / 100,
        totalDiscount: Math.round((p.totalDiscount || 0) * 100) / 100,
        totalAmount: Math.round(p.totalAmount * 100) / 100,
        gst: gstCatalogMap.get(p.productId) ?? 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const computeTotals = (products) => {
      const totalAmount = products.reduce((s, p) => s + (p.totalAmount || 0), 0);
      const totalDiscount = products.reduce((s, p) => s + (p.totalDiscount || 0), 0);
      const sub = totalAmount + totalDiscount;
      return {
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        totalDiscountPercentage: Math.round(sub > 0 ? (totalDiscount / sub) * 100 : 0, 2),
      };
    };

    const globalProducts = buildProductList(globalProductMap);
    const globalTotals = computeTotals(globalProducts);
    const dateDocRef = db.collection('DailyProductDelivery').doc(dateStr);
    const batchWrites = [];
    const outletSummaries = [];

    batchWrites.push({
      ref: dateDocRef,
      data: {
        date: dateStr,
        deliveredDate: dateStr,
        products: globalProducts,
        totalProducts: globalProducts.length,
        totalOrders,
        totalOutlets: outletDataMap.size,
        ...globalTotals,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
      },
    });

    for (const [outletId, entry] of outletDataMap) {
      const info = outletMap.get(outletId) || { name: 'Unknown Outlet', gstNo: '', billToPalace: '', state: '', address: '', pincode: '' };
      const products = buildProductList(entry.productMap);
      const totals = computeTotals(products);
      batchWrites.push({
        ref: dateDocRef.collection('outlets').doc(outletId),
        data: {
          outletId,
          outletName: info.name,
          gstNo: info.gstNo || '',
          billToPalace: info.billToPalace || '',
          state: info.state || '',
          address: info.address || '',
          pincode: info.pincode || '',
          date: dateStr,
          products,
          totalProducts: products.length,
          totalOrders: entry.orderCount,
          ...totals,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: 'success',
        },
      });
      outletSummaries.push({
        outletId,
        outletName: info.name,
        gstNo: info.gstNo || '',
        billToPalace: info.billToPalace || '',
        state: info.state || '',
        address: info.address || '',
        pincode: info.pincode || '',
        totalOrders: entry.orderCount,
        totalProducts: products.length,
        ...totals,
      });
    }

    await commitBatchedDocumentSets(db, batchWrites);
    console.log(`✅ Stored ${globalProducts.length} products from ${totalOrders} orders across ${outletDataMap.size} outlets for ${dateStr}`);

    return res.status(200).json({
      success: true,
      message: `Daily product delivery recorded for ${dateStr}`,
      summary: {
        date: dateStr,
        totalOrders,
        totalProducts: globalProducts.length,
        totalOutlets: outletDataMap.size,
        ...globalTotals,
        outlets: outletSummaries,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [Daily Product Delivery] Fatal error:', error);

    try {
      const db = getFirestoreDB();
      await db.collection('notifications').add({
        userId: 'admin',
        title: '❌ Daily Product Delivery Failed',
        body: `Daily product delivery calculation failed: ${error.message}`,
        type: 'system',
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        error: error.message,
        executedAt: new Date().toISOString(),
      });
    } catch (notifError) {
      console.error('❌ Failed to create error notification:', notifError.message);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      executedAt: new Date().toISOString(),
    });
  }
};


/**
 * POST /api/balance/daily-product-return
 *
 * Aggregates all line items from collected return orders for the triggered date
 * and stores them in the DailyProductReturn collection with the date as document ID.
 * Uses the same IST day window and outlet/product aggregation shape as daily product delivery.
 */
export const calculateDailyProductReturn = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { triggeredAt, timeZone, source } = req.body;
    const executionStart = new Date();

    console.log(`📦 [Daily Product Return] Started at ${executionStart.toISOString()}`);
    console.log(`   Triggered at: ${triggeredAt}, TimeZone: ${timeZone}, Source: ${source}`);

    const triggeredDate = new Date(triggeredAt || executionStart.toISOString());
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
    const targetYear = istDate.getUTCFullYear();
    const targetMonth = istDate.getUTCMonth();
    const targetDay = istDate.getUTCDate();

    const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

    const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);
    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(startOfDayUTC);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(endOfDayUTC);

    console.log(`📅 Target date (IST): ${dateStr}`);

    const [outletsSnapshot, returnsSnapshot] = await Promise.all([
      db.collection('outlets').where('active', '==', true).get(),
      db.collection('returns')
        .where('status', '==', 'collected')
        .where('collectedDate', '>=', dayStartTimestamp)
        .where('collectedDate', '<=', dayEndTimestamp)
        .get(),
    ]);

    const readOutlet = (dd) => ({
      name: dd.name || dd.outletName || 'Unknown Outlet',
      gstNo: dd.gstNo || dd.gst || dd.gstin || '',
      billToPalace: dd.billToPalace || '',
      state: dd.state || '',
      address: dd.address || '',
      pincode: (dd.pincode != null && dd.pincode !== 0 && dd.pincode !== '') ? String(dd.pincode) : ((dd.pinCode != null && dd.pinCode !== 0 && dd.pinCode !== '') ? String(dd.pinCode) : ''),
    });

    const outletMap = new Map();
    outletsSnapshot.forEach((doc) => outletMap.set(doc.id, readOutlet(doc.data())));

    const outletDataMap = new Map();
    const globalProductMap = new Map();
    let totalReturns = 0;

    returnsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.archived) return;
      totalReturns++;
      const outletId = data.outletId || 'unknown';
      const items = data.items || data.returnItems || [];
      if (!outletDataMap.has(outletId)) outletDataMap.set(outletId, { returnCount: 0, productMap: new Map() });
      const outletEntry = outletDataMap.get(outletId);
      outletEntry.returnCount++;

      items.forEach((item) => {
        const productId = item.productId || item.prodid || 'unknown';
        const name = item.name || 'Unknown Product';
        const quantity = parseFloat(item.quantity || 0);
        const price = parseFloat(item.price || 0);
        const itemSubtotal = price * quantity;
        const discountPercentage = parseFloat(item.discountPercentage || 0);
        const explicitDiscount = parseFloat(item.discountAmount || 0);
        const discountAmount = explicitDiscount > 0
          ? explicitDiscount
          : (itemSubtotal * discountPercentage / 100);
        const itemAmount = itemSubtotal - discountAmount;
        const lineGst = parseFloat(item.gst ?? item.GST ?? 0) || 0;
        const gstWeighted = lineGst * quantity;

        const accumulate = (map) => {
          if (map.has(productId)) {
            const ex = map.get(productId);
            ex.totalQuantity += quantity;
            ex.totalAmount += itemAmount;
            ex.totalDiscount += discountAmount;
            ex.gstWeighted = (ex.gstWeighted || 0) + gstWeighted;
          } else {
            map.set(productId, { productId, name, totalQuantity: quantity, totalAmount: itemAmount, totalDiscount: discountAmount, gstWeighted });
          }
        };
        accumulate(outletEntry.productMap);
        accumulate(globalProductMap);
      });
    });

    const missingIds = [...outletDataMap.keys()].filter((id) => !outletMap.has(id));
    if (missingIds.length) {
      const docs = await Promise.all(missingIds.map((id) => db.collection('outlets').doc(id).get()));
      docs.forEach((doc, i) => outletMap.set(missingIds[i], readOutlet(doc.exists ? doc.data() : {})));
    }

    const allProductIds = new Set([...globalProductMap.keys()]);
    outletDataMap.forEach((e) => e.productMap.forEach((_, pid) => allProductIds.add(pid)));
    allProductIds.delete('unknown');
    const unitMap = new Map();
    const gstCatalogMap = new Map();
    if (allProductIds.size > 0) {
      const pdocs = await Promise.all([...allProductIds].map((id) => db.collection('products').doc(id).get()));
      [...allProductIds].forEach((id, i) => {
        const d = pdocs[i].exists ? pdocs[i].data() : {};
        unitMap.set(id, d.unit || '');
        const catalogGst = parseFloat(d.gst ?? 0);
        gstCatalogMap.set(id, Number.isFinite(catalogGst) ? catalogGst : 0);
      });
    }

    const buildProductList = (pMap) => Array.from(pMap.values()).map((p) => {
      const sub = p.totalAmount + (p.totalDiscount || 0);
      const avgPrice = p.totalQuantity > 0 ? sub / p.totalQuantity : 0;
      const discPct = sub > 0 ? ((p.totalDiscount || 0) / sub) * 100 : 0;
      return {
        productId: p.productId,
        name: p.name,
        totalQuantity: p.totalQuantity,
        unit: unitMap.get(p.productId) || '',
        price: Math.round(avgPrice * 100) / 100,
        discountPercentage: Math.round(discPct * 100) / 100,
        totalDiscount: Math.round((p.totalDiscount || 0) * 100) / 100,
        totalAmount: Math.round(p.totalAmount * 100) / 100,
        gst: gstCatalogMap.get(p.productId) ?? 0,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const computeTotals = (products) => {
      const totalAmount = products.reduce((s, p) => s + (p.totalAmount || 0), 0);
      const totalDiscount = products.reduce((s, p) => s + (p.totalDiscount || 0), 0);
      const sub = totalAmount + totalDiscount;
      return {
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        totalDiscountPercentage: Math.round(sub > 0 ? (totalDiscount / sub) * 100 : 0, 2),
      };
    };

    const globalProducts = buildProductList(globalProductMap);
    const globalTotals = computeTotals(globalProducts);
    const dateDocRef = db.collection('DailyProductReturn').doc(dateStr);
    const batchWrites = [];
    const outletSummaries = [];

    batchWrites.push({
      ref: dateDocRef,
      data: {
        date: dateStr,
        returnDate: dateStr,
        products: globalProducts,
        totalProducts: globalProducts.length,
        totalReturns,
        totalOutlets: outletDataMap.size,
        ...globalTotals,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
      },
    });

    for (const [outletId, entry] of outletDataMap) {
      const info = outletMap.get(outletId) || { name: 'Unknown Outlet', gstNo: '', billToPalace: '', state: '', address: '', pincode: '' };
      const products = buildProductList(entry.productMap);
      const totals = computeTotals(products);
      batchWrites.push({
        ref: dateDocRef.collection('outlets').doc(outletId),
        data: {
          outletId,
          outletName: info.name,
          gstNo: info.gstNo || '',
          billToPalace: info.billToPalace || '',
          state: info.state || '',
          address: info.address || '',
          pincode: info.pincode || '',
          date: dateStr,
          products,
          totalProducts: products.length,
          totalReturns: entry.returnCount,
          ...totals,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: 'success',
        },
      });
      outletSummaries.push({
        outletId,
        outletName: info.name,
        gstNo: info.gstNo || '',
        billToPalace: info.billToPalace || '',
        state: info.state || '',
        address: info.address || '',
        pincode: info.pincode || '',
        totalReturns: entry.returnCount,
        totalProducts: products.length,
        ...totals,
      });
    }

    await commitBatchedDocumentSets(db, batchWrites);
    console.log(`✅ Stored ${globalProducts.length} return products from ${totalReturns} returns across ${outletDataMap.size} outlets for ${dateStr}`);

    return res.status(200).json({
      success: true,
      message: `Daily product return recorded for ${dateStr}`,
      summary: {
        date: dateStr,
        totalReturns,
        totalProducts: globalProducts.length,
        totalOutlets: outletDataMap.size,
        ...globalTotals,
        outlets: outletSummaries,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [Daily Product Return] Fatal error:', error);

    try {
      const db = getFirestoreDB();
      await db.collection('notifications').add({
        userId: 'admin',
        title: '❌ Daily Product Return Failed',
        body: `Daily product return calculation failed: ${error.message}`,
        type: 'system',
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        error: error.message,
        executedAt: new Date().toISOString(),
      });
    } catch (notifError) {
      console.error('❌ Failed to create error notification:', notifError.message);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      executedAt: new Date().toISOString(),
    });
  }
};


/**
 * GET /api/balance/daily-product-delivery/xlsx
 *
 * Single day: `?date=2026-03-17&interState=false&defaultGst=5&counter=1`
 * Date range (inclusive, max 10 days): `?from=2026-03-17&to=2026-03-20&…`
 * Days with no `DailyProductDelivery` snapshot (or no outlets) are skipped; 404 if none of the requested days have data.
 *
 * Voucher-style Excel (GST-inclusive list price, discount %, tax backed out).
 * interState=true → IGST only; else CGST+SGST half each.
 * Optional `counter` (integer >= 1): first voucher number; vouchers are consecutive across all outlet rows in date order.
 * If omitted, voucher numbers come from `counters/deliveredvouchercounter` and the counter is advanced by the number of outlet-day rows included.
 */
export const getDailyProductDeliveryXLSX = async (req, res) => {
  try {
    const result = await buildDailyProductVoucherExportRows(req, 'delivery');
    if (!result.ok) return res.status(result.status).json(result.body);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Delivery', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(result.headers);
    result.rows.forEach((r) => sheet.addRow(r));
    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filenameBase}.xlsx"`);
    return res.status(200).send(Buffer.from(buf));
  } catch (error) {
    console.error('❌ [Daily Product Delivery XLSX] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * GET /api/balance/daily-product-return/xlsx
 *
 * Single day: `?date=…&…` — same columns/GST logic as delivery xlsx.
 * Date range (inclusive, max 10 days): `?from=…&to=…` — skips days without return snapshots.
 * Optional `counter` as for delivery; else `counters/returnvouchercounter`.
 */
export const getDailyProductReturnXLSX = async (req, res) => {
  try {
    const result = await buildDailyProductVoucherExportRows(req, 'return');
    if (!result.ok) return res.status(result.status).json(result.body);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Return', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(result.headers);
    result.rows.forEach((r) => sheet.addRow(r));
    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${result.filenameBase}.xlsx"`);
    return res.status(200).send(Buffer.from(buf));
  } catch (error) {
    console.error('❌ [Daily Product Return XLSX] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * GET /api/balance/daily-product-delivery
 *
 * Single day:
 *   ?date=2026-02-23&page=1&limit=20
 *
 * Date range (inclusive, UTC calendar days): products merged by productId across days that have snapshots.
 * Response uses the same { success, message, data, pagination } shape as single-day; merged totals in data.
 *   data.date = range start, data.deliveredDate = range end (same values when from === to).
 *   ?from=2026-05-01&to=2026-05-03&page=1&limit=20
 * Optional: includeDays=true — also return per-day breakdown; optional range summary on the root object.
 * Max span: MAX_DELIVERY_QUERY_RANGE_DAYS (~3 months).
 */
export const getDailyProductDelivery = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { date, from, to, page = 1, limit = 20, includeDays } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.max(1, parseInt(String(limit), 10) || 20);

    const includeDaysFlag =
      includeDays === '1' || includeDays === 'true' || includeDays === true;

    const hasFrom = from != null && String(from).trim() !== '';
    const hasTo = to != null && String(to).trim() !== '';

    if (hasFrom || hasTo) {
      if (!hasFrom || !hasTo) {
        return res.status(400).json({
          success: false,
          error: 'For a date range, both from and to are required (format: YYYY-MM-DD)',
        });
      }
      const fromS = String(from).trim();
      const toS = String(to).trim();
      if (!YMD_DATE_REGEX.test(fromS) || !YMD_DATE_REGEX.test(toS)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD for from and to (e.g. 2026-05-27)',
        });
      }
      if (fromS > toS) {
        return res.status(400).json({
          success: false,
          error: 'from must be on or before to',
        });
      }
      const dayKeys = enumerateDateRangeInclusive(fromS, toS);
      if (dayKeys.length > MAX_DELIVERY_QUERY_RANGE_DAYS) {
        return res.status(400).json({
          success: false,
          error: `Date range spans ${dayKeys.length} days; maximum allowed is ${MAX_DELIVERY_QUERY_RANGE_DAYS}`,
        });
      }

      const snapshots = await Promise.all(
        dayKeys.map((d) => db.collection('DailyProductDelivery').doc(d).get())
      );

      const foundDocsData = [];
      const daysDetail = [];
      let daysFound = 0;
      snapshots.forEach((snap, idx) => {
        const dayKey = dayKeys[idx];
        if (!snap.exists) {
          if (includeDaysFlag) {
            daysDetail.push({
              date: dayKey,
              found: false,
              message: `No product delivery record found for ${dayKey}`,
              data: null,
              pagination: null,
            });
          }
          return;
        }
        daysFound += 1;
        foundDocsData.push(snap.data());
        if (includeDaysFlag) {
          const payload = paginateDailyDeliveryDoc(snap.data(), pageNum, limitNum);
          daysDetail.push({
            date: dayKey,
            found: true,
            ...payload,
          });
        }
      });

      if (foundDocsData.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No DailyProductDelivery records in range ${fromS}–${toS}`,
          range: { from: fromS, to: toS },
          summary: {
            daysRequested: dayKeys.length,
            daysFound: 0,
            daysMissing: dayKeys.length,
          },
        });
      }

      const { mergedProducts, totals } = mergeDeliveryProductsAcrossDays(foundDocsData);
      const totalMergedLines = mergedProducts.length;
      const totalProductPages = Math.ceil(totalMergedLines / limitNum) || 1;
      const offset = (pageNum - 1) * limitNum;
      const paginatedMerged = mergedProducts.slice(offset, offset + limitNum);

      const allFound = daysFound === dayKeys.length;
      const mergedData = {
        date: fromS,
        deliveredDate: fromS === toS ? fromS : toS,
        totalOrders: totals.totalOrders,
        totalProducts: totals.totalProducts,
        totalDiscountPercentage: totals.totalDiscountPercentage,
        totalDiscount: totals.totalDiscount,
        totalAmount: totals.totalAmount,
        products: paginatedMerged,
        timestamp:
          typeof foundDocsData[foundDocsData.length - 1].timestamp?.toDate === 'function'
            ? foundDocsData[foundDocsData.length - 1].timestamp.toDate().toISOString()
            : null,
        status: 'success',
      };

      const payload = {
        success: true,
        message:
          fromS === toS
            ? `Product delivery details for ${fromS}`
            : `Product delivery details for ${fromS}–${toS} (merged)`,
        data: mergedData,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalProducts: totalMergedLines,
          totalPages: totalProductPages,
          hasNextPage: pageNum < totalProductPages,
          hasPrevPage: pageNum > 1,
        },
        range:
          fromS === toS
            ? undefined
            : { from: fromS, to: toS },
        summary: {
          daysRequested: dayKeys.length,
          daysFound,
          daysMissing: dayKeys.length - daysFound,
        },
      };
      if (!allFound) {
        payload.meta = {
          note: 'Some dates in the range have no DailyProductDelivery document; merge uses only existing days.',
        };
      }
      if (includeDaysFlag) {
        payload.days = daysDetail;
      }
      return res.status(200).json(payload);
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        error:
          'Provide date=YYYY-MM-DD for a single day, or from=YYYY-MM-DD&to=YYYY-MM-DD for a range',
      });
    }

    if (!YMD_DATE_REGEX.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-02-23)',
      });
    }

    const doc = await db.collection('DailyProductDelivery').doc(date).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: `No product delivery record found for ${date}`,
      });
    }

    const { data: body, pagination } = paginateDailyDeliveryDoc(doc.data(), pageNum, limitNum);

    return res.status(200).json({
      success: true,
      message: `Product delivery details for ${date}`,
      data: body,
      pagination,
    });
  } catch (error) {
    console.error('❌ [Get Daily Product Delivery] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * GET /api/balance/daily-product-return
 *
 * Single day:
 *   ?date=2026-02-23&page=1&limit=20
 *
 * Date range (merged by productId, same { data, pagination } shape as single day):
 *   data.date = range start; data.returnDate = range end (equal when single day).
 *   ?from=2026-05-01&to=2026-05-03&page=1&limit=20
 * Optional includeDays=true for per-day breakdown.
 */
export const getDailyProductReturn = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { date, from, to, page = 1, limit = 20, includeDays } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.max(1, parseInt(String(limit), 10) || 20);

    const includeDaysFlag =
      includeDays === '1' || includeDays === 'true' || includeDays === true;

    const hasFrom = from != null && String(from).trim() !== '';
    const hasTo = to != null && String(to).trim() !== '';

    if (hasFrom || hasTo) {
      if (!hasFrom || !hasTo) {
        return res.status(400).json({
          success: false,
          error: 'For a date range, both from and to are required (format: YYYY-MM-DD)',
        });
      }
      const fromS = String(from).trim();
      const toS = String(to).trim();
      if (!YMD_DATE_REGEX.test(fromS) || !YMD_DATE_REGEX.test(toS)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD for from and to (e.g. 2026-05-27)',
        });
      }
      if (fromS > toS) {
        return res.status(400).json({
          success: false,
          error: 'from must be on or before to',
        });
      }
      const dayKeys = enumerateDateRangeInclusive(fromS, toS);
      if (dayKeys.length > MAX_DELIVERY_QUERY_RANGE_DAYS) {
        return res.status(400).json({
          success: false,
          error: `Date range spans ${dayKeys.length} days; maximum allowed is ${MAX_DELIVERY_QUERY_RANGE_DAYS}`,
        });
      }

      const snapshots = await Promise.all(
        dayKeys.map((d) => db.collection('DailyProductReturn').doc(d).get())
      );

      const foundDocsData = [];
      const daysDetail = [];
      let daysFound = 0;
      snapshots.forEach((snap, idx) => {
        const dayKey = dayKeys[idx];
        if (!snap.exists) {
          if (includeDaysFlag) {
            daysDetail.push({
              date: dayKey,
              found: false,
              message: `No product return record found for ${dayKey}`,
              data: null,
              pagination: null,
            });
          }
          return;
        }
        daysFound += 1;
        foundDocsData.push(snap.data());
        if (includeDaysFlag) {
          const payload = paginateDailyReturnDoc(snap.data(), pageNum, limitNum);
          daysDetail.push({
            date: dayKey,
            found: true,
            ...payload,
          });
        }
      });

      if (foundDocsData.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No DailyProductReturn records in range ${fromS}–${toS}`,
          range: { from: fromS, to: toS },
          summary: {
            daysRequested: dayKeys.length,
            daysFound: 0,
            daysMissing: dayKeys.length,
          },
        });
      }

      const { mergedProducts, totals } = mergeReturnProductsAcrossDays(foundDocsData);
      const totalMergedLines = mergedProducts.length;
      const totalProductPages = Math.ceil(totalMergedLines / limitNum) || 1;
      const offset = (pageNum - 1) * limitNum;
      const paginatedMerged = mergedProducts.slice(offset, offset + limitNum);

      const allFound = daysFound === dayKeys.length;
      const mergedData = {
        date: fromS,
        returnDate: fromS === toS ? fromS : toS,
        totalReturns: totals.totalReturns,
        totalProducts: totals.totalProducts,
        totalDiscountPercentage: totals.totalDiscountPercentage,
        totalDiscount: totals.totalDiscount,
        totalAmount: totals.totalAmount,
        products: paginatedMerged,
        timestamp:
          typeof foundDocsData[foundDocsData.length - 1].timestamp?.toDate === 'function'
            ? foundDocsData[foundDocsData.length - 1].timestamp.toDate().toISOString()
            : null,
        status: 'success',
      };

      const payload = {
        success: true,
        message:
          fromS === toS
            ? `Product return details for ${fromS}`
            : `Product return details for ${fromS}–${toS} (merged)`,
        data: mergedData,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalProducts: totalMergedLines,
          totalPages: totalProductPages,
          hasNextPage: pageNum < totalProductPages,
          hasPrevPage: pageNum > 1,
        },
        range:
          fromS === toS
            ? undefined
            : { from: fromS, to: toS },
        summary: {
          daysRequested: dayKeys.length,
          daysFound,
          daysMissing: dayKeys.length - daysFound,
        },
      };
      if (!allFound) {
        payload.meta = {
          note: 'Some dates in the range have no DailyProductReturn document; merge uses only existing days.',
        };
      }
      if (includeDaysFlag) {
        payload.days = daysDetail;
      }
      return res.status(200).json(payload);
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        error:
          'Provide date=YYYY-MM-DD for a single day, or from=YYYY-MM-DD&to=YYYY-MM-DD for a range',
      });
    }

    if (!YMD_DATE_REGEX.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-02-23)',
      });
    }

    const doc = await db.collection('DailyProductReturn').doc(date).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: `No product return record found for ${date}`,
      });
    }

    const { data: body, pagination } = paginateDailyReturnDoc(doc.data(), pageNum, limitNum);

    return res.status(200).json({
      success: true,
      message: `Product return details for ${date}`,
      data: body,
      pagination,
    });
  } catch (error) {
    console.error('❌ [Get Daily Product Return] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get all OutletOpeningClosingBalance records
 * Supports optional query parameters:
 * - outletId: Filter by OutletID
 * - status: Filter by status
 * - date: Filter by date (format: YYYY-MM-DD, e.g., 2026-01-16)
 * - limit: Limit the number of results
 */
export const getOutletOpeningClosingBalances = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { outletId, status, date, limit } = req.query;

    let query = db.collection('OutletOpeningClosingBalance');

    // Apply date filter if provided
    if (date) {
      // Parse date string (format: YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-16)',
        });
      }

      try {
        // Match daily balance job: filter by IST calendar day
        const { dayStartTimestamp, dayEndTimestamp } = getIstBoundariesForCalendarDate(date);

        query = query.where('timestamp', '>=', dayStartTimestamp)
                     .where('timestamp', '<=', dayEndTimestamp);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid date. Please provide a valid date in YYYY-MM-DD format',
        });
      }
    }

    // Apply filters if provided
    if (outletId) {
      query = query.where('OutletID', '==', outletId);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    // Order by timestamp descending (most recent first)
    query = query.orderBy('timestamp', 'desc');

    // Apply limit if provided
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        query = query.limit(limitNum);
      }
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return res.status(200).json({
        message: 'No records found',
        data: [],
        count: 0,
      });
    }

    const records = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const outletId = data.OutletID || data.outletId || '';
      records.push({
        id: doc.id,
        ...data,
        outletId,
        // Convert Firestore timestamps to ISO strings for JSON response
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
        completedAt: data.completedAt?.toDate ? data.completedAt.toDate().toISOString() : data.completedAt,
      });
    });

    res.status(200).json({
      message: 'Records retrieved successfully',
      data: records,
      count: records.length,
    });
  } catch (error) {
    console.error('Error fetching OutletOpeningClosingBalance records:', error);
    res.status(500).json({
      error: 'Failed to fetch records',
      details: error.message,
    });
  }
};

/**
 * Get a specific OutletOpeningClosingBalance record by ID
 */
export const getOutletOpeningClosingBalanceById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Record ID is required' });
    }

    const doc = await db.collection('OutletOpeningClosingBalance').doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const data = doc.data();
    const outletId = data.OutletID || data.outletId || '';
    const record = {
      id: doc.id,
      ...data,
      outletId,
      // Convert Firestore timestamps to ISO strings for JSON response
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
      completedAt: data.completedAt?.toDate ? data.completedAt.toDate().toISOString() : data.completedAt,
    };

    res.status(200).json({
      message: 'Record retrieved successfully',
      data: record,
    });
  } catch (error) {
    console.error('Error fetching OutletOpeningClosingBalance record:', error);
    res.status(500).json({
      error: 'Failed to fetch record',
      details: error.message,
    });
  }
};

/**
 * Calculate and update closing balances for an outlet
 * This endpoint:
 * 1. Gets outlet's openingBalance and openingBalanceDate
 * 2. Sets opening balance on the previous date (one day before openingBalanceDate)
 *    - Creates/updates a document for previous date with totalClosingBalance = openingBalance
 *    - This ensures ledger reports show the correct opening balance
 * 3. Fetches existing OutletOpeningClosingBalance documents within date range
 * 4. Calculates closing balances for each date from openingBalanceDate to today
 * 5. Only includes:
 *    - Orders with status "delivered"
 *    - Returns with status "collected"
 *    - Payments with status "approved"
 * 6. Formula: openingBalance + orders - returns - payments = totalClosingBalance
 */
export const calculateClosingBalances = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { outletId } = req.body;

    if (!outletId) {
      return res.status(400).json({ error: 'outletId is required' });
    }

    // Get outlet data
    const outletRef = db.collection('outlets').doc(outletId);
    const outletDoc = await outletRef.get();

    if (!outletDoc.exists) {
      return res.status(404).json({ error: 'Outlet not found' });
    }

    const outletData = outletDoc.data();
    const outletName = outletData.name || outletData.outletName || '';
    const openingBalance = parseFloat(outletData.openingBalance) || 0;
    const openingBalanceDate = outletData.openingBalanceDate;

    if (!openingBalanceDate) {
      return res.status(400).json({ 
        error: 'Opening balance date not found for this outlet. Please set openingBalanceDate in the outlet collection.' 
      });
    }

    // Parse opening balance date (IST calendar dates)
    if (!YMD_DATE_REGEX.test(openingBalanceDate)) {
      return res.status(400).json({
        error: 'Invalid openingBalanceDate on outlet. Use YYYY-MM-DD format.',
      });
    }

    const previousDateStr = addDaysToDateStr(openingBalanceDate, -1);
    const todayIstDateStr = getIstDayBoundaries(new Date()).dateStr;

    const previousBounds = getIstBoundariesForCalendarDate(previousDateStr);
    const todayBounds = getIstBoundariesForCalendarDate(todayIstDateStr);

    const existingBalancesSnapshot = await db.collection('OutletOpeningClosingBalance')
      .where('OutletID', '==', outletId)
      .where('timestamp', '>=', previousBounds.dayStartTimestamp)
      .where('timestamp', '<=', todayBounds.dayEndTimestamp)
      .get();

    // Map existing documents by IST calendar date
    const existingDocsByDate = new Map();
    existingBalancesSnapshot.forEach((doc) => {
      const data = doc.data();
      const dateKey = getIstDateKeyFromTimestamp(data.timestamp);
      if (dateKey) {
        existingDocsByDate.set(dateKey, { ref: doc.ref, id: doc.id });
      }
    });

    // Set opening balance on the previous IST day (anchor for ledger reports)
    const previousDoc = existingDocsByDate.get(previousDateStr);
    const previousCompletedAt = admin.firestore.Timestamp.now();

    if (previousDoc) {
      const previousSnap = await previousDoc.ref.get();
      const previousData = previousSnap.data() || {};
      const hasDailyActivity =
        parseFloat(previousData.closingBalanceOrder || 0) !== 0 ||
        parseFloat(previousData.closingBalancePayment || 0) !== 0 ||
        parseFloat(previousData.closingBanlanceReturn || 0) !== 0;

      if (!hasDailyActivity) {
        await previousDoc.ref.update({
          closingBalanceOrder: 0,
          closingBalancePayment: 0,
          closingBanlanceReturn: 0,
          totalClosingBalance: openingBalance,
          completedAt: previousCompletedAt,
          status: 'success',
          outletName,
        });
      } else {
        await previousDoc.ref.update({
          totalClosingBalance: openingBalance,
          completedAt: previousCompletedAt,
          status: 'success',
          outletName,
        });
      }
    } else {
      const previousDocRef = db.collection('OutletOpeningClosingBalance').doc();
      await previousDocRef.set({
        OutletID: outletId,
        outletName,
        closingBalanceOrder: 0,
        closingBalancePayment: 0,
        closingBanlanceReturn: 0,
        totalClosingBalance: openingBalance,
        timestamp: previousBounds.dayEndTimestamp,
        completedAt: previousCompletedAt,
        status: 'success',
      });
      existingDocsByDate.set(previousDateStr, { ref: previousDocRef, id: previousDocRef.id });
    }

    // Calculate balances for each IST date from openingBalanceDate through today
    const results = [];
    let currentOpeningBalance = openingBalance;
    let dateStr = openingBalanceDate;

    while (dateStr <= todayIstDateStr) {
      // Never recalculate the anchor day (day before openingBalanceDate)
      if (dateStr === previousDateStr) {
        dateStr = addDaysToDateStr(dateStr, 1);
        continue;
      }

      const { dayStartTimestamp, dayEndTimestamp } = getIstBoundariesForCalendarDate(dateStr);

      if (dateStr === openingBalanceDate) {
        currentOpeningBalance = openingBalance;
      }

      // Query orders for this specific date (only delivered orders; deliveredDate matches ledger)
      const ordersSnapshot = await db.collection('orders')
        .where('outletId', '==', outletId)
        .where('status', '==', 'delivered')
        .where('deliveredDate', '>=', dayStartTimestamp)
        .where('deliveredDate', '<=', dayEndTimestamp)
        .get();

      let closingBalanceOrder = 0;
      const ordersList = [];
      ordersSnapshot.forEach((doc) => {
        const orderData = doc.data();
        const oid = orderData.outletId || outletId;
        // Double check status in case query didn't filter properly
        if (orderData.status === 'delivered') {
          const orderAmount = parseFloat(orderData['total amount'] || orderData.totalAmount || 0);
          closingBalanceOrder += orderAmount;
          ordersList.push({
            id: doc.id,
            outletId: oid,
            amount: orderAmount,
            status: orderData.status,
          });
        }
      });

      // Query returns for this specific date (only collected returns; collectedDate like deliveredDate on orders)
      const returnsSnapshot = await db.collection('returns')
        .where('outletId', '==', outletId)
        .where('status', '==', 'collected')
        .where('collectedDate', '>=', dayStartTimestamp)
        .where('collectedDate', '<=', dayEndTimestamp)
        .get();

      let closingBanlanceReturn = 0;
      const returnsList = [];
      returnsSnapshot.forEach((doc) => {
        const returnData = doc.data();
        const rid = returnData.outletId || outletId;
        // Double check status in case query didn't filter properly
        if (returnData.status === 'collected') {
          const returnAmount = parseFloat(returnData.totalAmount || 0);
          closingBanlanceReturn += returnAmount;
          const cd = returnData.collectedDate;
          returnsList.push({
            id: doc.id,
            outletId: rid,
            amount: returnAmount,
            totalAmount: returnAmount,
            status: returnData.status,
            collectedDate: cd?.toDate ? cd.toDate().toISOString() : cd ?? null,
          });
        }
      });

      // Query payments for this specific date (paymentDate, or createdAt when paymentDate missing)
      const { total: closingBalancePayment, paymentsList } = await fetchApprovedPaymentsForDay(
        db,
        outletId,
        dayStartTimestamp,
        dayEndTimestamp
      );

      const totalClosingBalance = currentOpeningBalance + closingBalanceOrder - closingBanlanceReturn - closingBalancePayment;

      const timestamp = dayEndTimestamp;
      const completedAt = admin.firestore.Timestamp.now();

      // Find existing document by date from our map
      const existingDoc = existingDocsByDate.get(dateStr);

      if (existingDoc) {
        // Update existing document
        await existingDoc.ref.update({
          closingBalanceOrder,
          closingBalancePayment,
          closingBanlanceReturn,
          totalClosingBalance,
          completedAt,
          status: 'success',
          outletName, // Update outlet name in case it changed
        });
        results.push({
          date: dateStr,
          documentId: existingDoc.id,
          openingBalance: currentOpeningBalance,
          closingBalanceOrder,
          closingBanlanceReturn,
          closingBalancePayment,
          totalClosingBalance,
          outletId,
          orders: ordersList,
          returns: returnsList,
          payments: paymentsList,
        });
      } else {
        // Create new document
        const newDocRef = db.collection('OutletOpeningClosingBalance').doc();
        await newDocRef.set({
          OutletID: outletId,
          outletName,
          closingBalanceOrder,
          closingBalancePayment,
          closingBanlanceReturn,
          totalClosingBalance,
          timestamp,
          completedAt,
          status: 'success',
        });
        results.push({
          date: dateStr,
          documentId: newDocRef.id,
          openingBalance: currentOpeningBalance,
          closingBalanceOrder,
          closingBanlanceReturn,
          closingBalancePayment,
          totalClosingBalance,
          outletId,
          orders: ordersList,
          returns: returnsList,
          payments: paymentsList,
        });
      }

      // Update opening balance for next day (use today's closing balance)
      currentOpeningBalance = totalClosingBalance;
      dateStr = addDaysToDateStr(dateStr, 1);
    }

    res.status(200).json({
      message: 'Closing balances calculated and updated successfully',
      outletId,
      outletName,
      openingBalance,
      openingBalanceDate,
      calculatedDates: results.length,
      results,
    });
  } catch (error) {
    console.error('Error calculating closing balances:', error);
    res.status(500).json({
      error: 'Failed to calculate closing balances',
      details: error.message,
    });
  }
};

