import express from 'express';
import { viewBill, downloadBillPdf } from '../controllers/billController.js';

const router = express.Router();

/** Public bill routes — no JWT required (secured by unguessable billToken). */
router.get('/:token/pdf', downloadBillPdf);
router.get('/:token', viewBill);

export default router;
