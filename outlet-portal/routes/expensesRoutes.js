import express from 'express';
import { portalJwtMiddleware } from '../middleware/portalJwtMiddleware.js';
import {
  createExpense,
  listExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
} from '../controllers/expensesController.js';

const router = express.Router();

router.get('/', portalJwtMiddleware, listExpenses);
router.post('/', portalJwtMiddleware, createExpense);
router.get('/:id', portalJwtMiddleware, getExpenseById);
router.patch('/:id', portalJwtMiddleware, updateExpense);
router.delete('/:id', portalJwtMiddleware, deleteExpense);

export default router;