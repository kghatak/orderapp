import express from 'express';
import {
  createDashboardSnapshot,
  getDashboard,
  listDashboardSnapshotDates,
} from '../controllers/dashboardController.js';
import { tenantMiddleware } from '../../util/tenantMiddleware.js';

const router = express.Router();

router.get('/', tenantMiddleware, getDashboard);
router.get('/snapshots', tenantMiddleware, listDashboardSnapshotDates);
router.post('/snapshot', createDashboardSnapshot);

export default router;
