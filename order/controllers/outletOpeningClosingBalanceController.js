// controllers/outletOpeningClosingBalanceController.js
import ExcelJS from 'exceljs';
import { getFirestoreDB } from '../../util/firebase.js';
import { OutletOpeningClosingBalance } from '../models/outletOpeningClosingBalance.js';
import admin from 'firebase-admin';

const roundMoney2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const YMD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** Shared cap for GET range on daily-product-delivery / daily-product-return. */
const MAX_DELIVERY_QUERY_RANGE_DAYS = 93;
/** GET daily-product-* /xlsx: max inclusive calendar days when using from & to query params */
const MAX_XLSX_VOUCHER_RANGE_DAYS = 10;

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

  const voucherOutletCount = dayBundles.reduce((sum, day) => sum + day.outletDocs.length, 0);
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
      const newCount = safeLast + voucherOutletCount;
      transaction.set(voucherCounterRef, { count: newCount }, { merge: true });
      return start;
    });
  }

  /** @type {Array<Array<string|number>>} */
  const rows = [];
  let outletGlobalIndex = 0;

  for (const { dateKey, outletDocs } of dayBundles) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const voucherDate = `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;

    outletDocs.forEach((doc) => {
      const outlet = doc.data();
      const voucherNumber = startVoucherNumber + outletGlobalIndex;
      outletGlobalIndex += 1;
      const products = outlet.products || [];
      const gstNo = outlet.gstNo || '';
      const registrationType = gstNo ? 'Regular' : 'Unregistered/Consumer';
      const registrationNumber = gstNo || '';
      const address = outlet.address != null ? String(outlet.address).trim() : '';
      const state = outlet.state != null ? String(outlet.state).trim() : '';
      const billToPalace = outlet.billToPalace != null ? String(outlet.billToPalace).trim() : '';

      products.forEach((product) => {
        const pid = product.productId;
        let gstPct =
          product.gst !== undefined && product.gst !== null && String(product.gst).trim() !== ''
            ? Number(product.gst)
            : undefined;
        if (!Number.isFinite(gstPct)) {
          gstPct = gstFromCatalog.get(pid) ?? fallbackGst;
        }

        const tax = computeDeliveryCsvTaxLine(
          product.price,
          product.discountPercentage || 0,
          product.totalQuantity,
          gstPct,
          interStateBool
        );

        const perUnitTaxable = tax.taxableValueAfterDiscountPerUnit;

        rows.push([
          voucherDate,
          voucherNumber,
          outlet.outletName ?? '',
          address,
          state,
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
      });
    });
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
      });
    });

    console.log(`🏪 [Step 2] Found ${activeOutlets.length} active outlets`);

    // ──────────────────────────────────────────────
    // Compute date boundaries for the triggered date (in IST)
    // ──────────────────────────────────────────────
    const triggeredDate = new Date(triggeredAt || executionStart.toISOString());
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
    const targetYear = istDate.getUTCFullYear();
    const targetMonth = istDate.getUTCMonth();
    const targetDay = istDate.getUTCDate();

    const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);

    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(startOfDayUTC);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(endOfDayUTC);

    console.log(`📅 Target date (IST): ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`);

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

          // Query approved payments for this outlet on the triggered date
          const paymentsSnapshot = await db.collection('payments')
            .where('outletId', '==', outlet.id)
            .where('status', '==', 'approved')
            .where('paymentDate', '>=', dayStartTimestamp)
            .where('paymentDate', '<=', dayEndTimestamp)
            .get();

          let closingBalancePayment = 0;
          paymentsSnapshot.forEach((doc) => {
            closingBalancePayment += parseFloat(doc.data().amount || 0);
          });

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

          // Formula: previousDay totalClosingBalance + orders - returns - payments
          const totalClosingBalance = previousDayClosingBalance + closingBalanceOrder - closingBanlanceReturn - closingBalancePayment;

          // Step 3 — Create the balance calculation record
          const docRef = await db.collection('OutletOpeningClosingBalance').add({
            OutletID: outlet.id,
            outletName: outlet.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'in_progress',
            closingBalanceOrder,
            closingBalancePayment,
            closingBanlanceReturn,
            totalClosingBalance,
            completedAt: null,
          });

          // Step 4 — Mark as success
          await docRef.update({
            status: 'success',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          return { outletId: outlet.id, outletName: outlet.name, docId: docRef.id, status: 'success' };
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

    // Query active outlets and delivered orders in parallel
    const [outletsSnapshot, ordersSnapshot] = await Promise.all([
      db.collection('outlets').where('active', '==', true).get(),
      db.collection('orders')
        .where('status', '==', 'delivered')
        .where('deliveredDate', '>=', dayStartTimestamp)
        .where('deliveredDate', '<=', dayEndTimestamp)
        .get(),
    ]);

    const outletMap = new Map();
    outletsSnapshot.forEach((doc) => {
      const d = doc.data();
      outletMap.set(doc.id, {
        name: d.name || d.outletName || 'Unknown Outlet',
        gstNo: d.gstNo || d.gst || d.gstin || '',
        billToPalace: d.billToPalace || '',
        state: d.state || '',
        address: d.address || '',
      });
    });

    console.log(`🏪 Found ${outletMap.size} active outlets`);
    console.log(`📦 Found ${ordersSnapshot.size} delivered orders for ${dateStr}`);

    // Group orders by outlet and aggregate products per outlet
    const outletDataMap = new Map(); // outletId -> { orders, productMap }
    const globalProductMap = new Map();
    let totalOrders = 0;

    ordersSnapshot.forEach((doc) => {
      const data = doc.data();
      totalOrders++;
      const outletId = data.outletId || 'unknown';
      const items = data.items || [];

      if (!outletDataMap.has(outletId)) {
        outletDataMap.set(outletId, { orderCount: 0, productMap: new Map() });
      }
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

        // Per-outlet aggregation
        const oMap = outletEntry.productMap;
        if (oMap.has(productId)) {
          const ex = oMap.get(productId);
          ex.totalQuantity += quantity;
          ex.totalAmount += itemAmount;
          ex.totalDiscount += discountAmount;
          ex.gstWeighted = (ex.gstWeighted || 0) + gstWeighted;
        } else {
          oMap.set(productId, {
            productId,
            name,
            totalQuantity: quantity,
            totalAmount: itemAmount,
            totalDiscount: discountAmount,
            gstWeighted,
          });
        }

        // Global aggregation
        if (globalProductMap.has(productId)) {
          const ex = globalProductMap.get(productId);
          ex.totalQuantity += quantity;
          ex.totalAmount += itemAmount;
          ex.totalDiscount += discountAmount;
          ex.gstWeighted = (ex.gstWeighted || 0) + gstWeighted;
        } else {
          globalProductMap.set(productId, {
            productId,
            name,
            totalQuantity: quantity,
            totalAmount: itemAmount,
            totalDiscount: discountAmount,
            gstWeighted,
          });
        }
      });
    });

    // Fetch units for all unique productIds
    const allProductIds = new Set([...globalProductMap.keys()]);
    outletDataMap.forEach((entry) => {
      entry.productMap.forEach((_, pid) => allProductIds.add(pid));
    });
    allProductIds.delete('unknown');

    const unitMap = new Map();
    const productIdArr = Array.from(allProductIds);
    if (productIdArr.length > 0) {
      const productDocs = await Promise.all(
        productIdArr.map((id) => db.collection('products').doc(id).get())
      );
      productDocs.forEach((doc, i) => {
        unitMap.set(productIdArr[i], doc.exists ? (doc.data().unit || '') : '');
      });
    }

    const buildProductList = (pMap) => {
      return Array.from(pMap.values()).map((p) => {
        const unit = unitMap.get(p.productId) || '';
        const subtotalBeforeDiscount = p.totalAmount + (p.totalDiscount || 0);
        const avgPrice = p.totalQuantity > 0 ? subtotalBeforeDiscount / p.totalQuantity : 0;
        const discPct = subtotalBeforeDiscount > 0
          ? ((p.totalDiscount || 0) / subtotalBeforeDiscount) * 100 : 0;
        const gw = p.gstWeighted != null ? p.gstWeighted : 0;
        const gstAvg = p.totalQuantity > 0 ? gw / p.totalQuantity : 0;
        return {
          productId: p.productId,
          name: p.name,
          totalQuantity: p.totalQuantity,
          unit,
          price: Math.round(avgPrice * 100) / 100,
          discountPercentage: Math.round(discPct * 100) / 100,
          totalDiscount: Math.round((p.totalDiscount || 0) * 100) / 100,
          totalAmount: Math.round(p.totalAmount * 100) / 100,
          gst: Math.round(gstAvg * 100) / 100,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    };

    const computeTotals = (products) => {
      const totalAmount = products.reduce((s, p) => s + (p.totalAmount || 0), 0);
      const totalDiscount = products.reduce((s, p) => s + (p.totalDiscount || 0), 0);
      const subtotal = totalAmount + totalDiscount;
      const discPct = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;
      return {
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        totalDiscountPercentage: Math.round(discPct * 100) / 100,
      };
    };

    // Fetch missing outlet details (e.g. inactive outlets with orders)
    const missingOutletIds = [...outletDataMap.keys()].filter((id) => !outletMap.has(id));
    if (missingOutletIds.length > 0) {
      const missingDocs = await Promise.all(
        missingOutletIds.map((id) => db.collection('outlets').doc(id).get())
      );
      missingDocs.forEach((doc, i) => {
        const d = doc.exists ? doc.data() : {};
        outletMap.set(missingOutletIds[i], {
          name: d.name || d.outletName || 'Unknown Outlet',
          gstNo: d.gstNo || d.gst || d.gstin || '',
          billToPalace: d.billToPalace || '',
          state: d.state || '',
          address: d.address || '',
        });
      });
    }

    // Build global product list
    const globalProducts = buildProductList(globalProductMap);
    const globalTotals = computeTotals(globalProducts);

    // Build per-outlet results and write to subcollection
    const outletSummaries = [];
    const dateDocRef = db.collection('DailyProductDelivery').doc(dateStr);
    const batch = db.batch();

    batch.set(dateDocRef, {
      date: dateStr,
      deliveredDate: dateStr,
      products: globalProducts,
      totalProducts: globalProducts.length,
      totalOrders,
      totalOutlets: outletDataMap.size,
      ...globalTotals,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'success',
    });

    for (const [outletId, entry] of outletDataMap) {
      const outletInfo = outletMap.get(outletId) || { name: 'Unknown Outlet', gstNo: '', billToPalace: '', state: '', address: '' };
      const outletName = outletInfo.name;
      const products = buildProductList(entry.productMap);
      const totals = computeTotals(products);

      const outletDocRef = dateDocRef.collection('outlets').doc(outletId);
      batch.set(outletDocRef, {
        outletId,
        outletName,
        gstNo: outletInfo.gstNo || '',
        billToPalace: outletInfo.billToPalace || '',
        state: outletInfo.state || '',
        address: outletInfo.address || '',
        date: dateStr,
        products,
        totalProducts: products.length,
        totalOrders: entry.orderCount,
        ...totals,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
      });

      outletSummaries.push({
        outletId,
        outletName,
        gstNo: outletInfo.gstNo || '',
        billToPalace: outletInfo.billToPalace || '',
        state: outletInfo.state || '',
        address: outletInfo.address || '',
        totalOrders: entry.orderCount,
        totalProducts: products.length,
        ...totals,
      });
    }

    await batch.commit();

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

    const outletMap = new Map();
    outletsSnapshot.forEach((doc) => {
      const d = doc.data();
      outletMap.set(doc.id, {
        name: d.name || d.outletName || 'Unknown Outlet',
        gstNo: d.gstNo || d.gst || d.gstin || '',
        billToPalace: d.billToPalace || '',
        state: d.state || '',
        address: d.address || '',
      });
    });

    const outletDataMap = new Map();
    const globalProductMap = new Map();
    let totalReturns = 0;

    returnsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.archived) return;

      totalReturns++;
      const outletId = data.outletId || 'unknown';
      const items = data.items || [];

      if (!outletDataMap.has(outletId)) {
        outletDataMap.set(outletId, { returnCount: 0, productMap: new Map() });
      }
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

        const oMap = outletEntry.productMap;
        if (oMap.has(productId)) {
          const ex = oMap.get(productId);
          ex.totalQuantity += quantity;
          ex.totalAmount += itemAmount;
          ex.totalDiscount += discountAmount;
          ex.gstWeighted = (ex.gstWeighted || 0) + gstWeighted;
        } else {
          oMap.set(productId, {
            productId,
            name,
            totalQuantity: quantity,
            totalAmount: itemAmount,
            totalDiscount: discountAmount,
            gstWeighted,
          });
        }

        if (globalProductMap.has(productId)) {
          const ex = globalProductMap.get(productId);
          ex.totalQuantity += quantity;
          ex.totalAmount += itemAmount;
          ex.totalDiscount += discountAmount;
          ex.gstWeighted = (ex.gstWeighted || 0) + gstWeighted;
        } else {
          globalProductMap.set(productId, {
            productId,
            name,
            totalQuantity: quantity,
            totalAmount: itemAmount,
            totalDiscount: discountAmount,
            gstWeighted,
          });
        }
      });
    });

    const allProductIds = new Set([...globalProductMap.keys()]);
    outletDataMap.forEach((entry) => {
      entry.productMap.forEach((_, pid) => allProductIds.add(pid));
    });
    allProductIds.delete('unknown');

    const unitMap = new Map();
    const productIdArr = Array.from(allProductIds);
    if (productIdArr.length > 0) {
      const productDocs = await Promise.all(
        productIdArr.map((id) => db.collection('products').doc(id).get())
      );
      productDocs.forEach((doc, i) => {
        unitMap.set(productIdArr[i], doc.exists ? (doc.data().unit || '') : '');
      });
    }

    const buildProductList = (pMap) => {
      return Array.from(pMap.values()).map((p) => {
        const unit = unitMap.get(p.productId) || '';
        const subtotalBeforeDiscount = p.totalAmount + (p.totalDiscount || 0);
        const avgPrice = p.totalQuantity > 0 ? subtotalBeforeDiscount / p.totalQuantity : 0;
        const discPct = subtotalBeforeDiscount > 0
          ? ((p.totalDiscount || 0) / subtotalBeforeDiscount) * 100 : 0;
        const gw = p.gstWeighted != null ? p.gstWeighted : 0;
        const gstAvg = p.totalQuantity > 0 ? gw / p.totalQuantity : 0;
        return {
          productId: p.productId,
          name: p.name,
          totalQuantity: p.totalQuantity,
          unit,
          price: Math.round(avgPrice * 100) / 100,
          discountPercentage: Math.round(discPct * 100) / 100,
          totalDiscount: Math.round((p.totalDiscount || 0) * 100) / 100,
          totalAmount: Math.round(p.totalAmount * 100) / 100,
          gst: Math.round(gstAvg * 100) / 100,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    };

    const computeTotals = (products) => {
      const totalAmount = products.reduce((s, p) => s + (p.totalAmount || 0), 0);
      const totalDiscount = products.reduce((s, p) => s + (p.totalDiscount || 0), 0);
      const subtotal = totalAmount + totalDiscount;
      const discPct = subtotal > 0 ? (totalDiscount / subtotal) * 100 : 0;
      return {
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        totalDiscountPercentage: Math.round(discPct * 100) / 100,
      };
    };

    const missingOutletIds = [...outletDataMap.keys()].filter((id) => !outletMap.has(id));
    if (missingOutletIds.length > 0) {
      const missingDocs = await Promise.all(
        missingOutletIds.map((id) => db.collection('outlets').doc(id).get())
      );
      missingDocs.forEach((doc, i) => {
        const d = doc.exists ? doc.data() : {};
        outletMap.set(missingOutletIds[i], {
          name: d.name || d.outletName || 'Unknown Outlet',
          gstNo: d.gstNo || d.gst || d.gstin || '',
          billToPalace: d.billToPalace || '',
          state: d.state || '',
          address: d.address || '',
        });
      });
    }

    const globalProducts = buildProductList(globalProductMap);
    const globalTotals = computeTotals(globalProducts);

    const outletSummaries = [];
    const dateDocRef = db.collection('DailyProductReturn').doc(dateStr);
    const batch = db.batch();

    batch.set(dateDocRef, {
      date: dateStr,
      returnDate: dateStr,
      products: globalProducts,
      totalProducts: globalProducts.length,
      totalReturns,
      totalOutlets: outletDataMap.size,
      ...globalTotals,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'success',
    });

    for (const [outletId, entry] of outletDataMap) {
      const outletInfo = outletMap.get(outletId) || { name: 'Unknown Outlet', gstNo: '', billToPalace: '', state: '', address: '' };
      const outletName = outletInfo.name;
      const products = buildProductList(entry.productMap);
      const totals = computeTotals(products);

      const outletDocRef = dateDocRef.collection('outlets').doc(outletId);
      batch.set(outletDocRef, {
        outletId,
        outletName,
        gstNo: outletInfo.gstNo || '',
        billToPalace: outletInfo.billToPalace || '',
        state: outletInfo.state || '',
        address: outletInfo.address || '',
        date: dateStr,
        products,
        totalProducts: products.length,
        totalReturns: entry.returnCount,
        ...totals,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
      });

      outletSummaries.push({
        outletId,
        outletName,
        gstNo: outletInfo.gstNo || '',
        billToPalace: outletInfo.billToPalace || '',
        state: outletInfo.state || '',
        address: outletInfo.address || '',
        totalReturns: entry.returnCount,
        totalProducts: products.length,
        ...totals,
      });
    }

    await batch.commit();

    console.log(`✅ Stored ${globalProducts.length} return line-aggregated products from ${totalReturns} returns across ${outletDataMap.size} outlets for ${dateStr}`);

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
        // Create start of day (00:00:00) in UTC
        const [year, month, day] = date.split('-').map(Number);
        const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

        // Convert to Firestore Timestamps
        const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

        // Filter by timestamp range for the selected date
        query = query.where('timestamp', '>=', startTimestamp)
                     .where('timestamp', '<=', endTimestamp);
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

    // Parse opening balance date
    const [year, month, day] = openingBalanceDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Calculate previous date (one day before openingBalanceDate)
    const previousDate = new Date(startDate);
    previousDate.setDate(previousDate.getDate() - 1);
    previousDate.setHours(23, 59, 59, 999);
    
    const previousDateStr = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;
    const previousDateTimestamp = admin.firestore.Timestamp.fromDate(previousDate);

    // Get existing OutletOpeningClosingBalance documents for this outlet within date range only
    // Include previous date in the range to check if it exists
    const startOfRange = new Date(previousDate);
    startOfRange.setHours(0, 0, 0, 0);
    const endOfRange = new Date(today);
    endOfRange.setHours(23, 59, 59, 999);
    
    const startRangeTimestamp = admin.firestore.Timestamp.fromDate(startOfRange);
    const endRangeTimestamp = admin.firestore.Timestamp.fromDate(endOfRange);

    const existingBalancesSnapshot = await db.collection('OutletOpeningClosingBalance')
      .where('OutletID', '==', outletId)
      .where('timestamp', '>=', startRangeTimestamp)
      .where('timestamp', '<=', endRangeTimestamp)
      .get();

    // Create a map of existing documents by date for easy lookup
    const existingDocsByDate = new Map();
    existingBalancesSnapshot.forEach((doc) => {
      const data = doc.data();
      const docTimestamp = data.timestamp;
      
      if (docTimestamp) {
        // Convert to Date if it's a Firestore Timestamp
        const date = docTimestamp.toDate ? docTimestamp.toDate() : new Date(docTimestamp);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        existingDocsByDate.set(dateKey, { ref: doc.ref, id: doc.id });
      }
    });

    // Note: Payments use createdAt per day; collected returns use collectedDate (composite index on returns)

    // Set opening balance on the previous date (one day before openingBalanceDate)
    // This ensures the ledger report shows the correct opening balance
    const previousDoc = existingDocsByDate.get(previousDateStr);
    const previousCompletedAt = admin.firestore.Timestamp.now();

    if (previousDoc) {
      // Update existing document for previous date
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
      // Create new document for previous date
      const previousDocRef = db.collection('OutletOpeningClosingBalance').doc();
      await previousDocRef.set({
        OutletID: outletId,
        outletName,
        closingBalanceOrder: 0,
        closingBalancePayment: 0,
        closingBanlanceReturn: 0,
        totalClosingBalance: openingBalance,
        timestamp: previousDateTimestamp,
        completedAt: previousCompletedAt,
        status: 'success',
      });
      // Add to map for consistency
      existingDocsByDate.set(previousDateStr, { ref: previousDocRef, id: previousDocRef.id });
    }

    // Calculate balances for each date from openingBalanceDate to today
    const results = [];
    // Start with opening balance (which is now set as previous date's closing balance)
    let currentOpeningBalance = openingBalance;
    const currentDate = new Date(startDate);

    while (currentDate <= today) {
      // Get start and end of day timestamps
      const startOfDay = new Date(currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
      const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

      // Calculate date string for this iteration
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;
      const currentDay = currentDate.getDate();
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;

      // Query orders for this specific date (only delivered orders)
      const ordersSnapshot = await db.collection('orders')
        .where('outletId', '==', outletId)
        .where('status', '==', 'delivered')
        .where('Created at', '>=', startTimestamp)
        .where('Created at', '<=', endTimestamp)
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
        .where('collectedDate', '>=', startTimestamp)
        .where('collectedDate', '<=', endTimestamp)
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

      // Query payments for this specific date
      const paymentsSnapshot = await db.collection('payments')
        .where('outletId', '==', outletId)
        .where('status', '==', 'approved')
        .where('createdAt', '>=', startTimestamp)
        .where('createdAt', '<=', endTimestamp)
        .get();

      let closingBalancePayment = 0;
      const paymentsList = [];
      paymentsSnapshot.forEach((doc) => {
        const paymentData = doc.data();
        const paymentAmount = parseFloat(paymentData.amount || 0);
        const pid = paymentData.outletId || outletId;
        closingBalancePayment += paymentAmount;
        paymentsList.push({
          id: doc.id,
          outletId: pid,
          amount: paymentAmount,
          status: paymentData.status,
        });
      });

      // Calculate total closing balance
      const totalClosingBalance = currentOpeningBalance + closingBalanceOrder - closingBanlanceReturn - closingBalancePayment;

      const timestamp = admin.firestore.Timestamp.fromDate(endOfDay);
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

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
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

