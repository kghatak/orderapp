export class StoreKeeper {
  constructor({ name, phoneNumber }) {
    const timestamp = new Date().toISOString();
    this.name = name;
    this.phoneNumber = phoneNumber;
    this.createdAt = timestamp;
    this.updatedAt = timestamp;
  }
}
