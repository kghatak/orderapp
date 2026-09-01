/** Orders counted in reports and closing balance once accepted (not pending/cancelled). */
export const REPORT_ORDER_STATUSES = [
  'accepted',
  'partial accepted',
  'processing',
  'dispatched',
  'delivered',
];

export function isReportOrderStatus(status) {
  return REPORT_ORDER_STATUSES.includes(String(status || '').toLowerCase().trim());
}
