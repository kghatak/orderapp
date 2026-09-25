import { getFirestoreDB } from '../../util/firebase.js';
import admin from 'firebase-admin';
import { getIstBoundariesForCalendarDate } from '../../util/istDateBoundaries.js';
import {
  getTodayIstDateStr,
  markOutletClosingBalanceRecalcPending,
  recalculateOutletClosingBalancesRange,
} from '../services/closingBalanceRecalc.js';
import { belongsToTenant, denyUnlessTenant } from '../../util/tenantMiddleware.js';

const TRANSFERS_COLLECTION = 'outlet_payment_transfers';

const roundMoney2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const serializeTimestamp = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value._seconds != null) {
    return new Date(value._seconds * 1000).toISOString();
  }
  return value;
};

const FORMATTED_TRANSFER_ID_REGEX = /^TRF\d+$/i;

const getFormattedTransferId = (id, data = {}) => {
  const candidates = [data.transferId, data.id, id];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (FORMATTED_TRANSFER_ID_REGEX.test(text)) {
      return text.toUpperCase();
    }
  }
  return '';
};

const serializeTransfer = (id, data = {}) => ({
  id,
  transferId: getFormattedTransferId(id, data) || null,
  fromOutletId: data.fromOutletId,
  fromOutletName: data.fromOutletName,
  toOutletId: data.toOutletId,
  toOutletName: data.toOutletName,
  amount: Number(data.amount) || 0,
  transferDate: serializeTimestamp(data.transferDate) || data.transferDateKey,
  transferDateKey: data.transferDateKey,
  remarks: data.remarks || null,
  status: data.status || 'approved',
  createdBy: data.createdBy || null,
  createdAt: serializeTimestamp(data.createdAt),
  performedBy: data.performedBy || null,
  performedById: data.performedById || null,
  userProfile: data.userProfile || null,
  cancelledBy: data.cancelledBy || null,
  cancelledAt: serializeTimestamp(data.cancelledAt),
  cancelReason: data.cancelReason || null,
  tenantId: data.tenantId || '',
});

const unclampedPending = (data) => {
  if (!data) return null;
  return roundMoney2((Number(data.totalAmount) || 0) - (Number(data.paidAmount) || 0));
};

const paymentStatusForPending = (pendingAmount, paidAmount) => {
  if (pendingAmount > 0) return paidAmount > 0 ? 'partial' : 'pending';
  return 'paid';
};

const outletPaymentUpdateFromOutstanding = (existing, outstanding) => {
  const totalAmount = Number(existing?.totalAmount) || 0;
  const pendingAmount = roundMoney2(outstanding);
  const paidAmount = roundMoney2(totalAmount - pendingAmount);
  return {
    pendingAmount,
    paidAmount,
    paymentStatus: paymentStatusForPending(pendingAmount, paidAmount),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };
};

const getCurrentOutletName = (data, fallbackId) =>
  data?.name || data?.outletName || fallbackId || '';

const getLatestClosingBalance = async (db, outletId) => {
  try {
    const snap = await db
      .collection('OutletOpeningClosingBalance')
      .where('OutletID', '==', outletId)
      .where('status', '==', 'success')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const value = parseFloat(snap.docs[0].data().totalClosingBalance);
    return Number.isFinite(value) ? roundMoney2(value) : null;
  } catch (error) {
    console.warn(`Could not read latest closing balance for ${outletId}:`, error.message);
    return null;
  }
};

const resolveOutstanding = (payData, outletData, closingBalance) => {
  if (closingBalance != null && Number.isFinite(closingBalance)) {
    return roundMoney2(closingBalance);
  }
  if (outletData?.openingBalance != null && Number.isFinite(Number(outletData.openingBalance))) {
    return roundMoney2(Number(outletData.openingBalance));
  }
  const pending = unclampedPending(payData);
  return pending != null ? pending : 0;
};

export const getOutletOutstanding = async (db, outletId, payData, outletData) => {
  const closingBalance = await getLatestClosingBalance(db, outletId);
  return resolveOutstanding(payData, outletData, closingBalance);
};

