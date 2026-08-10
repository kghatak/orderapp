// controllers/paymentController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { getIstReportRangeTimestamps } from '../../util/istDateBoundaries.js';
import { OutletPayment, PaymentRequest, Payment } from '../models/Payment.js';
import admin from 'firebase-admin';
import ExcelJS from 'exceljs';

const toFirestoreTimestamp = (val) => {
  if (val == null) return null;
  if (val.toDate && typeof val.toDate === 'function') return val;
  if (typeof val === 'object' && val._seconds != null) {
    return new admin.firestore.Timestamp(val._seconds, val._nanoseconds || 0);
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : admin.firestore.Timestamp.fromDate(d);
};

// Helper to generate sequential payment IDs (PAY0001, PAY0002, ...)
const generatePaymentId = async (db) => {
  const counterRef = db.collection('counters').doc('paymentCounter');

  const nextCount = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let currentCount = 1;

    if (counterDoc.exists) {
      currentCount = (counterDoc.data().count || 0) + 1;
    }

    transaction.set(counterRef, { count: currentCount });
    return currentCount;
  });

  return `PAY${nextCount.toString().padStart(4, '0')}`;
};

// Create or Update Outlet Payment
export const createOutletPayment = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const outletPayment = new OutletPayment(req.body);
    await db.collection('outlet_payments').doc(outletPayment.outletId).set({ ...outletPayment });
    res.status(201).json({ message: 'Outlet payment created/updated' });
  } catch (err) {
    console.error('Create outlet payment error:', err);
    res.status(500).json({ error: 'Failed to create/update outlet payment' });
  }
};

// Create Payment Request
export const createPaymentRequest = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const paymentRequest = new PaymentRequest(req.body);
    const ref = await db.collection('payment_requests').add({ ...paymentRequest });
    res.status(201).json({ message: 'Payment request submitted', id: ref.id });
  } catch (err) {
    console.error('Create payment request error:', err);
    res.status(500).json({ error: 'Failed to submit payment request' });
  }
};

// Record Payment (Approved or Rejected)
export const createPayment = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const payment = new Payment(req.body);
    await db.collection('payments').doc(payment.paymentId).set({ ...payment });
    res.status(201).json({ message: 'Payment recorded' });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  }
};

// Get All Outlet Payments
export const getAllOutletPayments = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const snapshot = await db.collection('outlet_payments').get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(data);
  } catch (err) {
    console.error('Fetch outlet payments error:', err);
    res.status(500).json({ error: 'Failed to fetch outlet payments' });
  }
};

// Get All Payment Requests
export const getAllPaymentRequests = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const snapshot = await db.collection('payment_requests').get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(data);
  } catch (err) {
    console.error('Fetch payment requests error:', err);
    res.status(500).json({ error: 'Failed to fetch payment requests' });
  }
};

