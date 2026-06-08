import express from 'express';
import {
  upsertOutletProducts,
  getOutletProductsByOutletId,
  patchOutletProduct,
  repairMissingOutletProducts,
} from '../controllers/outletProductsController.js';

const router = express.Router();

router.get('/', getOutletProductsByOutletId);
router.post('/repair-missing', repairMissingOutletProducts);
router.post('/', upsertOutletProducts);
router.patch('/:productId', patchOutletProduct);

export default router;
