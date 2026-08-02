import express from 'express';
import {
  createDashboardSnapshot,
  getDashboard,
  listDashboardSnapshotDates,
} from '../controllers/dashboardController.js';

const router = express.Router();

router.get('/', getDashboard);
router.get('/snapshots', listDashboardSnapshotDates);
router.post('/snapshot', createDashboardSnapshot);

export default router;
