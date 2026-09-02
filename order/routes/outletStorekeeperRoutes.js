import express from 'express';
import {
  getOutletStorekeepers,
  createOutletStorekeeper,
  updateOutletStorekeeper,
  deleteOutletStorekeeper,
} from '../controllers/outletStorekeeperController.js';

const router = express.Router();

router.get('/', getOutletStorekeepers);
router.post('/', createOutletStorekeeper);
router.patch('/:id', updateOutletStorekeeper);
router.delete('/:id', deleteOutletStorekeeper);

export default router;
