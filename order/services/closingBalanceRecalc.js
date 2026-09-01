import admin from 'firebase-admin';
import {
  REPORT_ORDER_STATUSES,
  isReportOrderStatus,
} from '../constants/reportOrderStatuses.js';

const YMD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function parseIsoDateUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getIstDayBoundaries(triggeredDate) {
  const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
  const targetYear = istDate.getUTCFullYear();
  const targetMonth = istDate.getUTCMonth();
  const targetDay = istDate.getUTCDate();
  const startOfDayUTC = new Date(
    Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS,
  );
  const endOfDayUTC = new Date(
    Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS,
  );
  return {
    dateStr: `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
    dayStartTimestamp: admin.firestore.Timestamp.fromDate(startOfDayUTC),
    dayEndTimestamp: admin.firestore.Timestamp.fromDate(endOfDayUTC),
  };
}

function getIstDateKeyFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return getIstDayBoundaries(date).dateStr;
}

function getIstBoundariesForCalendarDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return getIstDayBoundaries(noonUtc);
}

function addDaysToDateStr(dateStr, deltaDays) {
  const d = parseIsoDateUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

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

export const CLOSING_BALANCE_ORDER_STATUSES = REPORT_ORDER_STATUSES;

/**
 * Orders for one IST day: accepted or later, dated by acceptedDate.
 * Falls back to Created at when acceptedDate has not been backfilled yet.
 */
export async function fetchOrdersForClosingBalanceDay(
  db,
  outletId,
  dayStartTimestamp,
  dayEndTimestamp,
) {
  const countedIds = new Set();
  let closingBalanceOrder = 0;
  const ordersList = [];

  const addDoc = (doc) => {
    if (countedIds.has(doc.id)) return;
    const orderData = doc.data();
    if (!isReportOrderStatus(orderData.status)) return;
    countedIds.add(doc.id);
    const orderAmount = parseFloat(
      orderData['total amount'] || orderData.totalAmount || 0,
    );
    closingBalanceOrder += orderAmount;
    ordersList.push({
      id: doc.id,
      outletId: orderData.outletId || outletId,
      amount: orderAmount,
      status: orderData.status,
    });
  };

  const byAcceptedDate = await db
    .collection('orders')
    .where('outletId', '==', outletId)
    .where('status', 'in', REPORT_ORDER_STATUSES)
    .where('acceptedDate', '>=', dayStartTimestamp)
    .where('acceptedDate', '<=', dayEndTimestamp)
    .get();
  byAcceptedDate.forEach(addDoc);

  const byCreatedAt = await db
    .collection('orders')
    .where('outletId', '==', outletId)
    .where('status', 'in', REPORT_ORDER_STATUSES)
    .where('Created at', '>=', dayStartTimestamp)
    .where('Created at', '<=', dayEndTimestamp)
    .get();
  byCreatedAt.forEach((doc) => {
    if (doc.data().acceptedDate != null) return;
    addDoc(doc);
  });

  return { closingBalanceOrder, ordersList };
}

export const toIstDateKeyFromValue = (value) => {
  if (value == null) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return getIstDayBoundaries(date).dateStr;
};

export const getTodayIstDateStr = () => getIstDayBoundaries(new Date()).dateStr;

/**
 * When a backdated payment is saved, mark this outlet so midnight recasts
 * closing balances from that date (keeps the oldest pending date).
 */
export const markOutletClosingBalanceRecalcPending = async (db, outletId, fromDateStr) => {
  if (!outletId || !fromDateStr || !YMD_DATE_REGEX.test(fromDateStr)) return;

  const todayStr = getTodayIstDateStr();
  if (fromDateStr >= todayStr) return;

  const outletRef = db.collection('outlets').doc(outletId);
  const outletDoc = await outletRef.get();
  if (!outletDoc.exists) return;

  const outletData = outletDoc.data() || {};
  let start = fromDateStr;
  const openingBalanceDate = outletData.openingBalanceDate;
  if (
    openingBalanceDate &&
    YMD_DATE_REGEX.test(openingBalanceDate) &&
    start < openingBalanceDate
  ) {
    start = openingBalanceDate;
  }

  if (
    outletData.recalculate === 'pending' &&
    outletData.recalculateFromDate &&
    YMD_DATE_REGEX.test(outletData.recalculateFromDate) &&
    outletData.recalculateFromDate < start
  ) {
    start = outletData.recalculateFromDate;
  }

  await outletRef.update({
    recalculate: 'pending',
    recalculateFromDate: start,
    recalculateUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const markOutletClosingBalanceRecalcDone = async (db, outletId) => {
  if (!outletId) return;
  await db.collection('outlets').doc(outletId).update({
    recalculate: 'done',
    recalculateCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

/**
 * Recalculate OutletOpeningClosingBalance from fromDate through throughDate.
 */
export const recalculateOutletClosingBalancesRange = async (
  db,
  { outletId, fromDate, throughDate },
) => {
  const outletRef = db.collection('outlets').doc(outletId);
  const outletDoc = await outletRef.get();

  if (!outletDoc.exists) {
    throw new Error('Outlet not found');
  }

  const outletData = outletDoc.data();
  const outletName = outletData.name || outletData.outletName || '';
  const openingBalance = parseFloat(outletData.openingBalance) || 0;
  const openingBalanceDate = outletData.openingBalanceDate;

  if (!openingBalanceDate) {
    throw new Error(
      'Opening balance date not found for this outlet. Please set openingBalanceDate in the outlet collection.',
    );
  }
  if (!YMD_DATE_REGEX.test(openingBalanceDate)) {
    throw new Error('Invalid openingBalanceDate on outlet. Use YYYY-MM-DD format.');
  }
  if (!fromDate || !YMD_DATE_REGEX.test(fromDate)) {
    throw new Error('fromDate must be YYYY-MM-DD');
  }
  if (!throughDate || !YMD_DATE_REGEX.test(throughDate)) {
    throw new Error('throughDate must be YYYY-MM-DD');
  }

  const startDate = fromDate < openingBalanceDate ? openingBalanceDate : fromDate;
  if (startDate > throughDate) {
    return {
      outletId,
      outletName,
      openingBalance,
      openingBalanceDate,
      fromDate: startDate,
      throughDate,
      calculatedDates: 0,
      results: [],
      skipped: true,
    };
  }

  const writeAnchor = startDate === openingBalanceDate;
  const previousDateStr = addDaysToDateStr(openingBalanceDate, -1);
  const rangeStartStr = writeAnchor ? previousDateStr : addDaysToDateStr(startDate, -1);
  const rangeStartBounds = getIstBoundariesForCalendarDate(rangeStartStr);
  const throughBounds = getIstBoundariesForCalendarDate(throughDate);

  const existingBalancesSnapshot = await db
    .collection('OutletOpeningClosingBalance')
    .where('OutletID', '==', outletId)
    .where('timestamp', '>=', rangeStartBounds.dayStartTimestamp)
    .where('timestamp', '<=', throughBounds.dayEndTimestamp)
    .get();

  const existingDocsByDate = new Map();
  existingBalancesSnapshot.forEach((doc) => {
    const data = doc.data();
    const dateKey = getIstDateKeyFromTimestamp(data.timestamp);
    if (dateKey) {
      existingDocsByDate.set(dateKey, { ref: doc.ref, id: doc.id });
    }
  });

  const previousBounds = getIstBoundariesForCalendarDate(previousDateStr);

  if (writeAnchor) {
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
      existingDocsByDate.set(previousDateStr, {
        ref: previousDocRef,
        id: previousDocRef.id,
      });
    }
  }

  let currentOpeningBalance = openingBalance;
  if (!writeAnchor) {
    const fromBounds = getIstBoundariesForCalendarDate(startDate);
    const prevBalanceSnapshot = await db
      .collection('OutletOpeningClosingBalance')
      .where('OutletID', '==', outletId)
      .where('status', '==', 'success')
      .where('timestamp', '<', fromBounds.dayStartTimestamp)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    currentOpeningBalance = prevBalanceSnapshot.empty
      ? 0
      : parseFloat(prevBalanceSnapshot.docs[0].data().totalClosingBalance || 0);
  }

  const results = [];
  let dateStr = startDate;

  while (dateStr <= throughDate) {
    if (dateStr === previousDateStr) {
      dateStr = addDaysToDateStr(dateStr, 1);
      continue;
    }

    const { dayStartTimestamp, dayEndTimestamp } =
      getIstBoundariesForCalendarDate(dateStr);

    if (dateStr === openingBalanceDate) {
      currentOpeningBalance = openingBalance;
    }

    const { closingBalanceOrder, ordersList } =
      await fetchOrdersForClosingBalanceDay(
        db,
        outletId,
        dayStartTimestamp,
        dayEndTimestamp,
      );

    const returnsSnapshot = await db
      .collection('returns')
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

    const { total: closingBalancePayment, paymentsList } =
      await fetchApprovedPaymentsForDay(
        db,
        outletId,
        dayStartTimestamp,
        dayEndTimestamp,
      );

    const totalClosingBalance =
      currentOpeningBalance +
      closingBalanceOrder -
      closingBanlanceReturn -
      closingBalancePayment;

    const timestamp = dayEndTimestamp;
    const completedAt = admin.firestore.Timestamp.now();
    const existingDoc = existingDocsByDate.get(dateStr);

    if (existingDoc) {
      await existingDoc.ref.update({
        closingBalanceOrder,
        closingBalancePayment,
        closingBanlanceReturn,
        totalClosingBalance,
        completedAt,
        status: 'success',
        outletName,
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
      existingDocsByDate.set(dateStr, { ref: newDocRef, id: newDocRef.id });
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

    currentOpeningBalance = totalClosingBalance;
    dateStr = addDaysToDateStr(dateStr, 1);
  }

  return {
    outletId,
    outletName,
    openingBalance,
    openingBalanceDate,
    fromDate: startDate,
    throughDate,
    calculatedDates: results.length,
    results,
  };
};

export const processPendingClosingBalanceRecalcs = async (db, throughDate) => {
  const pendingSnap = await db
    .collection('outlets')
    .where('recalculate', '==', 'pending')
    .get();

  const summary = {
    total: pendingSnap.size,
    successful: 0,
    failed: 0,
    skipped: 0,
    outlets: [],
  };

  for (const doc of pendingSnap.docs) {
    const data = doc.data() || {};
    const fromDate = data.recalculateFromDate;
    if (!fromDate) {
      summary.skipped += 1;
      summary.outlets.push({
        outletId: doc.id,
        status: 'skipped',
        error: 'recalculateFromDate missing',
      });
      continue;
    }
    try {
      const result = await recalculateOutletClosingBalancesRange(db, {
        outletId: doc.id,
        fromDate,
        throughDate,
      });

      await markOutletClosingBalanceRecalcDone(db, doc.id);
      summary.successful += 1;
      summary.outlets.push({
        outletId: doc.id,
        status: result.skipped ? 'skipped' : 'done',
        fromDate: result.fromDate,
        calculatedDates: result.calculatedDates,
      });
      if (result.skipped) summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      summary.outlets.push({
        outletId: doc.id,
        status: 'failed',
        fromDate,
        error: error.message,
      });
      console.error(
        `[Closing balance recast] Failed for ${doc.id} from ${fromDate}:`,
        error.message,
      );
    }
  }

  return summary;
};