// Get All Payments (Approved/Rejected) - Exclude opening balance payments
export const getAllPayments = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const snapshot = await db.collection('payments').get();
    const data = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(payment => payment.paymentType !== 'opening_balance'); // Exclude opening balance payments
    res.status(200).json(data);
  } catch (err) {
    console.error('Fetch payments error:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

// Clean up existing opening balance payment records
export const cleanupOpeningBalancePayments = async (req, res) => {
  try {
    const db = getFirestoreDB();
    
    // Get all opening balance payment records
    const openingBalancePayments = await db.collection('payments')
      .where('paymentType', '==', 'opening_balance')
      .get();
    
    if (openingBalancePayments.empty) {
      return res.status(200).json({ 
        message: 'No opening balance payment records found to clean up',
        cleanedCount: 0
      });
    }
    
    // Delete all opening balance payment records
    const batch = db.batch();
    openingBalancePayments.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    console.log(`Cleaned up ${openingBalancePayments.size} opening balance payment records`);
    
    res.status(200).json({ 
      message: 'Opening balance payment records cleaned up successfully',
      cleanedCount: openingBalancePayments.size
    });
    
  } catch (err) {
    console.error('Cleanup opening balance payments error:', err);
    res.status(500).json({ error: 'Failed to cleanup opening balance payments' });
  }
};

// Get Outlets with Pending Payment Requests
export const getOutletsWithPendingRequests = async (req, res) => {
  try {
    const db = getFirestoreDB();
    
    // Get all pending payment requests from payment_requests collection only
    const requestsSnapshot = await db.collection('payment_requests')
      .where('status', '==', 'pending')
      .get();
    
    const paymentRequests = requestsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Group by outlet
    const outletMap = new Map();
    
    paymentRequests.forEach(request => {
      const outletId = request.outletId;
      if (!outletMap.has(outletId)) {
        outletMap.set(outletId, {
          outletId: outletId,
          outletName: request.outletName,
          totalPendingAmount: 0,
          requestCount: 0,
          requests: []
        });
      }
      
      const outlet = outletMap.get(outletId);
      outlet.totalPendingAmount += request.amount;
      outlet.requestCount += 1;
      outlet.requests.push({
        id: request.id,
        amount: request.amount,
        paymentMode: request.paymentMode,
        remarks: request.remarks,
        createdAt: request.createdAt
      });
    });
    
    const outlets = Array.from(outletMap.values());
    res.status(200).json(outlets);
  } catch (err) {
    console.error('Fetch outlets with pending requests error:', err);
    res.status(500).json({ error: 'Failed to fetch outlets with pending requests' });
  }
};

// Get All Payment Requests for Specific Outlet (Pending, Approved, Rejected)
export const getPendingRequestsByOutlet = async (req, res) => {
  try {
    const { outletId } = req.params;
    const db = getFirestoreDB();
    
    // Get pending payment requests from payment_requests collection
    const requestsSnapshot = await db.collection('payment_requests')
      .where('outletId', '==', outletId)
      .where('status', '==', 'pending')
      .get();
    
    const pendingRequests = requestsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));
    
    // Get approved/rejected payments from payments collection (exclude opening balance)
    const paymentsSnapshot = await db.collection('payments')
      .where('outletId', '==', outletId)
      .get();
    
    const payments = paymentsSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(payment => payment.paymentType !== 'opening_balance'); // Exclude opening balance payments
    
    // Create a map to track processed payments and avoid duplicates
    const processedPayments = new Map();
    const allRequests = [];
    
    // First, add all payments from payments collection (prioritize these)
    payments.forEach(payment => {
      allRequests.push(payment);
      // Mark this payment as processed using amount + timestamp as key
      const key = `${payment.amount}_${payment.createdAt._seconds || payment.createdAt}`;
      processedPayments.set(key, true);
    });
    
    // Then add pending requests that don't have a corresponding payment record
    pendingRequests.forEach(request => {
      const key = `${request.amount}_${request.createdAt._seconds || request.createdAt}`;
      if (!processedPayments.has(key)) {
        allRequests.push(request);
        processedPayments.set(key, true);
      }
    });
    
    // Additional check: If a payment exists in payments collection, 
    // update the corresponding request in payment_requests to match the status
    for (const payment of payments) {
      const matchingRequest = pendingRequests.find(req => 
        req.amount === payment.amount && 
        req.outletId === payment.outletId &&
        (req.createdAt._seconds === payment.createdAt._seconds || 
         Math.abs(new Date(req.createdAt).getTime() - new Date(payment.createdAt).getTime()) < 60000) // Within 1 minute
      );
      
      if (matchingRequest) {
        // Update the payment_requests document to match the payments collection status
        try {
          await db.collection('payment_requests').doc(matchingRequest.id).update({
            status: payment.status,
            approvedBy: payment.approvedBy,
            approvedAt: payment.approvedAt,
            rejectedBy: payment.rejectedBy,
            rejectedAt: payment.rejectedAt,
            remarks: payment.remarks
          });
        } catch (error) {
          console.log('Error updating payment request status:', error);
        }
      }
    }
    
    // Calculate totals for each status
    const approvedRequests = allRequests.filter(req => req.status === 'approved');
    const rejectedRequests = allRequests.filter(req => req.status === 'rejected');
    const finalPendingRequests = allRequests.filter(req => req.status === 'pending');
    
    const pendingAmount = finalPendingRequests.reduce((sum, req) => sum + req.amount, 0);
    const approvedAmount = approvedRequests.reduce((sum, req) => sum + req.amount, 0);
    const rejectedAmount = rejectedRequests.reduce((sum, req) => sum + req.amount, 0);
    const totalAmount = allRequests.reduce((sum, req) => sum + req.amount, 0);
    
    // Get outlet payment summary from outlet_payments collection
    const outletPaymentDoc = await db.collection('outlet_payments').doc(outletId).get();
    let outletSummary = {
      paidAmount: 0,
      pendingAmount: 0,
      totalAmount: 0
    };
    
    if (outletPaymentDoc.exists) {
      const outletPaymentData = outletPaymentDoc.data();
      const outletTotalAmount = outletPaymentData.totalAmount || 0;
      const outletPaidAmount = outletPaymentData.paidAmount || 0;
      // Recalculate pendingAmount to ensure accuracy: pendingAmount = totalAmount - paidAmount
      const outletPendingAmount = Math.max(0, outletTotalAmount - outletPaidAmount);
      
      outletSummary = {
        paidAmount: outletPaidAmount,
        pendingAmount: outletPendingAmount,
        totalAmount: outletTotalAmount
      };
    }
    
    res.status(200).json({
      outletId: outletId,
      requests: allRequests,
      summary: {
        total: {
          count: allRequests.length,
          amount: totalAmount
        },
        pending: {
          count: finalPendingRequests.length,
          amount: pendingAmount
        },
        approved: {
          count: approvedRequests.length,
          amount: approvedAmount
        },
        rejected: {
          count: rejectedRequests.length,
          amount: rejectedAmount
        }
      },
      outletSummary: outletSummary
    });
  } catch (err) {
    console.error('Fetch payment requests by outlet error:', err);
    res.status(500).json({ error: 'Failed to fetch payment requests for outlet' });
  }
};

// Approve Payment Request
export const approvePaymentRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { admin = 'admin', remarks = '' } = req.body;
    const db = getFirestoreDB();
    
    // Get the payment request
    const requestDoc = await db.collection('payment_requests').doc(requestId).get();
    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Payment request not found' });
    }
    
    const requestData = requestDoc.data();
    
    // Check if this outlet already has a paymentId assigned
    const existingPayment = await db.collection('payments')
      .where('outletId', '==', requestData.outletId)
      .limit(1)
      .get();
    
    let paymentId;
    
    if (!existingPayment.empty) {
      // Use existing paymentId for this outlet
      paymentId = existingPayment.docs[0].data().paymentId;
    } else {
      // Generate new paymentId for this outlet
      const counterRef = db.collection('counters').doc('paymentCounter');
      const counterDoc = await counterRef.get();
      
      let currentCount = 1;
      if (counterDoc.exists) {
        currentCount = counterDoc.data().count + 1;
      }
      
      // Generate payment ID in PAY0008 format
      paymentId = `PAY${currentCount.toString().padStart(4, '0')}`;
      
      // Update the counter
      await counterRef.set({ count: currentCount });
    }
    
    // Create approved payment record in payments collection (matching mobile app structure)
    const paymentData = {
      amount: requestData.amount,
      approvedAt: new Date(),
      approvedBy: admin,
      createdAt: requestData.createdAt,
      paymentDate:
        toFirestoreTimestamp(requestData.paymentDate || requestData.createdAt) ||
        admin.firestore.Timestamp.now(),
      outletId: requestData.outletId,
      outletName: requestData.outletName,
      paymentId: paymentId,
      paymentMode: requestData.paymentMode,
      remarks: remarks || requestData.remarks,
      status: 'approved'
    };
    
    // Use the original request ID as the document ID in payments collection
    await db.collection('payments').doc(requestId).set(paymentData);
    
    // Update outlet_payments collection
    const outletPaymentRef = db.collection('outlet_payments').doc(requestData.outletId);
    const outletPaymentDoc = await outletPaymentRef.get();
    
    if (outletPaymentDoc.exists) {
      const outletPaymentData = outletPaymentDoc.data();
      
      // Calculate new paid amount
      const newPaidAmount = outletPaymentData.paidAmount + requestData.amount;
      // Recalculate pending amount as totalAmount - paidAmount to ensure accuracy
      const newPendingAmount = Math.max(0, (outletPaymentData.totalAmount || 0) - newPaidAmount);
      
      // Update outlet payment data
      await outletPaymentRef.update({
        paidAmount: newPaidAmount,
        pendingAmount: newPendingAmount,
        requestStatus: 'approved',
        requestRemarks: remarks || '',
        lastUpdated: new Date(),
        paymentStatus: newPaidAmount >= (outletPaymentData.totalAmount || 0) ? 'paid' : 'partial'
      });
    } else {
      // Create new outlet payment record if it doesn't exist
      await outletPaymentRef.set({
        outletId: requestData.outletId,
        outletName: requestData.outletName,
        paidAmount: requestData.amount,
        pendingAmount: 0,
        totalAmount: requestData.amount,
        requestStatus: 'approved',
        requestRemarks: remarks || '',
        paymentId: paymentId,
        paymentMode: requestData.paymentMode,
        paymentStatus: 'paid',
        orderIds: [],
        requestedAmount: 0,
        createdAt: new Date(),
        lastUpdated: new Date(),
        lastRequestAmount: requestData.amount,
        lastRequestAt: new Date()
      });
    }
    
    res.status(200).json({ 
      message: 'Payment request approved successfully',
      requestId: requestId,
      paymentId: paymentId
    });
  } catch (err) {
    console.error('Approve payment request error:', err);
    res.status(500).json({ error: 'Failed to approve payment request' });
  }
};

