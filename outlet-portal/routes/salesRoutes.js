import express from 'express';
import { portalJwtMiddleware } from '../middleware/portalJwtMiddleware.js';
import {
  createSale,
  listSales,
  getSaleById,
  updateSale,
  resendSaleBillWhatsApp
} from '../controllers/salesController.js';

const router = express.Router();

router.get('/', portalJwtMiddleware, listSales);
router.post('/:id/send-bill', portalJwtMiddleware, resendSaleBillWhatsApp);
router.get('/:id', portalJwtMiddleware, getSaleById);
router.post('/', portalJwtMiddleware, createSale);
router.patch('/:id', portalJwtMiddleware, updateSale);

export default router;
