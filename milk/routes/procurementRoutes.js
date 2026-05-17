import express from 'express';
import { milkAuthMiddleware, requireRole } from '../../middleware/milkAuthMiddleware.js';
import { milkTenantMiddleware } from '../../middleware/milkTenantMiddleware.js';
import {
  listProcurements,
  getProcurement,
  createProcurement,
  updateProcurement,
  deleteProcurement
} from '../controllers/procurementController.js';

const router = express.Router();

router.use(milkAuthMiddleware);
router.use(milkTenantMiddleware);

router.get('/', listProcurements);
router.get('/:id', getProcurement);
router.post('/', requireRole('admin'), createProcurement);
router.put('/:id', requireRole('admin'), updateProcurement);
router.delete('/:id', requireRole('admin'), deleteProcurement);

export default router;
