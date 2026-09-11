// routes/outletOpeningClosingBalanceRoutes.js
import express from 'express';
import { tenantMiddleware, optionalTenantMiddleware } from '../../util/tenantMiddleware.js';
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
router.get('/', tenantMiddleware, getOutletOpeningClosingBalances);

// Daily product delivery aggregation — stores products with qty by date
router.get('/daily-product-delivery/xlsx', tenantMiddleware, getDailyProductDeliveryXLSX);
router.get('/daily-product-delivery/csv', tenantMiddleware, getDailyProductDeliveryCSV);
router.get('/daily-product-delivery', tenantMiddleware, getDailyProductDelivery);
router.post('/daily-product-delivery', optionalTenantMiddleware, calculateDailyProductDelivery);

// Daily product return aggregation (collected returns) — same shape as delivery
router.get('/daily-product-return/xlsx', tenantMiddleware, getDailyProductReturnXLSX);
router.get('/daily-product-return/csv', tenantMiddleware, getDailyProductReturnCSV);
router.get('/daily-product-return', tenantMiddleware, getDailyProductReturn);
router.post('/daily-product-return', optionalTenantMiddleware, calculateDailyProductReturn);

// Calculate and update closing balances for an outlet
router.post('/calculate', tenantMiddleware, calculateClosingBalances);

// Daily Opening/Closing Balance calculation for all active outlets
router.post('/calculate-opening-closing', optionalTenantMiddleware, calculateDailyOpeningClosingBalance);

// Manual trigger for midnight backdated-payment recast
router.get('/recalculate-pending', tenantMiddleware, getPendingClosingBalanceRecalcs);
router.post('/recalculate-pending', optionalTenantMiddleware, runPendingClosingBalanceRecalcs);

// Get a specific OutletOpeningClosingBalance record by ID (keep last — wildcard)
router.get('/:id', tenantMiddleware, getOutletOpeningClosingBalanceById);

export default router;
