import express from 'express';
import { tenantMiddleware } from '../../util/tenantMiddleware.js';
import {
  createUtensil,
  getUtensilById,
  getAllUtensils,
  updateUtensil,
  deleteUtensil,
} from '../controllers/utensilController.js';

const router = express.Router();

router.use(tenantMiddleware);
router.post('/', createUtensil);
router.get('/', getAllUtensils);
router.get('/:id', getUtensilById);
router.patch('/:id', updateUtensil);
router.delete('/:id', deleteUtensil);

export default router;
