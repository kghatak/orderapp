import express from 'express';
import { tenantMiddleware } from '../../util/tenantMiddleware.js';
import { requireOrderAdmin } from '../middleware/requireOrderAdmin.js';
import {
  addEventOrderPayment,
  createEventOrder,
  getEventOrder,
  getEventOrderSummary,
  listEventOrders,
  removeEventOrderPayment,
  updateEventOrder,
  updateEventOrderStatus,
} from '../controllers/eventOrderController.js';

const router = express.Router();

router.use(tenantMiddleware);
router.use(requireOrderAdmin);

router.get('/summary', getEventOrderSummary);
router.get('/', listEventOrders);
router.post('/', createEventOrder);
router.get('/:id', getEventOrder);
router.put('/:id', updateEventOrder);
router.patch('/:id/status', updateEventOrderStatus);
router.post('/:id/payments', addEventOrderPayment);
router.delete('/:id/payments/:paymentId', removeEventOrderPayment);

export default router;
