export class Outlet {
  constructor(id, outletName, primaryPhoneNumber, {
    address = '',
    state = '',
    billToPalace = '',
    gstNumber = '',
    pincode = '',
    managerName = '',
    secondaryPhoneNumber = '',
    email = '',
    discounts = {
      milk: 0,
      ghee: 0,
      sweet: 0,
      namkeen: 0,
      sweet_box: 0,
    },
    isInternal = false,
    openingBalance = 0,
  } = {}) {
    this.id = id;
    this.outletName = outletName;
    this.address = address;
    this.state = state;
    this.billToPalace = billToPalace;
    this.gstNumber = gstNumber;
    this.pincode = pincode;
    this.managerName = managerName;
    this.primaryPhoneNumber = primaryPhoneNumber;
    this.secondaryPhoneNumber = secondaryPhoneNumber;
    this.email = email;
    this.discounts = discounts;
    this.isInternal = isInternal;
    this.openingBalance = openingBalance;
    this.createdAt = new Date();
  }
}
