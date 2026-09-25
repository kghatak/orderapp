import express from 'express';
import {
  createOutletPaymentTransfer,
  getOutletPaymentTransfers,
  cancelOutletPaymentTransfer,
} from '../controllers/outletPaymentTransferController.js';
import { tenantMiddleware } from '../../util/tenantMiddleware.js';

const router = express.Router();

router.use(tenantMiddleware);

router.post('/', createOutletPaymentTransfer);
router.get('/', getOutletPaymentTransfers);
router.put('/:id/cancel', cancelOutletPaymentTransfer);

export default router;