// Record manual payment and update outlet pending amount
// Supports payment modes: 'Cash', 'Transfer by Bank', 'Cheque'
export const recordCashPayment = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const {
      outletId,
      amount,
      paymentMode = 'Cash', // Default to 'Cash' for backward compatibility
      remarks = '',
      approvedBy = 'admin',
      paymentDate,
    } = req.body;

    if (!outletId) {
      return res.status(400).json({ error: 'outletId is required' });
    }

    if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'A valid amount is required' });
    }

    const paymentAmount = parseFloat(amount);

    if (paymentAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    // Validate payment mode
    const validPaymentModes = ['Cash', 'Transfer by Bank', 'Cheque'];
    if (!validPaymentModes.includes(paymentMode)) {
      return res.status(400).json({ 
        error: `Invalid paymentMode. Must be one of: ${validPaymentModes.join(', ')}` 
      });
    }

    const outletPaymentRef = db.collection('outlet_payments').doc(outletId);
    const outletPaymentDoc = await outletPaymentRef.get();

    if (!outletPaymentDoc.exists) {
      return res.status(404).json({
        error: 'Outlet payment record not found for this outlet',
      });
    }

    const outletPaymentData = outletPaymentDoc.data();
    const outletName =
      outletPaymentData.outletName ||
      outletPaymentData.outlet ||
      outletPaymentData.name ||
      '';

    const paymentId = await generatePaymentId(db);
    const paymentDocRef = db.collection('payments').doc();

    let paymentDateTimestamp = null;
    if (paymentDate) {
      const parsedPaymentDate = new Date(paymentDate);
      if (isNaN(parsedPaymentDate.getTime())) {
        return res.status(400).json({ error: 'Invalid paymentDate provided' });
      }
      paymentDateTimestamp = admin.firestore.Timestamp.fromDate(parsedPaymentDate);
    }

    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    const paymentData = {
      paymentId,
      amount: paymentAmount,
      paymentMode: paymentMode,
      outletId,
      outletName,
      status: 'approved',
      approvedBy,
      approvedAt: serverTimestamp,
      createdAt: serverTimestamp,
      paymentDate: paymentDateTimestamp || serverTimestamp,
      remarks: remarks || null,
    };

    let updatedPendingAmount = 0;
    let updatedPaidAmount = 0;

    await db.runTransaction(async (transaction) => {
      const paymentSnapshot = await transaction.get(outletPaymentRef);

      if (!paymentSnapshot.exists) {
        throw new Error('Outlet payment record not found for this outlet');
      }

      const paymentSnapshotData = paymentSnapshot.data();
      const totalAmount = paymentSnapshotData.totalAmount || 0;
      const currentPaidAmount = paymentSnapshotData.paidAmount || 0;

      updatedPaidAmount = currentPaidAmount + paymentAmount;
      updatedPendingAmount = Math.max(0, totalAmount - updatedPaidAmount);

      transaction.update(outletPaymentRef, {
        paidAmount: updatedPaidAmount,
        pendingAmount: updatedPendingAmount,
        paymentStatus: updatedPendingAmount === 0 ? 'paid' : 'partial',
        lastUpdated: serverTimestamp,
        lastRequestAmount: paymentAmount,
        lastRequestAt: serverTimestamp,
      });

      transaction.set(paymentDocRef, paymentData);
    });

    const savedPaymentDoc = await paymentDocRef.get();
    const savedPaymentData = savedPaymentDoc.data();

    const savedPayment = savedPaymentDoc.exists ? savedPaymentDoc.data() : null;
    const createdAtTimestamp = savedPayment?.createdAt;
    const approvedAtTimestamp = savedPayment?.approvedAt;

    const paymentDateIso =
      savedPayment?.paymentDate && typeof savedPayment.paymentDate.toDate === 'function'
        ? savedPayment.paymentDate.toDate().toISOString()
        : null;

    const createdAt =
      createdAtTimestamp && typeof createdAtTimestamp.toDate === 'function'
        ? createdAtTimestamp.toDate().toISOString()
        : new Date().toISOString();

    const approvedAt =
      approvedAtTimestamp && typeof approvedAtTimestamp.toDate === 'function'
        ? approvedAtTimestamp.toDate().toISOString()
        : createdAt;

    const paymentModeMessages = {
      'Cash': 'Cash payment recorded successfully',
      'Transfer by Bank': 'Bank transfer payment recorded successfully',
      'Cheque': 'Cheque payment recorded successfully'
    };

    res.status(201).json({
      message: paymentModeMessages[paymentMode] || 'Payment recorded successfully',
      paymentId: savedPayment?.paymentId || paymentId,
      paymentDocId: paymentDocRef.id,
      outletId,
      outletName,
      amount: savedPayment?.amount ?? paymentAmount,
      paymentMode: savedPayment?.paymentMode ?? paymentMode,
      approvedBy: savedPayment?.approvedBy ?? approvedBy,
      approvedAt,
      createdAt,
      paymentDate: paymentDateIso,
      remarks: savedPayment?.remarks ?? remarks ?? null,
      pendingAmount: updatedPendingAmount,
      paidAmount: updatedPaidAmount,
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    if (error.message.includes('not found') || error.message.includes('Amount') || error.message.includes('paymentMode')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to record payment' });
  }
};

const VALID_PAYMENT_MODES = ['Cash', 'Transfer by Bank', 'Cheque'];

const normalizeHeader = (header) =>
  String(header || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '');

const getExcelCellString = (cell) => {
  if (!cell || cell.value == null && !cell.text) return '';
  if (cell.text) {
    return String(cell.text).replace(/^\uFEFF/, '').trim();
  }
  const value = cell.value;
  if (typeof value === 'object') {
    if (value.richText) {
      return value.richText.map((part) => part.text || '').join('').trim();
    }
    if (value.result != null) return String(value.result).trim();
    if (value.text != null) return String(value.text).trim();
  }
  return String(value).replace(/^\uFEFF/, '').trim();
};

const detectDelimiter = (line) => {
  const commas = (line.match(/,/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return '\t';
  if (semicolons > commas) return ';';
  return ',';
};

const parseDelimitedLine = (line, delimiter = ',') => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values.map((v) => v.replace(/^"|"$/g, '').trim());
};

const buildColumnMapFromHeaders = (headers) => {
  const columnMap = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized === 'paymentdate' || normalized === 'date' || normalized === 'paydate') {
      columnMap.paymentDate = index;
    }
    if (normalized === 'outletid' || normalized === 'outlet') columnMap.outletId = index;
    if (normalized === 'amount' || normalized === 'amt') columnMap.amount = index;
    if (normalized === 'paymentmode' || normalized === 'mode') columnMap.paymentMode = index;
    if (normalized === 'narration' || normalized === 'remarks' || normalized === 'remark') {
      columnMap.narration = index;
    }
  });

  return applyPositionalColumnMapFallback(headers, columnMap);
};