const generateTransferId = async (db) => {
  const counterRef = db.collection('counters').doc('outletPaymentTransferCounter');
  const nextCount = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    const currentCount = (counterDoc.exists ? counterDoc.data().count || 0 : 0) + 1;
    transaction.set(counterRef, { count: currentCount });
    return currentCount;
  });
  return `TRF${nextCount.toString().padStart(4, '0')}`;
};

const recastOutletsFromDate = async (db, outletIds, fromDateKey) => {
  const today = getTodayIstDateStr();
  const fromDate = fromDateKey < today ? fromDateKey : today;
  for (const outletId of outletIds) {
    try {
      await markOutletClosingBalanceRecalcPending(db, outletId, fromDateKey);
      await recalculateOutletClosingBalancesRange(db, {
        outletId,
        fromDate,
        throughDate: today,
      });
    } catch (error) {
      console.error(
        `Failed to recast closing balance for ${outletId} from ${fromDateKey}:`,
        error.message || error,
      );
    }
  }
};

export const createOutletPaymentTransfer = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const {
      fromOutletId,
      fromOutletName,
      toOutletId,
      toOutletName,
      amount,
      remarks = '',
      createdBy,
      performedBy,
      performedById,
      userProfile,
    } = req.body || {};

    if (!fromOutletId || !toOutletId) {
      return res.status(400).json({
        success: false,
        message: 'fromOutletId and toOutletId are required',
      });
    }
    if (String(fromOutletId) === String(toOutletId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to the same outlet',
      });
    }

    const transferAmount = roundMoney2(amount);
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid amount greater than 0 is required',
      });
    }

    const transferDateKey = getTodayIstDateStr();

    const fromOutletRef = db.collection('outlets').doc(fromOutletId);
    const toOutletRef = db.collection('outlets').doc(toOutletId);
    const [fromOutletDoc, toOutletDoc] = await Promise.all([
      fromOutletRef.get(),
      toOutletRef.get(),
    ]);

    if (!fromOutletDoc.exists) {
      return res.status(404).json({ success: false, message: 'Source outlet not found' });
    }
    if (denyUnlessTenant(res, fromOutletDoc.data().tenantId, req.tenantId, 'Source outlet not found')) {
      return;
    }
    if (!toOutletDoc.exists) {
      return res.status(404).json({ success: false, message: 'Destination outlet not found' });
    }
    if (denyUnlessTenant(res, toOutletDoc.data().tenantId, req.tenantId, 'Destination outlet not found')) {
      return;
    }

    const fromPayRef = db.collection('outlet_payments').doc(fromOutletId);
    const toPayRef = db.collection('outlet_payments').doc(toOutletId);
    const [fromPayDoc, toPayDoc] = await Promise.all([
      fromPayRef.get(),
      toPayRef.get(),
    ]);

    const fromOutstanding = await getOutletOutstanding(
      db,
      fromOutletId,
      fromPayDoc.exists ? fromPayDoc.data() : null,
      fromOutletDoc.data(),
    );
    const toOutstanding = await getOutletOutstanding(
      db,
      toOutletId,
      toPayDoc.exists ? toPayDoc.data() : null,
      toOutletDoc.data(),
    );

    if (fromOutstanding >= 0) {
      return res.status(400).json({
        success: false,
        message: 'Transfer is allowed only when this outlet has a credit (Cr) balance.',
      });
    }

    const availableAdvance = roundMoney2(Math.abs(fromOutstanding));
    if (transferAmount > availableAdvance + 0.001) {
      return res.status(400).json({
        success: false,
        message: `Amount cannot exceed available advance of ₹${availableAdvance.toLocaleString()}`,
      });
    }

    const resolvedFromName =
      fromOutletName || getCurrentOutletName(fromOutletDoc.data(), fromOutletId);
    const resolvedToName =
      toOutletName || getCurrentOutletName(toOutletDoc.data(), toOutletId);
    const actor = performedBy || createdBy || 'admin';
    const transferId = await generateTransferId(db);
    const transferRef = db.collection(TRANSFERS_COLLECTION).doc(transferId);
    const { dayStartTimestamp } = getIstBoundariesForCalendarDate(transferDateKey);
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    const fromNextPending = roundMoney2(fromOutstanding + transferAmount);
    const toNextPending = roundMoney2(toOutstanding - transferAmount);

    await db.runTransaction(async (transaction) => {
      const fromPaySnap = await transaction.get(fromPayRef);
      const toPaySnap = await transaction.get(toPayRef);

      const fromExisting = fromPaySnap.exists ? fromPaySnap.data() : {
        outletId: fromOutletId,
        outletName: resolvedFromName,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: fromOutstanding,
        createdAt: serverTimestamp,
      };
      const toExisting = toPaySnap.exists ? toPaySnap.data() : {
        outletId: toOutletId,
        outletName: resolvedToName,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: toOutstanding,
        createdAt: serverTimestamp,
      };

      transaction.set(
        fromPayRef,
        {
          ...fromExisting,
          outletId: fromOutletId,
          outletName: fromExisting.outletName || resolvedFromName,
          ...outletPaymentUpdateFromOutstanding(fromExisting, fromNextPending),
        },
        { merge: true },
      );
      transaction.set(
        toPayRef,
        {
          ...toExisting,
          outletId: toOutletId,
          outletName: toExisting.outletName || resolvedToName,
          ...outletPaymentUpdateFromOutstanding(toExisting, toNextPending),
        },
        { merge: true },
      );

      transaction.set(transferRef, {
        id: transferId,
        transferId,
        fromOutletId,
        fromOutletName: resolvedFromName,
        toOutletId,
        toOutletName: resolvedToName,
        amount: transferAmount,
        transferDate: dayStartTimestamp,
        transferDateKey,
        remarks: remarks ? String(remarks).trim() : null,
        status: 'approved',
        createdBy: actor,
        createdAt: serverTimestamp,
        performedBy: actor,
        performedById: performedById || null,
        userProfile: userProfile || null,
        tenantId: req.tenantId,
      });
    });

    await recastOutletsFromDate(db, [fromOutletId, toOutletId], transferDateKey);

    const saved = await transferRef.get();
    res.status(201).json({
      success: true,
      message: 'Advance transferred successfully',
      data: serializeTransfer(saved.id, saved.data()),
      fromPendingAmount: fromNextPending,
      toPendingAmount: toNextPending,
    });
  } catch (error) {
    console.error('Create outlet payment transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to transfer advance',
    });
  }
};

