export class OutletPaymentTransfer {
  constructor({
    fromOutletId,
    fromOutletName = '',
    toOutletId,
    toOutletName = '',
    amount,
    transferDateKey,
    remarks = '',
    createdBy = 'admin',
    performedBy = '',
    performedById = '',
    userProfile = '',
  }) {
    this.fromOutletId = fromOutletId;
    this.fromOutletName = fromOutletName;
    this.toOutletId = toOutletId;
    this.toOutletName = toOutletName;
    this.amount = amount;
    this.transferDateKey = transferDateKey;
    this.remarks = remarks || null;
    this.status = 'approved';
    this.createdBy = createdBy;
    this.performedBy = performedBy || createdBy;
    this.performedById = performedById || null;
    this.userProfile = userProfile || null;
  }
}