const applyPositionalColumnMapFallback = (headers, columnMap) => {
  const normalized = headers.map((h) => normalizeHeader(h));

  // Standard template: paymentDate, OutletId, amount, paymentMode, narration
  if (
    !columnMap.paymentDate &&
    normalized.length >= 4 &&
    normalized[1] === 'outletid' &&
    normalized[2] === 'amount' &&
    normalized[3] === 'paymentmode'
  ) {
    columnMap.paymentDate = 0;
    columnMap.outletId = columnMap.outletId ?? 1;
    columnMap.amount = columnMap.amount ?? 2;
    columnMap.paymentMode = columnMap.paymentMode ?? 3;
    if (normalized.length >= 5 && !columnMap.narration) {
      columnMap.narration = 4;
    }
  }

  return columnMap;
};

const assertRequiredPaymentColumns = (columnMap) => {
  const requiredColumns = ['paymentDate', 'outletId', 'amount', 'paymentMode'];
  const missingColumns = requiredColumns.filter((col) => columnMap[col] == null);
  if (missingColumns.length > 0) {
    throw new Error(
      `Missing required column(s): ${missingColumns.join(', ')}. Expected: paymentDate, OutletId, amount, paymentMode, narration`,
    );
  }
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar date YYYY-MM-DD in IST (avoids UTC shift on date-only values). */
const formatCalendarDateIST = (date) => {
  if (!date || Number.isNaN(date.getTime())) return '';
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Normalize any Date instant to UTC noon on its IST calendar day. */
const toIstCalendarUtcNoon = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 12, 0, 0, 0),
  );
};

const normalizePaymentMode = (mode) => {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'cash') return 'Cash';
  if (
    normalized === 'transfer by bank' ||
    normalized === 'bank' ||
    normalized === 'bank transfer' ||
    normalized === 'transfer'
  ) {
    return 'Transfer by Bank';
  }
  if (normalized === 'cheque' || normalized === 'check') return 'Cheque';
  return String(mode || '').trim();
};

const parseExcelCellDate = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIstCalendarUtcNoon(value);
  }
  if (typeof value === 'object' && value.toDate && typeof value.toDate === 'function') {
    return toIstCalendarUtcNoon(value.toDate());
  }

  const str = String(value).trim();

  // YYYY-MM-DD (recommended)
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const d = new Date(
      Date.UTC(
        parseInt(isoMatch[1], 10),
        parseInt(isoMatch[2], 10) - 1,
        parseInt(isoMatch[3], 10),
        12,
        0,
        0,
        0,
      ),
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  // DD-MM-YYYY or DD/MM/YYYY (common in India)
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const d = new Date(
      Date.UTC(
        parseInt(dmyMatch[3], 10),
        parseInt(dmyMatch[2], 10) - 1,
        parseInt(dmyMatch[1], 10),
        12,
        0,
        0,
        0,
      ),
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : toIstCalendarUtcNoon(parsed);
};

const parseRowValues = (values, columnMap, rowNumber) => {
  const paymentDateRaw = values[columnMap.paymentDate];
  const outletIdRaw = values[columnMap.outletId];
  const amountRaw = values[columnMap.amount];
  const paymentModeRaw = values[columnMap.paymentMode];
  const narrationRaw = columnMap.narration != null ? values[columnMap.narration] : '';

  const isEmpty =
    !paymentDateRaw &&
    !outletIdRaw &&
    !amountRaw &&
    !paymentModeRaw &&
    !narrationRaw;

  if (isEmpty) return null;

  const paymentDate = parseExcelCellDate(paymentDateRaw);
  const outletId = outletIdRaw != null ? String(outletIdRaw).trim() : '';
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : parseFloat(String(amountRaw || '').replace(/,/g, ''));
  const paymentMode = normalizePaymentMode(paymentModeRaw);
  const narration = narrationRaw != null ? String(narrationRaw).trim() : '';

  return {
    row: rowNumber,
    paymentDate,
    outletId,
    amount,
    paymentMode,
    narration,
  };
};

const parsePaymentCsvBuffer = (buffer) => {
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error('CSV file has no data rows');
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter);
  const columnMap = buildColumnMapFromHeaders(headers);
  assertRequiredPaymentColumns(columnMap);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseDelimitedLine(lines[i], delimiter);
    const row = parseRowValues(values, columnMap, i + 1);
    if (row) rows.push(row);
  }

  return rows;
};

