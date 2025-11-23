// models/Payment.js

export class OutletPayment {
  constructor({
    outletId,
    outletName,
    orderIds = [],
    paidAmount = 0,
    pendingAmount = 0,
    requestedAmount = 0,
    totalAmount = 0,
    paymentId = '',
    paymentStatus = 'pending',
    paymentMode = '',
    requestStatus = 'none',
    requestRemarks = '',
  }) {
    this.outletId = outletId;
    this.outletName = outletName;
    this.orderIds = orderIds;
    this.paidAmount = paidAmount;
    this.pendingAmount = pendingAmount;
    this.requestedAmount = requestedAmount;
    this.totalAmount = totalAmount;
    this.paymentId = paymentId;
    this.paymentStatus = paymentStatus;
    this.paymentMode = paymentMode;
    this.requestStatus = requestStatus;
    this.requestRemarks = requestRemarks;
    this.createdAt = new Date();
    this.lastUpdated = new Date();
    this.lastRequestAt = null;
  }
}

export class PaymentRequest {
  constructor({ outletId, outletName, amount, paymentMode, remarks = '' }) {
    this.outletId = outletId;
    this.outletName = outletName;
    this.amount = amount;
    this.paymentMode = paymentMode;
    this.remarks = remarks;
    this.status = 'pending';
    this.createdAt = new Date();
  }
}

export class Payment {
  constructor({
    outletId,
    outletName,
    paymentId,
    amount,
    paymentMode,
    status = 'approved',
    remarks = '',
    admin = 'admin',
  }) {
    this.outletId = outletId;
    this.outletName = outletName;
    this.paymentId = paymentId;
    this.amount = amount;
    this.paymentMode = paymentMode;
    this.remarks = remarks;
    this.status = status;
    this.createdAt = new Date();

    if (status === 'approved') {
      this.approvedBy = admin;
      this.approvedAt = new Date();
    } else {
      this.rejectedBy = admin;
      this.rejectedAt = new Date();
    }
  }
}
