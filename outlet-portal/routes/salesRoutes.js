import express from 'express';
import { portalJwtMiddleware } from '../middleware/portalJwtMiddleware.js';
import { createSale, listSales, getSaleById } from '../controllers/salesController.js';

const router = express.Router();

router.get('/', portalJwtMiddleware, listSales);
router.get('/:id', portalJwtMiddleware, getSaleById);
router.post('/', portalJwtMiddleware, createSale);

export default router;
