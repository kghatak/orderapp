import express from 'express';
import { getOrder, createOrder, getSubOrders, patchOrder, putOrder, getAllOrders, updateOrderQuantities, getOrderUtensils, addUtensilsToOrder, deliverOrder, restoreUtensils, updateOrderUtensilQuantity, removeUtensilFromOrder, addItemsToOrder, removeProductsFromOrder, getOrdersReport, deleteOrdersByDate, backfillDeliveredDate, autoDeliverOpenOrders } from '../controllers/order.js'

const orderRoutes = express.Router();

orderRoutes.post('/', createOrder);
orderRoutes.get('/', getAllOrders); 
orderRoutes.get('/report', getOrdersReport);
orderRoutes.delete('/by-date', deleteOrdersByDate);
orderRoutes.post('/migrate/delivered-date', backfillDeliveredDate); // Migration endpoint to backfill deliveredDate
orderRoutes.post('/auto-deliver-open', autoDeliverOpenOrders);
orderRoutes.get('/:id', getOrder);
orderRoutes.get('/:id/suborders', getSubOrders);
orderRoutes.patch('/:id/utensils/:utensilId', updateOrderUtensilQuantity);
orderRoutes.delete('/:id/utensils/:utensilId', removeUtensilFromOrder);
orderRoutes.get('/:id/utensils', getOrderUtensils);
orderRoutes.post('/:id/utensils', addUtensilsToOrder)
orderRoutes.patch('/:id', patchOrder)
orderRoutes.patch('/:id/quantities', updateOrderQuantities)
orderRoutes.post('/:id/add-products', addItemsToOrder)
orderRoutes.post('/:id/remove-products', removeProductsFromOrder)
orderRoutes.patch('/:id/deliver', deliverOrder)
orderRoutes.patch('/:id/restore-utensils', restoreUtensils);
orderRoutes.put('/:id', putOrder)

export {orderRoutes};