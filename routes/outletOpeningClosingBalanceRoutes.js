// routes/outletOpeningClosingBalanceRoutes.js
import express from 'express';
import {
  getOutletOpeningClosingBalances,
  getOutletOpeningClosingBalanceById,
} from '../controllers/outletOpeningClosingBalanceController.js';

const router = express.Router();

// Get all OutletOpeningClosingBalance records (with optional filters)
router.get('/', getOutletOpeningClosingBalances);

// Get a specific OutletOpeningClosingBalance record by ID
router.get('/:id', getOutletOpeningClosingBalanceById);

export default router;