const isCsvFile = (filename = '', mimetype = '') => {
  const lowerName = filename.toLowerCase();
  return (
    lowerName.endsWith('.csv') ||
    mimetype === 'text/csv' ||
    mimetype === 'application/csv'
  );
};

const parsePaymentFileBuffer = async (buffer, filename = '', mimetype = '') => {
  if (isCsvFile(filename, mimetype)) {
    return parsePaymentCsvBuffer(buffer);
  }
  return parsePaymentExcelBuffer(buffer);
};

const parsePaymentExcelBuffer = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('No worksheet found in the Excel file');
  }

  const headerRow = sheet.getRow(1);
  const headers = [];
  const cellCount = headerRow.cellCount || sheet.columnCount || 0;

  for (let col = 1; col <= cellCount; col++) {
    headers[col - 1] = getExcelCellString(headerRow.getCell(col));
  }

  const columnMap = buildColumnMapFromHeaders(headers);
  assertRequiredPaymentColumns(columnMap);

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const values = [];
    row.eachCell((cell, colNumber) => {
      values[colNumber - 1] = cell.value;
    });

    const parsedRow = parseRowValues(values, columnMap, rowNumber);
    if (parsedRow) rows.push(parsedRow);
  });

  return rows;
};

const validatePaymentRow = (row, { checkOutletExists = false, outletExistsSet = null } = {}) => {
  const errors = [];
  const data = {
    paymentDate: row.paymentDate ? formatCalendarDateIST(row.paymentDate) : '',
    outletId: row.outletId || '',
    amount: row.amount,
    paymentMode: row.paymentMode || '',
    narration: row.narration || '',
  };

  if (!row.paymentDate) {
    errors.push('Invalid or missing payment date');
  }
  if (!row.outletId) {
    errors.push('OutletId is required');
  }
  if (row.amount === undefined || row.amount === null || Number.isNaN(row.amount)) {
    errors.push('Amount must be a valid number');
  } else if (row.amount <= 0) {
    errors.push('Amount must be greater than 0');
  }
  if (!row.paymentMode) {
    errors.push('Payment mode is required');
  } else if (!VALID_PAYMENT_MODES.includes(row.paymentMode)) {
    errors.push(`Invalid payment mode. Must be one of: ${VALID_PAYMENT_MODES.join(', ')}`);
  }
  if (checkOutletExists && row.outletId && outletExistsSet && !outletExistsSet.has(row.outletId)) {
    errors.push('Outlet payment record not found for this outlet');
  }

  return {
    row: row.row,
    data,
    isValid: errors.length === 0,
    errors,
  };
};

const recordPaymentForOutlet = async (db, {
  outletId,
  amount,
  paymentMode,
  remarks = '',
  approvedBy = 'admin',
  paymentDate,
}) => {
  const paymentAmount = parseFloat(amount);
  if (!outletId) {
    throw new Error('outletId is required');
  }
  if (Number.isNaN(paymentAmount) || paymentAmount <= 0) {
    throw new Error('A valid amount greater than 0 is required');
  }
  if (!VALID_PAYMENT_MODES.includes(paymentMode)) {
    throw new Error(`Invalid paymentMode. Must be one of: ${VALID_PAYMENT_MODES.join(', ')}`);
  }

  const outletPaymentRef = db.collection('outlet_payments').doc(outletId);
  const outletPaymentDoc = await outletPaymentRef.get();
  if (!outletPaymentDoc.exists) {
    throw new Error('Outlet payment record not found for this outlet');
  }

  const outletPaymentData = outletPaymentDoc.data();
  const outletName =
    outletPaymentData.outletName ||
    outletPaymentData.outlet ||
    outletPaymentData.name ||
    '';

  const paymentId = await generatePaymentId(db);
  const paymentDocRef = db.collection('payments').doc();

  let paymentDateTimestamp = null;
  if (paymentDate) {
    const parsedPaymentDate =
      paymentDate instanceof Date ? paymentDate : parseExcelCellDate(paymentDate);
    if (!parsedPaymentDate || Number.isNaN(parsedPaymentDate.getTime())) {
      throw new Error('Invalid paymentDate provided');
    }
    paymentDateTimestamp = admin.firestore.Timestamp.fromDate(parsedPaymentDate);
  }

  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  const paymentData = {
    paymentId,
    amount: paymentAmount,
    paymentMode,
    outletId,
    outletName,
    status: 'approved',
    approvedBy,
    approvedAt: serverTimestamp,
    createdAt: serverTimestamp,
    paymentDate: paymentDateTimestamp || serverTimestamp,
    remarks: remarks || null,
  };

  await db.runTransaction(async (transaction) => {
    const paymentSnapshot = await transaction.get(outletPaymentRef);
    if (!paymentSnapshot.exists) {
      throw new Error('Outlet payment record not found for this outlet');
    }

    const paymentSnapshotData = paymentSnapshot.data();
    const totalAmount = paymentSnapshotData.totalAmount || 0;
    const currentPaidAmount = paymentSnapshotData.paidAmount || 0;
    const updatedPaidAmount = currentPaidAmount + paymentAmount;
    const updatedPendingAmount = Math.max(0, totalAmount - updatedPaidAmount);

    transaction.update(outletPaymentRef, {
      paidAmount: updatedPaidAmount,
      pendingAmount: updatedPendingAmount,
      paymentStatus: updatedPendingAmount === 0 ? 'paid' : 'partial',
      lastUpdated: serverTimestamp,
      lastRequestAmount: paymentAmount,
      lastRequestAt: serverTimestamp,
    });

    transaction.set(paymentDocRef, paymentData);
  });

  return {
    paymentId,
    paymentDocId: paymentDocRef.id,
    outletId,
    outletName,
    amount: paymentAmount,
  };
};

