import express from 'express';
import {
  getOutletProductQuantityByIds,
  listOutletProductQuantities,
  migrateLegacyOutletProductQuantities
} from '../controllers/outletProductQuantitiesController.js';

const router = express.Router();

router.get('/', listOutletProductQuantities);
router.post('/migrate-legacy', migrateLegacyOutletProductQuantities);
router.get('/:outletId/:productId', getOutletProductQuantityByIds);

export default router;
