import express from 'express';
import { upsertOutletProducts, getOutletProductsByOutletId } from '../controllers/outletProductsController.js';

const router = express.Router();

router.get('/', getOutletProductsByOutletId);
router.post('/', upsertOutletProducts);

export default router;
