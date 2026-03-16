import { Product } from './product.js';

export class OrderLineItem {
    constructor(product, quantity) {
        if(!(product instanceof Product)) {
            throw new Error("Item must be an instance of Item class");
        }

        if(!Number.isInteger(quantity) && quantity <= 0) {
            throw new Error("Quantity must be a positive integer");
        }

        this.productId = product.productId;
        this.name = product.name;
        this.price = product.price;
        this.quantity = quantity;
        this.total = product.price * quantity;
    }
}