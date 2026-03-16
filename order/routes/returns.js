import express from 'express';
import {
  createReturn,
  getAllReturns,
  getReturnById,
  updateReturn,
  deleteReturn,
  getReturnsByStatus,
  getReturnsReport,
  updateReturnItems,
} from '../controllers/returnsController.js';

const router = express.Router();

router.post('/', createReturn);
router.get('/', getAllReturns);
router.get('/report', getReturnsReport);
router.get('/status', getReturnsByStatus); // e.g., ?status=requested
router.put('/:id/status', updateReturn); // Update status specifically
router.put('/:id/items', updateReturnItems); // Update items/quantities
router.get('/:id', getReturnById);
router.delete('/:id', deleteReturn); // archives instead of delete

export default router;
