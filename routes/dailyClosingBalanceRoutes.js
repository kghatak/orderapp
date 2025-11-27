// routes/dailyClosingBalanceRoutes.js
import express from 'express';
import {
  calculateClosingBalance,
  getClosingBalance,
  backfillClosingBalances,
} from '../controllers/dailyClosingBalanceController.js';

const router = express.Router();

// Calculate daily closing balance for all outlets
router.post('/calculate', calculateClosingBalance);

// Backfill closing balances from starting date to today
router.post('/backfill', async (req, res) => {
  try {
    const result = await backfillClosingBalances();
    if (result.success) {
      res.status(200).json({
        message: 'Backfill completed successfully',
        ...result,
      });
    } else {
      res.status(500).json({
        error: 'Backfill failed',
        details: result.error,
      });
    }
  } catch (error) {
    console.error('Error in backfill endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get closing balance records
router.get('/', getClosingBalance);

export default router;

