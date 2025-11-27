// models/dailyClosingBalance.js

export class DailyClosingBalance {
  constructor({
    date, // Date string in YYYY-MM-DD format
    outletId,
    outletName,
    openingBalance = 0,
    orderAmount = 0,
    returnAmount = 0,
    paymentAmount = 0,
    closingBalance = 0,
    timestamp = new Date(),
  }) {
    this.date = date;
    this.outletId = outletId;
    this.outletName = outletName;
    this.openingBalance = openingBalance;
    this.orderAmount = orderAmount;
    this.returnAmount = returnAmount;
    this.paymentAmount = paymentAmount;
    this.closingBalance = closingBalance;
    this.timestamp = timestamp;
    this.createdAt = new Date();
  }
}

