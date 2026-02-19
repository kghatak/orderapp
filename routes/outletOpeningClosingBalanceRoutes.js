// routes/outletOpeningClosingBalanceRoutes.js
import express from 'express';
import {
  getOutletOpeningClosingBalances,
  getOutletOpeningClosingBalanceById,
  calculateClosingBalances,
  calculateDailyOpeningClosingBalance,
} from '../controllers/outletOpeningClosingBalanceController.js';

const router = express.Router();

// Get all OutletOpeningClosingBalance records (with optional filters)
router.get('/', getOutletOpeningClosingBalances);

// Get a specific OutletOpeningClosingBalance record by ID
router.get('/:id', getOutletOpeningClosingBalanceById);

// Calculate and update closing balances for an outlet
router.post('/calculate', calculateClosingBalances);

// Daily Opening/Closing Balance calculation for all active outlets
// Called by Firebase Cloud Function scheduler at 6:00 AM IST
router.post('/calculate-opening-closing', calculateDailyOpeningClosingBalance);

export default router;

