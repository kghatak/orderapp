import express from 'express';
import {
  createUtensilReturn,
  getAllUtensilReturns,
  updateUtensilReturnStatus,
  archiveUtensilReturn,
} from '../controllers/utensilReturnController.js';

const router = express.Router();

router.post('/', createUtensilReturn);
router.get('/', getAllUtensilReturns);
router.put('/:id/status', updateUtensilReturnStatus);
router.delete('/:id', archiveUtensilReturn);

export default router;
