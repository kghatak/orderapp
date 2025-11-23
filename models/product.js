export class Product {
  constructor({
    productId,
    name,
    price,
    unit,
    quantity,
    gst,
    type, // "Returnable" or "Not Returnable"
    category,
    icon,
    active = true,
    actualQuantity = 0,
    availableQuantity,
    sgst = 0,
    createdAt = new Date(),
    updatedAt = null,
  }) {
    this.productId = productId; // example: "PROD-00021"
    this.name = name;
    this.price = price;
    this.unit = unit;
    this.quantity = quantity;
    this.gst = gst;
    this.sgst = sgst;
    this.type = type;
    this.category = category;
    this.icon = icon;
    this.active = active;
    this.actualQuantity = actualQuantity;
    this.availableQuantity = availableQuantity ?? quantity;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
