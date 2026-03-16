export class ReturnOrder {
  constructor({
    returnId,
    outletId,
    outlet,
    items,
    totalAmount,
    status = 'requested',
    includesDiscounts = false,
    notes = '',
    lastNotificationType = 'return_request_created',
    adminNotificationSent = false,
    archived = false,
    archivedAt = null,
  }) {
    this.returnId = returnId;
    this.outletId = outletId;
    this.outlet = outlet;
    this.items = items; // array of item objects
    this.totalAmount = totalAmount;
    this.status = status;
    this.includesDiscounts = includesDiscounts;
    this.notes = notes;
    this.lastNotificationType = lastNotificationType;
    this.lastNotificationSentAt = new Date();
    this.adminNotificationSent = adminNotificationSent;
    this.archived = archived;
    this.archivedAt = archivedAt;
    this.createdAt = new Date();
  }
}
export const ReturnOrderStatus = {
  CANCELLED: 'cancelled',
  REQUESTED: 'requested',
  APPROVED: 'approved',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  COLLECTED: 'collected',
};