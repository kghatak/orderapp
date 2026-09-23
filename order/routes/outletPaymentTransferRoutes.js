import express from 'express';
import {
  createOutletPaymentTransfer,
  getOutletPaymentTransfers,
  cancelOutletPaymentTransfer,
} from '../controllers/outletPaymentTransferController.js';

const router = express.Router();

router.post('/', createOutletPaymentTransfer);
router.get('/', getOutletPaymentTransfers);
router.put('/:id/cancel', cancelOutletPaymentTransfer);

export default router;