const recalculateOutletBalancesUpdate = (outletData, deltaPaid) => {
  const totalAmount = outletData.totalAmount || 0;
  const newPaidAmount = Math.max(0, (outletData.paidAmount || 0) + deltaPaid);
  const newPendingAmount = Math.max(0, totalAmount - newPaidAmount);
  return {
    paidAmount: newPaidAmount,
    pendingAmount: newPendingAmount,
    paymentStatus: newPendingAmount === 0 ? 'paid' : newPaidAmount > 0 ? 'partial' : 'pending',
  };
};

// Update an approved payment or a pending payment request
export const updatePaymentRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      paymentMode,
      paymentDate,
      remarks,
      receivedAmount,
      updatedBy = 'admin',
    } = req.body;
    const db = getFirestoreDB();

    const paymentRef = db.collection('payments').doc(id);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists) {
      const existing = paymentDoc.data();
      if (existing.paymentType === 'opening_balance') {
        return res.status(400).json({ error: 'Cannot edit opening balance payment' });
      }
      if (existing.status !== 'approved') {
        return res.status(400).json({ error: 'Only approved payments can be edited' });
      }

      const oldAmount = Number(existing.receivedAmount ?? existing.amount) || 0;
      const newAmount = amount !== undefined
        ? parseFloat(amount)
        : (receivedAmount !== undefined ? parseFloat(receivedAmount) : oldAmount);

      if (Number.isNaN(newAmount) || newAmount <= 0) {
        return res.status(400).json({ error: 'A valid amount greater than 0 is required' });
      }

      const newPaymentMode = paymentMode || existing.paymentMode;
      if (paymentMode && !VALID_PAYMENT_MODES.includes(paymentMode)) {
        return res.status(400).json({
          error: `Invalid paymentMode. Must be one of: ${VALID_PAYMENT_MODES.join(', ')}`,
        });
      }

      let newPaymentDateTs = existing.paymentDate;
      if (paymentDate) {
        const parsed = new Date(paymentDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Invalid paymentDate provided' });
        }
        newPaymentDateTs = admin.firestore.Timestamp.fromDate(parsed);
      }

      const outletPaymentRef = db.collection('outlet_payments').doc(existing.outletId);
      const delta = newAmount - oldAmount;
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

      await db.runTransaction(async (transaction) => {
        const outletSnap = await transaction.get(outletPaymentRef);
        if (!outletSnap.exists) {
          throw new Error('Outlet payment record not found for this outlet');
        }

        const balanceUpdate = recalculateOutletBalancesUpdate(outletSnap.data(), delta);
        transaction.update(outletPaymentRef, {
          ...balanceUpdate,
          lastUpdated: serverTimestamp,
        });

        transaction.update(paymentRef, {
          amount: newAmount,
          receivedAmount: newAmount,
          paymentMode: newPaymentMode,
          paymentDate: newPaymentDateTs,
          remarks: remarks !== undefined ? (remarks || null) : (existing.remarks ?? null),
          updatedBy,
          updatedAt: serverTimestamp,
        });
      });

      const requestRef = db.collection('payment_requests').doc(id);
      const requestDoc = await requestRef.get();
      if (requestDoc.exists) {
        await requestRef.update({
          amount: newAmount,
          paymentMode: newPaymentMode,
          remarks: remarks !== undefined ? (remarks || '') : (requestDoc.data().remarks || ''),
          paymentDate: newPaymentDateTs,
        });
      }

      return res.status(200).json({
        message: 'Payment updated successfully',
        id,
        amount: newAmount,
      });
    }

    const requestRef = db.collection('payment_requests').doc(id);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    const requestData = requestDoc.data();
    if (requestData.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending payment requests can be edited here' });
    }

    const updates = {};
    if (amount !== undefined) {
      const newAmount = parseFloat(amount);
      if (Number.isNaN(newAmount) || newAmount <= 0) {
        return res.status(400).json({ error: 'A valid amount greater than 0 is required' });
      }
      updates.amount = newAmount;
    }
    if (paymentMode) {
      if (!VALID_PAYMENT_MODES.includes(paymentMode)) {
        return res.status(400).json({
          error: `Invalid paymentMode. Must be one of: ${VALID_PAYMENT_MODES.join(', ')}`,
        });
      }
      updates.paymentMode = paymentMode;
    }
    if (remarks !== undefined) {
      updates.remarks = remarks || '';
    }
    if (paymentDate) {
      const parsed = new Date(paymentDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid paymentDate provided' });
      }
      updates.paymentDate = admin.firestore.Timestamp.fromDate(parsed);
    }
    updates.updatedBy = updatedBy;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await requestRef.update(updates);

    return res.status(200).json({
      message: 'Payment request updated successfully',
      id,
    });
  } catch (err) {
    console.error('Update payment record error:', err);
    if (err.message?.includes('not found')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to update payment record' });
  }
};

