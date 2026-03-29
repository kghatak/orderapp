import express from 'express';
import { portalJwtMiddleware } from '../middleware/portalJwtMiddleware.js';
import { createExpense, listExpenses, getExpenseById } from '../controllers/expensesController.js';

const router = express.Router();

router.get('/', portalJwtMiddleware, listExpenses);
router.get('/:id', portalJwtMiddleware, getExpenseById);
router.post('/', portalJwtMiddleware, createExpense);

export default router;