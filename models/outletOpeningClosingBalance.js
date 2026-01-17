// models/outletOpeningClosingBalance.js

export class OutletOpeningClosingBalance {
  constructor({
    OutletID,
    closingBalanceOrder = 0,
    closingBalancePayment = 0,
    closingBanlanceReturn = 0, // Note: keeping the typo as per the data structure
    completedAt,
    outletName,
    status,
    timestamp,
    totalClosingBalance = 0,
  }) {
    this.OutletID = OutletID;
    this.closingBalanceOrder = closingBalanceOrder;
    this.closingBalancePayment = closingBalancePayment;
    this.closingBanlanceReturn = closingBanlanceReturn;
    this.completedAt = completedAt;
    this.outletName = outletName;
    this.status = status;
    this.timestamp = timestamp;
    this.totalClosingBalance = totalClosingBalance;
  }
}

