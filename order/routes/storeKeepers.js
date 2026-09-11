import express from 'express';
import { tenantMiddleware } from '../../util/tenantMiddleware.js';
import {
  createStoreKeeper,
  getAllStoreKeepers,
  getStoreKeeperById,
  updateStoreKeeper,
  searchStoreKeepers,
  deleteStoreKeeper
} from '../controllers/storeKeeperController.js';

const router = express.Router();

router.use(tenantMiddleware);
router.post('/', createStoreKeeper);
router.get('/', getAllStoreKeepers);
router.get('/search', searchStoreKeepers); // e.g., storekeepers/search?query=test
router.get('/:id', getStoreKeeperById);
router.patch('/:id', updateStoreKeeper);
router.delete('/:id', deleteStoreKeeper);

export default router;
