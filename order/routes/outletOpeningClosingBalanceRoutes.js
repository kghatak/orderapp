// routes/outletOpeningClosingBalanceRoutes.js
import express from 'express';
import {
  getOutletOpeningClosingBalances,
  getOutletOpeningClosingBalanceById,
  calculateClosingBalances,
  calculateDailyOpeningClosingBalance,
  calculateDailyProductDelivery,
  calculateDailyProductReturn,
  getDailyProductDelivery,
  getDailyProductDeliveryXLSX,
  getDailyProductDeliveryCSV,
  getDailyProductReturn,
  getDailyProductReturnXLSX,
  getDailyProductReturnCSV,
  getPendingClosingBalanceRecalcs,
  runPendingClosingBalanceRecalcs,
} from '../controllers/outletOpeningClosingBalanceController.js';

const router = express.Router();

// Get all OutletOpeningClosingBalance records (with optional filters)
router.get('/', getOutletOpeningClosingBalances);

// Daily product delivery aggregation — stores products with qty by date
router.get('/daily-product-delivery/xlsx', getDailyProductDeliveryXLSX);
router.get('/daily-product-delivery/csv', getDailyProductDeliveryCSV);
router.get('/daily-product-delivery', getDailyProductDelivery);
router.post('/daily-product-delivery', calculateDailyProductDelivery);

// Daily product return aggregation (collected returns) — same shape as delivery
router.get('/daily-product-return/xlsx', getDailyProductReturnXLSX);
router.get('/daily-product-return/csv', getDailyProductReturnCSV);
router.get('/daily-product-return', getDailyProductReturn);
router.post('/daily-product-return', calculateDailyProductReturn);

// Calculate and update closing balances for an outlet
router.post('/calculate', calculateClosingBalances);

// Daily Opening/Closing Balance calculation for all active outlets
router.post('/calculate-opening-closing', calculateDailyOpeningClosingBalance);

// Manual trigger for midnight backdated-payment recast
router.get('/recalculate-pending', getPendingClosingBalanceRecalcs);
router.post('/recalculate-pending', runPendingClosingBalanceRecalcs);

// Get a specific OutletOpeningClosingBalance record by ID (keep last — wildcard)
router.get('/:id', getOutletOpeningClosingBalanceById);

export default router;

