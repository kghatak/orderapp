import admin from 'firebase-admin';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar day boundaries for a given instant. */
function getIstDayBoundaries(triggeredDate) {
  const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
  const targetYear = istDate.getUTCFullYear();
  const targetMonth = istDate.getUTCMonth();
  const targetDay = istDate.getUTCDate();
  const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);
  return {
    dateStr: `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
    dayStartTimestamp: admin.firestore.Timestamp.fromDate(startOfDayUTC),
    dayEndTimestamp: admin.firestore.Timestamp.fromDate(endOfDayUTC),
  };
}

/** IST day boundaries for a calendar date string YYYY-MM-DD. */
export function getIstBoundariesForCalendarDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return getIstDayBoundaries(noonUtc);
}

/** Inclusive IST report range from startDate through endDate (YYYY-MM-DD). */
export function getIstReportRangeTimestamps(startDate, endDate) {
  const startBounds = getIstBoundariesForCalendarDate(startDate);
  const endBounds = getIstBoundariesForCalendarDate(endDate);
  return {
    startTimestamp: startBounds.dayStartTimestamp,
    endTimestamp: endBounds.dayEndTimestamp,
  };
}
