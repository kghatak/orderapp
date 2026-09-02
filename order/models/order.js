// models/order.js

// 1. IMPORT OrderLineItem from its own file
import { OrderLineItem } from "./orderlineitem.js";

// 2. DEFINE ONLY the Order class here
export class Order {
  /**
   * @param {string} id The Firestore document ID.
   * @param {object} data The data object from the Firestore document.
   */
  constructor(id, data) {
    if (!data || typeof data !== 'object') {
      throw new Error("Order data must be a non-empty object");
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error("Order items must be a non-empty array");
    }

    this.id = id;
    this.parentOrderId = data['parent orderId'] || id;
    this.itemCount = data['item_count'] || 0;
    this.outletId = data.outletId || '';
    this.outletName = data.outlet || '';
    this.deliveryAddress = data['delivery address'] || '';
    
    // Amounts
    this.totalAmount = data['total amount'] || 0;
    this.paidAmount = data.paidAmount || 0;
    this.pendingAmount = data.pendingAmount || 0;

    // Statuses
    this.status = data.status || 'pending';
    this.paymentStatus = data['payment status'] || 'pending';
    
    // Timestamps
    this.createdAt = data['Created at'] ? new Date(data['Created at']._seconds * 1000) : null;
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt._seconds * 1000) : null;
    this.acceptedDate = data.acceptedDate
      ? new Date(data.acceptedDate._seconds ? data.acceptedDate._seconds * 1000 : data.acceptedDate)
      : null;

    // Relational IDs
    this.paymentId = data.paymentId || '';
    
    // Nested Data
    this.items = data.items.map(itemData => new OrderLineItem(itemData));
    
    // Other metadata
    this.utensilsUsed = data.utensilsUsed || [];
    this.isPartialAccepted = data.isPartialAccepted || false;
    this.updatedByAdmin = data.updatedByAdmin || null;
  }
}