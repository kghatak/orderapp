// models/NannuUser.js

export class NannuUser {
  constructor({
    userId,
    phoneNumber,
    password,
    outletId = '',
    userProfile = 'Outlet',
    tenantId = '',
    enableNotification = true,
    fcmToken = '',
    createdAt = null,
    updatedAt = null
  }) {
    this.userId = userId;
    this.phoneNumber = phoneNumber;
    this.password = password;
    this.outletId = outletId;
    this.userProfile = userProfile;
    this.tenantId = tenantId;
    this.enableNotification = enableNotification;
    this.fcmToken = fcmToken;
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }
}
