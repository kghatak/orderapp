// controllers/paymentController.js
import { getFirestoreDB } from '../util/firebase.js';
import { OutletPayment, PaymentRequest, Payment } from '../models/Payment.js';
import admin from 'firebase-admin';

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

// Record manual cash payment and update outlet pending amount
export const recordCashPayment = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const {
      outletId,
      amount,
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
      paymentMode: 'cash',
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

    res.status(201).json({
      message: 'Cash payment recorded successfully',
      paymentId: savedPayment?.paymentId || paymentId,
      paymentDocId: paymentDocRef.id,
      outletId,
      outletName,
      amount: savedPayment?.amount ?? paymentAmount,
      paymentMode: savedPayment?.paymentMode ?? 'cash',
      approvedBy: savedPayment?.approvedBy ?? approvedBy,
      approvedAt,
      createdAt,
      paymentDate: paymentDateIso,
      remarks: savedPayment?.remarks ?? remarks ?? null,
      pendingAmount: updatedPendingAmount,
      paidAmount: updatedPaidAmount,
    });
  } catch (error) {
    console.error('Error recording cash payment:', error);
    if (error.message.includes('not found') || error.message.includes('Amount')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to record cash payment' });
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

    // Convert dates to Firestore timestamps
    const startTimestamp = admin.firestore.Timestamp.fromDate(new Date(startDate + 'T00:00:00.000Z'));
    const endTimestamp = admin.firestore.Timestamp.fromDate(new Date(endDate + 'T23:59:59.999Z'));

    // Build query
    let query = db.collection('payments')
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
        outletName: data.outletName,
        status: data.status,
        paymentMode: data.paymentMode,
        amount: data.amount,
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
