import express from 'express';
import { milkAuthMiddleware, requireRole } from '../../middleware/milkAuthMiddleware.js';
import { milkTenantMiddleware } from '../../middleware/milkTenantMiddleware.js';
import { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier } from '../controllers/supplierController.js';

const router = express.Router();

router.use(milkAuthMiddleware);
router.use(milkTenantMiddleware);

router.get('/', listSuppliers);
router.get('/:id', getSupplier);
router.post('/', requireRole('admin'), createSupplier);
router.put('/:id', requireRole('admin'), updateSupplier);
router.delete('/:id', requireRole('admin'), deleteSupplier);

export default router;
