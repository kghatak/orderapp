// routes/paymentRoutes.js
import express from 'express';
import {
  createOutletPayment,
  createPaymentRequest,
  createPayment,
  getAllOutletPayments,
  getAllPaymentRequests,
  getAllPayments,
  getOutletsWithPendingRequests,
  getPendingRequestsByOutlet,
  approvePaymentRequest,
  rejectPaymentRequest,
  getOutletPaymentSummary,
  getAllOutletPaymentSummaries,
  getOutletsWithPendingPayments,
  cleanupOpeningBalancePayments,
  getPaymentsReport,
  recordCashPayment,
} from '../controllers/paymentController.js';

const router = express.Router();

// Payment records
router.get('/', getAllPayments); // GET /payments
router.get('/report', getPaymentsReport); // GET /payments/report
router.post('/', createPayment); // POST /payments
router.post('/cash', recordCashPayment); // POST /payments/cash

// Outlet Payments
router.post('/outlet-payment', createOutletPayment);
router.get('/outlet-payments', getAllOutletPayments);

// Payment Requests
router.get('/request', getAllPaymentRequests);
router.post('/request', createPaymentRequest);

// New endpoints for pending payment requests
router.get('/pending-outlets', getOutletsWithPendingRequests); // GET /payments/pending-outlets
router.get('/pending-outlets/:outletId', getPendingRequestsByOutlet); // GET /payments/pending-outlets/:outletId

// Payment approval/rejection endpoints
router.put('/request/:requestId/approve', approvePaymentRequest); // PUT /payments/request/:requestId/approve
router.put('/request/:requestId/reject', rejectPaymentRequest); // PUT /payments/request/:requestId/reject

// Outlet payment summary endpoints
router.get('/outlet-summary/:outletId', getOutletPaymentSummary); // GET /payments/outlet-summary/:outletId
router.get('/outlet-summaries', getAllOutletPaymentSummaries); // GET /payments/outlet-summaries

// Outlets with pending payments from outlet_payments collection
router.get('/outlets-pending-payments', getOutletsWithPendingPayments); // GET /payments/outlets-pending-payments

// Cleanup opening balance payment records
router.delete('/cleanup-opening-balance', cleanupOpeningBalancePayments); // DELETE /payments/cleanup-opening-balance

export default router;
