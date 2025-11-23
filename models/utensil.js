// models/utensil.js
export class Utensil {
  constructor(data = {}) {
    this.utensilId = data.utensilId || '';
    this.name = data.name || '';
    this.type = data.type || '';
    this.quantity = data.quantity || 0;
    this.actualQuantity = data.actualQuantity || 0;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  toJSON() {
    return {
      utensilId: this.utensilId,
      name: this.name,
      type: this.type,
      quantity: this.quantity,
      actualQuantity: this.actualQuantity,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromFirestore(doc) {
    const data = doc.data();
    return new Utensil({
      utensilId: doc.id,
      name: data.name,
      type: data.type,
      quantity: data.quantity,
      actualQuantity: data.actualQuantity,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }
} 