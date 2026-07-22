import express from 'express';
import { portalJwtMiddleware } from '../middleware/portalJwtMiddleware.js';
import {
  listWastages,
  createWastage,
  updateWastage,
  deleteWastage,
  acceptWastage,
  rejectWastage,
} from '../controllers/wastageController.js';

const router = express.Router();

router.get('/', portalJwtMiddleware, listWastages);
router.post('/', portalJwtMiddleware, createWastage);
router.patch('/:id/accept', portalJwtMiddleware, acceptWastage);
router.patch('/:id/reject', portalJwtMiddleware, rejectWastage);
router.patch('/:id', portalJwtMiddleware, updateWastage);
router.delete('/:id', portalJwtMiddleware, deleteWastage);

export default router;