const matchesRequestTenant = (item, tenantId) =>
  !tenantId || belongsToTenant(item.tenantId, tenantId);

export const listTransfersForOutlet = async (db, outletId, filters = {}) => {
  if (!outletId) return [];
  const { startKey = null, endKey = null, status = null, tenantId = null } = filters;
  const [fromSnap, toSnap] = await Promise.all([
    db.collection(TRANSFERS_COLLECTION).where('fromOutletId', '==', String(outletId)).get(),
    db.collection(TRANSFERS_COLLECTION).where('toOutletId', '==', String(outletId)).get(),
  ]);
  const byId = new Map();
  fromSnap.docs.concat(toSnap.docs).forEach((doc) => byId.set(doc.id, doc));
  return [...byId.values()]
    .map((doc) => serializeTransfer(doc.id, doc.data()))
    .filter((item) => matchesRequestTenant(item, tenantId))
    .filter((item) => {
      if (status && String(item.status).toLowerCase() !== String(status).toLowerCase()) {
        return false;
      }
      const key = item.transferDateKey || String(item.transferDate || '').slice(0, 10);
      if (startKey && key < startKey) return false;
      if (endKey && key > endKey) return false;
      return true;
    })
    .sort((a, b) => String(b.transferDateKey || '').localeCompare(String(a.transferDateKey || '')));
};

