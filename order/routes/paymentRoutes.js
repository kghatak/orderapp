// routes/paymentRoutes.js
import express from 'express';
import multer from 'multer';
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
  updatePaymentRecord,
  deletePaymentRecord,
  previewBulkPayments,
  bulkRecordPayments,
  getPaymentsTallyXLSX,
} from '../controllers/paymentController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lowerName = file.originalname.toLowerCase();
    const allowed =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv' ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.csv');
    if (allowed) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) or CSV (.csv) files are allowed'));
    }
  },
});

// Payment records
router.get('/', getAllPayments); // GET /payments
router.get('/report', getPaymentsReport); // GET /payments/report
router.get('/tally/xlsx', getPaymentsTallyXLSX); // GET /payments/tally/xlsx
router.post('/', createPayment); // POST /payments
router.post('/cash', recordCashPayment); // POST /payments/cash (supports paymentMode: 'cash', 'Transfer by Bank', 'Cheque')

// Bulk payment upload
router.post('/bulk/preview', upload.single('file'), previewBulkPayments); // POST /payments/bulk/preview
router.post('/bulk', bulkRecordPayments); // POST /payments/bulk

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
router.put('/:id', updatePaymentRecord); // PUT /payments/:id
router.delete('/:id', deletePaymentRecord); // DELETE /payments/:id

// Outlet payment summary endpoints
router.get('/outlet-summary/:outletId', getOutletPaymentSummary); // GET /payments/outlet-summary/:outletId
router.get('/outlet-summaries', getAllOutletPaymentSummaries); // GET /payments/outlet-summaries

// Outlets with pending payments from outlet_payments collection
router.get('/outlets-pending-payments', getOutletsWithPendingPayments); // GET /payments/outlets-pending-payments

// Cleanup opening balance payment records
router.delete('/cleanup-opening-balance', cleanupOpeningBalancePayments); // DELETE /payments/cleanup-opening-balance

export default router;
