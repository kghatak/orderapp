import express from 'express';
import { milkAuthMiddleware, requireRole } from '../../middleware/milkAuthMiddleware.js';
import { milkTenantMiddleware } from '../../middleware/milkTenantMiddleware.js';
import { dailySummary, supplierSummary, periodSummary } from '../controllers/milkReportController.js';

const router = express.Router();

router.use(milkAuthMiddleware);
router.use(milkTenantMiddleware);

router.get('/daily', requireRole('admin'), dailySummary);
router.get('/summary', requireRole('admin'), periodSummary);
router.get('/supplier', supplierSummary);

export default router;