export const getOutletPaymentTransfers = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { outletId, startDate, endDate, status } = req.query;
    const startKey = startDate ? String(startDate).slice(0, 10) : null;
    const endKey = endDate ? String(endDate).slice(0, 10) : null;

    let transfers = [];
    if (outletId) {
      transfers = await listTransfersForOutlet(db, outletId, {
        startKey,
        endKey,
        status,
        tenantId: req.tenantId,
      });
    } else {
      const snap = await db.collection(TRANSFERS_COLLECTION).get();
      transfers = snap.docs
        .map((doc) => serializeTransfer(doc.id, doc.data()))
        .filter((item) => matchesRequestTenant(item, req.tenantId))
        .filter((item) => {
          if (status && String(item.status).toLowerCase() !== String(status).toLowerCase()) {
            return false;
          }
          const key = item.transferDateKey || String(item.transferDate || '').slice(0, 10);
          if (startKey && key < startKey) return false;
          if (endKey && key > endKey) return false;
          return true;
        })
        .sort((a, b) => String(b.transferDateKey || '').localeCompare(String(a.transferDateKey || '')));
    }

    res.status(200).json({
      success: true,
      data: transfers,
    });
  } catch (error) {
    console.error('Fetch outlet payment transfers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfers',
    });
  }
};

export const cancelOutletPaymentTransfer = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { id } = req.params;
    const {
      cancelledBy,
      performedBy,
      performedById,
      userProfile,
      remarks,
      cancelReason,
    } = req.body || {};

    let transferRef = db.collection(TRANSFERS_COLLECTION).doc(id);
    let transferDoc = await transferRef.get();
    if (!transferDoc.exists) {
      const byTransferId = await db
        .collection(TRANSFERS_COLLECTION)
        .where('transferId', '==', id)
        .limit(1)
        .get();
      if (byTransferId.empty) {
        return res.status(404).json({ success: false, message: 'Transfer not found' });
      }
      transferDoc = byTransferId.docs[0];
      transferRef = transferDoc.ref;
    }

    const transfer = transferDoc.data();
    if (denyUnlessTenant(res, transfer.tenantId, req.tenantId, 'Transfer not found')) {
      return;
    }
    if (String(transfer.status || 'approved').toLowerCase() === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Transfer is already cancelled' });
    }

    const amount = roundMoney2(transfer.amount);
    const fromPayRef = db.collection('outlet_payments').doc(transfer.fromOutletId);
    const toPayRef = db.collection('outlet_payments').doc(transfer.toOutletId);
    const actor = cancelledBy || performedBy || 'admin';
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
      const fromPaySnap = await transaction.get(fromPayRef);
      const toPaySnap = await transaction.get(toPayRef);
      const fromExisting = fromPaySnap.exists ? fromPaySnap.data() : {};
      const toExisting = toPaySnap.exists ? toPaySnap.data() : {};
      const fromCurrent = unclampedPending(fromExisting) ?? 0;
      const toCurrent = unclampedPending(toExisting) ?? 0;

      if (fromPaySnap.exists) {
        transaction.set(
          fromPayRef,
          outletPaymentUpdateFromOutstanding(fromExisting, roundMoney2(fromCurrent - amount)),
          { merge: true },
        );
      }
      if (toPaySnap.exists) {
        transaction.set(
          toPayRef,
          outletPaymentUpdateFromOutstanding(toExisting, roundMoney2(toCurrent + amount)),
          { merge: true },
        );
      }

      transaction.update(transferRef, {
        status: 'cancelled',
        cancelledBy: actor,
        cancelledAt: serverTimestamp,
        cancelReason: cancelReason || remarks || null,
        performedBy: actor,
        performedById: performedById || null,
        userProfile: userProfile || null,
      });
    });

    await recastOutletsFromDate(
      db,
      [transfer.fromOutletId, transfer.toOutletId],
      transfer.transferDateKey,
    );

    const saved = await transferRef.get();
    res.status(200).json({
      success: true,
      message: 'Transfer cancelled',
      data: serializeTransfer(saved.id, saved.data()),
    });
  } catch (error) {
    console.error('Cancel outlet payment transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel transfer',
    });
  }
};
