import express from 'express';
import { portalJwtMiddleware } from '../middleware/portalJwtMiddleware.js';
import {
  upsertOutletProducts,
  getOutletProductsByOutletId,
  patchOutletProduct,
  repairMissingOutletProducts,
} from '../controllers/outletProductsController.js';

const router = express.Router();

router.use(portalJwtMiddleware);

router.get('/', getOutletProductsByOutletId);
router.post('/repair-missing', repairMissingOutletProducts);
router.post('/', upsertOutletProducts);
router.patch('/:productId', patchOutletProduct);

export default router;
