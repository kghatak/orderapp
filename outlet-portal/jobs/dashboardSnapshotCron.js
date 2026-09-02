import cron from 'node-cron';
import { isOutletPortalMongoConnected } from '../config/portalDb.js';
import { runEodDashboardSnapshot } from '../services/dashboardSnapshotService.js';

let cronTask = null;

export const startDashboardSnapshotCron = () => {
  if (process.env.DASHBOARD_SNAPSHOT_CRON_ENABLED === 'false') {
        return;
  }

  const schedule = process.env.DASHBOARD_SNAPSHOT_CRON || '10 0 * * *';

  cronTask = cron.schedule(
    schedule,
    async () => {
      if (!isOutletPortalMongoConnected()) {
        console.warn('[Dashboard EOD] Skipped — outlet portal MongoDB not connected');
        return;
      }

      try {
        await runEodDashboardSnapshot();
      } catch (err) {
        console.error('[Dashboard EOD] Cron failed:', err);
      }
    },
    { timezone: 'Asia/Kolkata' },
  );

  };

export const stopDashboardSnapshotCron = () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
};