// Delete an approved payment or a pending payment request
export const deletePaymentRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const db = getFirestoreDB();

    const paymentRef = db.collection('payments').doc(id);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists) {
      const existing = paymentDoc.data();
      if (existing.paymentType === 'opening_balance') {
        return res.status(400).json({ error: 'Cannot delete opening balance payment' });
      }
      if (existing.status !== 'approved') {
        return res.status(400).json({ error: 'Only approved payments can be deleted' });
      }

      const oldAmount = Number(existing.receivedAmount ?? existing.amount) || 0;
      const outletPaymentRef = db.collection('outlet_payments').doc(existing.outletId);
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

      await db.runTransaction(async (transaction) => {
        const outletSnap = await transaction.get(outletPaymentRef);
        if (!outletSnap.exists) {
          throw new Error('Outlet payment record not found for this outlet');
        }

        const balanceUpdate = recalculateOutletBalancesUpdate(outletSnap.data(), -oldAmount);
        transaction.update(outletPaymentRef, {
          ...balanceUpdate,
          lastUpdated: serverTimestamp,
        });
        transaction.delete(paymentRef);
      });

      const requestRef = db.collection('payment_requests').doc(id);
      const requestDoc = await requestRef.get();
      if (requestDoc.exists) {
        await requestRef.delete();
      }

      return res.status(200).json({
        message: 'Payment deleted successfully',
        id,
      });
    }

    const requestRef = db.collection('payment_requests').doc(id);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    const requestData = requestDoc.data();
    if (requestData.status !== 'pending') {
      return res.status(400).json({
        error: 'Processed payment requests cannot be deleted from here',
      });
    }

    await requestRef.delete();

    return res.status(200).json({
      message: 'Payment request deleted successfully',
      id,
    });
  } catch (err) {
    console.error('Delete payment record error:', err);
    if (err.message?.includes('not found')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to delete payment record' });
  }
};


// Reject Payment Request
export const rejectPaymentRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { admin = 'admin', remarks = '' } = req.body;
    const db = getFirestoreDB();
    
    // Get the payment request
    const requestDoc = await db.collection('payment_requests').doc(requestId).get();
    if (!requestDoc.exists) {
      return res.status(404).json({ error: 'Payment request not found' });
    }
    
    const requestData = requestDoc.data();
    
    // Check if this outlet already has a paymentId assigned
    const existingPayment = await db.collection('payments')
      .where('outletId', '==', requestData.outletId)
      .limit(1)
      .get();
    
    let paymentId;
    
    if (!existingPayment.empty) {
      // Use existing paymentId for this outlet
      paymentId = existingPayment.docs[0].data().paymentId;
    } else {
      // Generate new paymentId for this outlet
      const counterRef = db.collection('counters').doc('paymentCounter');
      const counterDoc = await counterRef.get();
      
      let currentCount = 1;
      if (counterDoc.exists) {
        currentCount = counterDoc.data().count + 1;
      }
      
      // Generate payment ID in PAY0008 format
      paymentId = `PAY${currentCount.toString().padStart(4, '0')}`;
      
      // Update the counter
      await counterRef.set({ count: currentCount });
    }
    
    // Create rejected payment record in payments collection (matching mobile app structure)
    const paymentData = {
      amount: requestData.amount,
      createdAt: requestData.createdAt,
      outletId: requestData.outletId,
      outletName: requestData.outletName,
      paymentId: paymentId,
      paymentMode: requestData.paymentMode,
      rejectedAt: new Date(),
      rejectedBy: admin,
      remarks: remarks || requestData.remarks,
      status: 'rejected'
    };
    
    // Use the original request ID as the document ID in payments collection
    await db.collection('payments').doc(requestId).set(paymentData);
    
    // Update outlet_payments collection
    const outletPaymentRef = db.collection('outlet_payments').doc(requestData.outletId);
    const outletPaymentDoc = await outletPaymentRef.get();
    
    if (outletPaymentDoc.exists) {
      const outletPaymentData = outletPaymentDoc.data();
      
      // Update outlet payment data for rejection
      await outletPaymentRef.update({
        requestStatus: 'rejected',
        requestRemarks: remarks || '',
        lastUpdated: new Date(),
        lastRequestAmount: requestData.amount,
        lastRequestAt: new Date()
      });
    } else {
      // Create new outlet payment record if it doesn't exist
      await outletPaymentRef.set({
        outletId: requestData.outletId,
        outletName: requestData.outletName,
        paidAmount: 0,
        pendingAmount: requestData.amount,
        totalAmount: requestData.amount,
        requestStatus: 'rejected',
        requestRemarks: remarks || '',
        paymentId: paymentId,
        paymentMode: requestData.paymentMode,
        paymentStatus: 'pending',
        orderIds: [],
        requestedAmount: requestData.amount,
        createdAt: new Date(),
        lastUpdated: new Date(),
        lastRequestAmount: requestData.amount,
        lastRequestAt: new Date()
      });
    }
    
    res.status(200).json({ 
      message: 'Payment request rejected successfully',
      requestId: requestId,
      paymentId: paymentId
    });
  } catch (err) {
    console.error('Reject payment request error:', err);
    res.status(500).json({ error: 'Failed to reject payment request' });
  }
};

// Get Outlet Payment Summary
export const getOutletPaymentSummary = async (req, res) => {
  try {
    const { outletId } = req.params;
    const db = getFirestoreDB();
    
    // Get outlet payment summary from outlet_payments collection
    const outletPaymentDoc = await db.collection('outlet_payments').doc(outletId).get();
    
    if (!outletPaymentDoc.exists) {
      return res.status(404).json({ 
        error: 'Outlet payment summary not found',
        message: 'No payment data found for this outlet'
      });
    }
    
    const outletPaymentData = outletPaymentDoc.data();
    
    // Recalculate pendingAmount to ensure accuracy: pendingAmount = totalAmount - paidAmount
    const totalAmount = outletPaymentData.totalAmount || 0;
    const paidAmount = outletPaymentData.paidAmount || 0;
    const pendingAmount = Math.max(0, totalAmount - paidAmount);
    
    // Return only the essential payment amounts
    res.status(200).json({
      outletId: outletId,
      outletName: outletPaymentData.outletName,
      paidAmount: paidAmount,
      pendingAmount: pendingAmount,
      totalAmount: totalAmount
    });
  } catch (err) {
    console.error('Fetch outlet payment summary error:', err);
    res.status(500).json({ error: 'Failed to fetch outlet payment summary' });
  }
};

// Get All Outlet Payment Summaries
export const getAllOutletPaymentSummaries = async (req, res) => {
  try {
    const db = getFirestoreDB();
    
    // Get all outlet payment summaries
    const snapshot = await db.collection('outlet_payments').get();
    const outletSummaries = snapshot.docs.map(doc => ({
      outletId: doc.id,
      ...doc.data()
    }));
    
    res.status(200).json(outletSummaries);
  } catch (err) {
    console.error('Fetch all outlet payment summaries error:', err);
    res.status(500).json({ error: 'Failed to fetch outlet payment summaries' });
  }
};

