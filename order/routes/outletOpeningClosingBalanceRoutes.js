// routes/outletOpeningClosingBalanceRoutes.js
import express from 'express';
import {
  getOutletOpeningClosingBalances,
  getOutletOpeningClosingBalanceById,
  calculateClosingBalances,
  calculateDailyOpeningClosingBalance,
  calculateDailyProductDelivery,
  getDailyProductDelivery,
} from '../controllers/outletOpeningClosingBalanceController.js';

const router = express.Router();

// Get all OutletOpeningClosingBalance records (with optional filters)
router.get('/', getOutletOpeningClosingBalances);

// Daily product delivery aggregation — stores products with qty by date
router.get('/daily-product-delivery', getDailyProductDelivery);
router.post('/daily-product-delivery', calculateDailyProductDelivery);

// Calculate and update closing balances for an outlet
router.post('/calculate', calculateClosingBalances);

// Daily Opening/Closing Balance calculation for all active outlets
router.post('/calculate-opening-closing', calculateDailyOpeningClosingBalance);

// Get a specific OutletOpeningClosingBalance record by ID (keep last — wildcard)
router.get('/:id', getOutletOpeningClosingBalanceById);

export default router;

