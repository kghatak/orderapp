import express from 'express';
import { milkAuthMiddleware, requireRole } from '../../middleware/milkAuthMiddleware.js';
import { milkTenantMiddleware } from '../../middleware/milkTenantMiddleware.js';
import { listPayments, getPayment, createPayment, paymentBalances } from '../controllers/milkPaymentController.js';

const router = express.Router();

router.use(milkAuthMiddleware);
router.use(milkTenantMiddleware);

router.get('/', listPayments);
router.get('/balances', requireRole('admin'), paymentBalances);
router.get('/:id', getPayment);
router.post('/', requireRole('admin'), createPayment);

export default router;