// Get All Outlets with Pending Payments from outlet_payments collection
export const getOutletsWithPendingPayments = async (req, res) => {
  try {
    const db = getFirestoreDB();
    
    // Get all outlets with pending payments from outlet_payments collection
    const snapshot = await db.collection('outlet_payments')
      .where('pendingAmount', '>', 0)
      .get();
    
    const outletsWithPendingPayments = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        outletId: doc.id,
        outletName: data.outletName,
        pendingAmount: data.pendingAmount || 0,
        paidAmount: data.paidAmount || 0,
        totalAmount: data.totalAmount || 0,
        paymentStatus: data.paymentStatus || 'pending',
        requestStatus: data.requestStatus || 'pending',
        paymentId: data.paymentId || '',
        lastUpdated: data.lastUpdated,
        lastRequestAt: data.lastRequestAt,
        lastRequestAmount: data.lastRequestAmount || 0
      };
    });
    
    // Calculate summary
    const totalOutlets = outletsWithPendingPayments.length;
    const totalPendingAmount = outletsWithPendingPayments.reduce((sum, outlet) => sum + outlet.pendingAmount, 0);
    const totalPaidAmount = outletsWithPendingPayments.reduce((sum, outlet) => sum + outlet.paidAmount, 0);
    
    res.status(200).json({
      outlets: outletsWithPendingPayments,
      summary: {
        totalOutlets: totalOutlets,
        totalPendingAmount: totalPendingAmount,
        totalPaidAmount: totalPaidAmount
      }
    });
  } catch (err) {
    console.error('Fetch outlets with pending payments error:', err);
    res.status(500).json({ error: 'Failed to fetch outlets with pending payments' });
  }
};

// Payments Report API
export const getPaymentsReport = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { 
      startDate, 
      endDate, 
      outletId, 
      page = 1, 
      limit = 20 
    } = req.query;

    // Validate required parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required parameters'
      });
    }

    // IST calendar day boundaries (matches opening/closing balance and ledger UI)
    const { startTimestamp, endTimestamp } = getIstReportRangeTimestamps(startDate, endDate);

    // Build query - only include approved payments
    let query = db.collection('payments')
      .where('status', '==', 'approved')
      .where('createdAt', '>=', startTimestamp)
      .where('createdAt', '<=', endTimestamp)
      .orderBy('createdAt', 'desc');

    // Add outlet filter if provided
    if (outletId) {
      query = query.where('outletId', '==', outletId);
    }

    // Get total count for pagination
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;
    const totalPages = Math.ceil(total / parseInt(limit));

    // Apply pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginatedQuery = query.offset(offset).limit(parseInt(limit));
    const snapshot = await paginatedQuery.get();

    // Process payments data
    const payments = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        paymentId: data.paymentId,
        outletId: data.outletId,
        outletName: data.outletName,
        status: data.status,
        paymentMode: data.paymentMode,
        amount: data.amount,
        paymentDate: data.paymentDate,
        remarks: data.remarks,
        createdAt: data.createdAt
      };
    });

    res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: totalPages
      }
    });

  } catch (error) {
    console.error('Payments report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate payments report',
      error: error.message
    });
  }
};

// Preview bulk payments from Excel file
export const previewBulkPayments = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const parsedRows = await parsePaymentFileBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    const db = getFirestoreDB();

    const outletIds = [...new Set(parsedRows.map((r) => r.outletId).filter(Boolean))];
    const outletExistsSet = new Set();

    for (const outletId of outletIds) {
      const doc = await db.collection('outlet_payments').doc(outletId).get();
      if (doc.exists) {
        outletExistsSet.add(outletId);
      }
    }

    const rows = parsedRows.map((row) =>
      validatePaymentRow(row, { checkOutletExists: true, outletExistsSet }),
    );

    res.status(200).json({
      message: 'File parsed successfully',
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((r) => r.isValid).length,
        invalid: rows.filter((r) => !r.isValid).length,
      },
    });
  } catch (err) {
    console.error('Preview bulk payments error:', err);
    res.status(400).json({
      error: err.message || 'Failed to parse file',
    });
  }
};

// Record bulk payments from JSON array
export const bulkRecordPayments = async (req, res) => {
  try {
    const { payments, approvedBy = 'admin' } = req.body;

    if (!payments || !Array.isArray(payments)) {
      return res.status(400).json({
        success: false,
        message: 'Request body must contain a "payments" array',
      });
    }

    if (payments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Payments array cannot be empty',
      });
    }

    const db = getFirestoreDB();
    const results = {
      total: payments.length,
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < payments.length; i++) {
      const paymentData = payments[i];
      const rowNumber = paymentData.row ?? i + 1;

      try {
        const paymentDate = paymentData.paymentDate
          ? parseExcelCellDate(paymentData.paymentDate)
          : null;
        const outletId = String(paymentData.outletId || '').trim();
        const amount = parseFloat(paymentData.amount);
        const paymentMode = normalizePaymentMode(paymentData.paymentMode);
        const narration = paymentData.narration || paymentData.remarks || '';

        const validation = validatePaymentRow({
          row: rowNumber,
          paymentDate,
          outletId,
          amount,
          paymentMode,
          narration,
        });

        if (!validation.isValid) {
          results.errors.push({
            row: rowNumber,
            outletId,
            error: validation.errors.join('; '),
          });
          results.failed++;
          continue;
        }

        await recordPaymentForOutlet(db, {
          outletId,
          amount,
          paymentMode,
          remarks: narration,
          approvedBy,
          paymentDate,
        });

        results.successful++;
      } catch (rowError) {
        results.errors.push({
          row: rowNumber,
          outletId: paymentData.outletId,
          error: rowError.message || 'Failed to record payment',
        });
        results.failed++;
      }
    }

    res.status(200).json({
      message: `Bulk payment completed: ${results.successful} successful, ${results.failed} failed`,
      summary: {
        total: results.total,
        successful: results.successful,
        failed: results.failed,
      },
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (err) {
    console.error('Bulk record payments error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk payments',
      error: err.message,
    });
  }
};
