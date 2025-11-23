import express from 'express';
import {
  createUtensil,
  getUtensilById,
  getAllUtensils,
  updateUtensil,
  deleteUtensil,
} from '../controllers/utensilController.js';

const router = express.Router();

router.post('/', createUtensil);
router.get('/', getAllUtensils);
router.get('/:id', getUtensilById);
router.patch('/:id', updateUtensil);
router.delete('/:id', deleteUtensil);

export default router; 