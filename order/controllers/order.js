// controllers/orderController.js
import admin from 'firebase-admin';
import { Order } from '../models/order.js';
import { getFirestoreDB, createInboxNotification } from '../../util/firebase.js';
import { getIstReportRangeTimestamps } from '../../util/istDateBoundaries.js';
import {getQueueProcessor} from '../../pushnotifications/notificationqueueprovider.js';
import { addDeliveredOrderItemsToOutletProducts } from '../../util/outletProductsStock.js';

// Helper function to generate the next sequential order ID
const getNextOrderId = async (db) => {
  const counterRef = db.collection('counters').doc('orders');
  let newCounter = 1;

  await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    if (counterDoc.exists) {
      newCounter = (counterDoc.data().count || 0) + 1;
    }
    transaction.set(counterRef, { count: newCounter }, { merge: true });
  });

  return `ORD-${newCounter.toString().padStart(8, '0')}`;
};

// HSN/SAC code mapping — keep in sync with iOrder FirestoreService.hsnCodeMapping
const HSN_CODE_BY_ICON = {
  milk: '0401',
  sweet: '17049090',
  ghee: '04059020',
  sweet_box: '21069099',
  namkeen: '19041090',
};

const getHsnCodeFromIcon = (icon) => {
  if (!icon || typeof icon !== 'string') {
    return '--';
  }
  return HSN_CODE_BY_ICON[icon.toLowerCase()] ?? '--';
};

// Helper function to build a plain order data object from the request
const buildOrderData = async (req, res) => {
  const db = getFirestoreDB();
  const { outletId, items, deliveryAddress, vehicleNumber, invoiceDate, appVersion, remarks } = req.body; // items: [{ productId, quantity, discountPercentage }]

  if (!outletId || !items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Invalid request body: outletId and items array are required.' });
    return null;
  }

  // Fetch outlet data
  const outletRef = db.collection('outlets').doc(outletId);
  const outletDoc = await outletRef.get();
  if (!outletDoc.exists) {
    res.status(400).json({ error: `Outlet with id ${outletId} not found` });
    return null;
  }
  const outlet = outletDoc.data();

  // Process items and calculate totals
  const processedItems = [];
  let totalAmount = 0;

  for (const itemData of items) {
    const productRef = db.collection('products').doc(itemData.productId);
    const productDoc = await productRef.get();

    if (!productDoc.exists) {
      res.status(400).json({ error: `Product with id ${itemData.productId} not found` });
      return null;
    }

    const product = productDoc.data();
    const quantity = itemData.quantity || 0;
    const price = product.price || 0;
    const discountPercentage = itemData.discountPercentage || 0;
    const itemSubtotal = price * quantity;
    const discountAmount = itemSubtotal * (discountPercentage / 100);

    processedItems.push({
      productId: productDoc.id,
      prodid: product.productId || productDoc.id, // Fallback to doc ID
      name: product.name,
      description: product.type,
      price: price,
      quantity: quantity,
      icon: product.icon,
      gst: product.gst || 0,
      discountPercentage: discountPercentage,
      discountAmount: discountAmount,
      hsn_sac_code: itemData.hsn_sac_code || product.hsn_sac_code || getHsnCodeFromIcon(product.icon),
      type: product.type || itemData.type || 'Non-Returnable',
    });

    totalAmount += (itemSubtotal - discountAmount);
  }

  // Construct the final order object that matches the Firestore schema
  const orderData = {
    outletId: outletId,
    outlet: outlet.name,
    items: processedItems,
    item_count: processedItems.length,
    'total amount': totalAmount,
    paidAmount: 0.0,
    pendingAmount: totalAmount,
    totalPaymentAmount: totalAmount,
    status: 'pending',
    paymentStatus: 'pending',
    'payment status': 'pending',
    'delivery address': deliveryAddress || outlet.address || '',
    vehicleNumber: vehicleNumber ? vehicleNumber.trim() : '',
    invoiceDate: invoiceDate ? admin.firestore.Timestamp.fromDate(new Date(invoiceDate)) : null,
    utensilsUsed: [],
    paymentId: '',
    appVersion: appVersion || '2.0.7',
    remarks: remarks != null ? String(remarks) : '',
  };

  return orderData;
};

// Create a new order
export const createOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    let orderData = await buildOrderData(req, res);
    if (!orderData) {
      return; // Error response was already sent
    }

    // Generate a new unique order ID and use it as the document ID (matches mobile app)
    const parentOrderId = await getNextOrderId(db);
    orderData['parent orderId'] = parentOrderId;
    
    // Add server timestamps
    orderData['Created at'] = admin.firestore.FieldValue.serverTimestamp();
    orderData['updatedAt'] = admin.firestore.FieldValue.serverTimestamp();

    const orderRef = db.collection('orders').doc(parentOrderId);
    await orderRef.set(orderData);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new Error('Failed to retrieve newly created order');
    }

    // Update outlet_payments collection to add order amount
    const orderTotalAmount = orderData['total amount'] || 0;
    if (orderTotalAmount > 0) {
      try {
        const outletPaymentRef = db.collection('outlet_payments').doc(orderData.outletId);
        const outletPaymentDoc = await outletPaymentRef.get();
        
        if (outletPaymentDoc.exists) {
          const outletPaymentData = outletPaymentDoc.data();
          const currentTotalAmount = outletPaymentData.totalAmount || 0;
          const currentPaidAmount = outletPaymentData.paidAmount || 0;
          const currentOrderTotalAmount = outletPaymentData.orderTotalAmount || 0;
          
          // Add order amount to totalAmount and orderTotalAmount
          const newTotalAmount = currentTotalAmount + orderTotalAmount;
          const newOrderTotalAmount = currentOrderTotalAmount + orderTotalAmount;
          // Recalculate pendingAmount as totalAmount - paidAmount
          const newPendingAmount = Math.max(0, newTotalAmount - currentPaidAmount);
          
          await outletPaymentRef.update({
            totalAmount: newTotalAmount,
            orderTotalAmount: newOrderTotalAmount,
            pendingAmount: newPendingAmount,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          // Create new outlet_payments document if it doesn't exist
          const outletRef = db.collection('outlets').doc(orderData.outletId);
          const outletDoc = await outletRef.get();
          const outletName = outletDoc.exists ? outletDoc.data().name : orderData.outlet || '';
          
          await outletPaymentRef.set({
            outletId: orderData.outletId,
            outletName: outletName,
            totalAmount: orderTotalAmount,
            orderTotalAmount: orderTotalAmount,
            paidAmount: 0,
            pendingAmount: orderTotalAmount,
            paymentStatus: 'pending',
            requestStatus: 'none',
            paymentId: '',
            openingBalance: 0,
            orderPendingAmount: orderTotalAmount,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
        
        console.log(`Updated outlet_payments for outlet ${orderData.outletId} with order amount: ${orderTotalAmount}`);
      } catch (paymentError) {
        console.error('Error updating outlet_payments when creating order:', paymentError);
        // Don't fail order creation if outlet_payments update fails
      }
    }

    // Same as old Flutter submitOrder: reduce product availableQuantity.
    // Optional for existing clients: they keep working if this step fails.
    try {
      const stockBatch = db.batch();
      for (const item of orderData.items || []) {
        const productId = item.productId;
        const quantity = Number(item.quantity) || 0;
        if (!productId || quantity === 0) continue;
        stockBatch.update(db.collection('products').doc(productId), {
          availableQuantity: admin.firestore.FieldValue.increment(-quantity),
        });
      }
      await stockBatch.commit();
    } catch (stockError) {
      console.error('Error updating availableQuantity when creating order:', stockError);
    }

    await createInboxNotification({
      userId: 'admin',
      title: 'New Order',
      body: `New order ${parentOrderId} from ${orderData.outlet || orderData.outletId}`,
      type: 'order',
      orderId: parentOrderId,
      outletId: orderData.outletId,
    });
    
    res.status(201).json({ id: orderRef.id, ...orderDoc.data() });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

// Get an order by ID
export const getOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // UPDATED: Return plain data instead of a class instance
    res.status(200).json({ id: orderDoc.id, ...orderDoc.data() });

  } catch (error) {
    console.error('Error getting order:', error);
    res.status(500).json({ error: 'Failed to get order' });
  }
};

// Get all sub-orders for a given parent order
export const getSubOrders = async (req, res) => {
    try {
        const db = getFirestoreDB();
        const orderId = req.params.id;
        const ordersRef = db.collection('orders').where('parentOrder', '==', orderId);
        
        const snapshot = await ordersRef.get();
        if (snapshot.empty) {
            return res.status(200).json({ count: 0, subOrders: [] });
        }

        // UPDATED: Return plain data instead of a class instance
        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ count: orders.length, subOrders: orders });

    } catch (error) {
        console.error('Error getting sub orders:', error);
        res.status(500).json({ error: 'Failed to get sub orders' });
    }
}

// Update an order's status (PATCH)
export const patchOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { status: newStatus, vehicleNumber, invoiceDate, narration } = req.body;

    if (!newStatus && !vehicleNumber && !invoiceDate && narration === undefined) {
      return res.status(400).json({ error: 'Status, vehicleNumber, invoiceDate, or narration is required to update the order' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    // Get order data before transaction to check current status for cancellation handling
    const orderDocBefore = await orderRef.get();
    if (!orderDocBefore.exists) {
      return res.status(404).json({ error: `Order ${orderId} not found.` });
    }
    const orderDataBefore = orderDocBefore.data();
    const currentStatus = orderDataBefore.status || 'pending';
    const orderTotalAmountBefore = orderDataBefore['total amount'] || 0;

    await db.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();

      // Prepare update data
      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Handle status update if provided
      if (newStatus) {
        const allowedTransitions = {
          pending: ['accepted', 'cancelled'],
          accepted: ['processing', 'pending'],
          processing: ['dispatched', 'accepted'],
          dispatched: ['delivered', 'processing'],
          delivered: [],
          cancelled: [],
        };

        const validNextStatuses = allowedTransitions[currentStatus] || [];

        if (!validNextStatuses.includes(newStatus)) {
          // Logging the invalid attempt can be done here without stopping the transaction
          console.warn(`Invalid status transition attempt on order ${orderId} from "${currentStatus}" to "${newStatus}".`);
          throw new Error(`Invalid status transition from "${currentStatus}" to "${newStatus}". Allowed: ${validNextStatuses.join(', ')}`);
        }

        const statusChangeTimestamp = admin.firestore.Timestamp.now();
        const historyEntry = {
          from: currentStatus,
          to: newStatus,
          changedAt: statusChangeTimestamp, // Use Firestore Timestamp
        };

        const updatedHistory = Array.isArray(orderData.statusHistory)
          ? [...orderData.statusHistory, historyEntry]
          : [historyEntry];

        updateData.status = newStatus;
        updateData.statusHistory = updatedHistory;
        
        // If status is changing to 'delivered', set deliveredDate
        if (newStatus === 'delivered') {
          updateData.deliveredDate = statusChangeTimestamp;
        }
      }

      // Handle vehicleNumber update if provided
      if (vehicleNumber !== undefined) {
        updateData.vehicleNumber = vehicleNumber.trim();
      }

      // Handle invoiceDate update if provided
      if (invoiceDate !== undefined) {
        // Convert ISO string to Firestore Timestamp
        updateData.invoiceDate = admin.firestore.Timestamp.fromDate(new Date(invoiceDate));
      }

      // Handle narration update if provided (optional field)
      if (narration !== undefined) {
        updateData.narration = narration;
      }

      transaction.update(orderRef, updateData);

      // Send notification only if status was updated
      if (newStatus) {
        getQueueProcessor().enqueue({
          messageType: 'orderStatusUpdate',
          messageBody: {
            orderId,
            status: newStatus,
            outletId: orderData.outletId,
            vehicleNumber: vehicleNumber || orderData.vehicleNumber,
          },
        });
      }
    });

    // Handle order cancellation - subtract order amount from outlet_payments
    if (newStatus === 'cancelled' && currentStatus !== 'cancelled') {
      try {
        if (orderTotalAmountBefore > 0) {
          const outletPaymentRef = db.collection('outlet_payments').doc(orderDataBefore.outletId);
          const outletPaymentDoc = await outletPaymentRef.get();
          
          if (outletPaymentDoc.exists) {
            const outletPaymentData = outletPaymentDoc.data();
            const currentTotalAmount = outletPaymentData.totalAmount || 0;
            const currentPaidAmount = outletPaymentData.paidAmount || 0;
            const currentOrderTotalAmount = outletPaymentData.orderTotalAmount || 0;
            
            // Subtract order amount from totalAmount and orderTotalAmount
            const newTotalAmount = Math.max(0, currentTotalAmount - orderTotalAmountBefore);
            const newOrderTotalAmount = Math.max(0, currentOrderTotalAmount - orderTotalAmountBefore);
            // Recalculate pendingAmount as totalAmount - paidAmount
            const newPendingAmount = Math.max(0, newTotalAmount - currentPaidAmount);
            
            await outletPaymentRef.update({
              totalAmount: newTotalAmount,
              orderTotalAmount: newOrderTotalAmount,
              pendingAmount: newPendingAmount,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`Updated outlet_payments for outlet ${orderDataBefore.outletId}: subtracted cancelled order amount ${orderTotalAmountBefore}`);
          }
        }
      } catch (paymentError) {
        console.error('Error updating outlet_payments when cancelling order:', paymentError);
        // Don't fail order update if outlet_payments update fails
      }
    }

    if (newStatus === 'delivered' && currentStatus !== 'delivered') {
      try {
        await addDeliveredOrderItemsToOutletProducts(orderDataBefore.outletId, orderDataBefore.items || []);
        await orderRef.update({
          mongoDeliverySyncAt: admin.firestore.FieldValue.serverTimestamp(),
          mongoDeliverySyncStatus: 'synced'
        });
      } catch (mongoSyncError) {
        console.error(
          `Order ${orderId} delivered but failed to sync Products stock:`,
          mongoSyncError
        );
      }
    }

    if (newStatus && orderDataBefore.outletId) {
      await createInboxNotification({
        userId: orderDataBefore.outletId,
        title: 'Order Update',
        body: `Order ${orderId} status updated to ${newStatus}`,
        type: 'order',
        orderId,
        outletId: orderDataBefore.outletId,
      });
    }

    res.status(200).json({ 
      message: 'Order updated successfully',
      ...(newStatus && { status: newStatus }),
      ...(vehicleNumber !== undefined && { vehicleNumber: vehicleNumber.trim() }),
      ...(invoiceDate !== undefined && { invoiceDate: invoiceDate }),
      ...(narration !== undefined && { narration: narration })
    });

  } catch (error) {
    console.error('Error updating order:', error);
    if (error.message.includes('not found') || error.message.includes('Invalid status transition')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update order' });
  }
};

// Replace an entire order (PUT)
export const putOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    let orderData = await buildOrderData(req, res);
    
    if (!orderData) {
      return; // Error response already sent
    }
    
    orderData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.set(orderData, { merge: true }); // Use set with merge to be safe
    
    res.status(200).json({ message: 'Order updated successfully', id: orderId, ...orderData });

  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
};

// Add new items to existing order
export const addItemsToOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { items } = req.body; // items: [{ productId, quantity, price, name, icon, description, gst, discountAmount, discountPercentage, prodid, hsn_sac_code, type }]

    console.log('Adding items to order:', { orderId, items });

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid request body: items array is required.' });
    }

    // Preload GST from product master for items where payload GST is missing/blank.
    const needsGstProductIds = Array.from(
      new Set(
        items
          .filter((item) => item?.productId && (item.gst === undefined || item.gst === null || String(item.gst).trim() === ''))
          .map((item) => String(item.productId))
      )
    );
    const productGstMap = new Map();
    if (needsGstProductIds.length > 0) {
      const productDocs = await Promise.all(
        needsGstProductIds.map((productId) => db.collection('products').doc(productId).get())
      );
      productDocs.forEach((doc, idx) => {
        const productId = needsGstProductIds[idx];
        const gstVal = doc.exists ? Number(doc.data()?.gst) : NaN;
        productGstMap.set(productId, Number.isFinite(gstVal) ? gstVal : 0);
      });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      // STEP 1: READ ALL DOCUMENTS FIRST
      
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      const currentItems = orderData.items || [];
      
      // Create a map of current items for easy lookup
      const currentItemsMap = new Map();
      currentItems.forEach(item => {
        currentItemsMap.set(item.productId, item);
      });

      // STEP 2: PROCESS NEW ITEMS
      const newItems = [];
      let additionalTotalAmount = 0;

      for (const itemData of items) {
        const { productId, quantity, price, name, icon, description, gst, discountAmount, discountPercentage, prodid, hsn_sac_code, type } = itemData;
        
        // Validate required fields
        if (!productId || !quantity || !price || !name) {
          throw new Error(`Invalid item data: productId, quantity, price, and name are required for each item.`);
        }

        if (parseFloat(quantity) <= 0) {
          throw new Error(`Invalid quantity: quantity must be greater than 0 for product ${productId}.`);
        }

        // Check if product already exists in order
        const existingItem = currentItemsMap.get(productId);
        if (existingItem) {
          throw new Error(`Product ${productId} already exists in order. Use update quantities endpoint instead.`);
        }

        // Create new item object
        const hasPayloadGst = gst !== undefined && gst !== null && String(gst).trim() !== '';
        const parsedPayloadGst = Number(gst);
        const resolvedGst = hasPayloadGst && Number.isFinite(parsedPayloadGst)
          ? parsedPayloadGst
          : (productGstMap.get(productId) ?? 0);

        const newItem = {
          productId: productId,
          prodid: prodid || productId,
          name: name,
          description: type || description || '',
          price: parseFloat(price),
          quantity: parseFloat(quantity), // Changed from parseInt to parseFloat to support decimal quantities
          icon: icon || '',
          gst: resolvedGst,
          discountPercentage: parseFloat(discountPercentage) || 0,
          discountAmount: parseFloat(discountAmount) || 0,
          hsn_sac_code: hsn_sac_code || '',
        };

        // Calculate item total
        const itemSubtotal = newItem.price * newItem.quantity;
        const itemTotalAfterDiscount = itemSubtotal - newItem.discountAmount;
        additionalTotalAmount += itemTotalAfterDiscount;

        newItems.push(newItem);
      }

      // STEP 3: UPDATE ORDER WITH NEW ITEMS
      const updatedItems = [...currentItems, ...newItems];
      const newTotalAmount = (orderData['total amount'] || 0) + additionalTotalAmount;
      const newPendingAmount = newTotalAmount - (orderData.paidAmount || 0);

      transaction.update(orderRef, {
        items: updatedItems,
        'total amount': newTotalAmount,
        pendingAmount: newPendingAmount,
        'item_count': updatedItems.length,
        isPartialAccepted: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Added ${newItems.length} items to order ${orderId}. New total: ${newTotalAmount}`);
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    const updatedOrderData = updatedOrderDoc.data();
    
    res.status(200).json({ 
      message: 'Items added to order successfully',
      orderId: orderId,
      addedItemsCount: items.length,
      newTotalAmount: updatedOrderData['total amount'],
      newPendingAmount: updatedOrderData.pendingAmount,
      order: updatedOrderData
    });

  } catch (error) {
    console.error('Error adding items to order:', error);
    res.status(500).json({ 
      error: 'Failed to add items to order', 
      details: error.message 
    });
  }
};

// Remove products from order
export const removeProductsFromOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { productIds } = req.body; // productIds: ["PROD-00271", "PROD-00267"]

    console.log('Removing products from order:', { orderId, productIds });

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'Invalid request body: productIds array is required.' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      const currentItems = orderData.items || [];
      
      // Create a set of productIds to remove for faster lookup
      const productIdsToRemove = new Set(productIds);
      
      // Filter out items that match the productIds to remove
      const removedItems = [];
      const updatedItems = currentItems.filter(item => {
        if (productIdsToRemove.has(item.productId)) {
          removedItems.push(item);
          return false; // Remove this item
        }
        return true; // Keep this item
      });

      // Check if any products were actually removed
      if (removedItems.length === 0) {
        throw new Error(`None of the provided productIds were found in the order.`);
      }

      // Recalculate total amount from remaining items
      let totalAmount = 0;
      updatedItems.forEach(item => {
        const itemSubtotal = item.price * item.quantity;
        const itemTotalAfterDiscount = itemSubtotal - (item.discountAmount || 0);
        totalAmount += itemTotalAfterDiscount;
      });

      // Update the order
      transaction.update(orderRef, {
        items: updatedItems,
        'total amount': totalAmount,
        pendingAmount: totalAmount - (orderData.paidAmount || 0),
        item_count: updatedItems.length,
        isPartialAccepted: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Removed ${removedItems.length} products from order ${orderId}. New total: ${totalAmount}`);
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    const updatedOrderData = updatedOrderDoc.data();
    
    res.status(200).json({ 
      message: 'Products removed from order successfully',
      orderId: orderId,
      removedProductsCount: productIds.length,
      newTotalAmount: updatedOrderData['total amount'],
      newPendingAmount: updatedOrderData.pendingAmount,
      order: updatedOrderData
    });

  } catch (error) {
    console.error('Error removing products from order:', error);
    if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('None of the provided')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ 
      error: 'Failed to remove products from order', 
      details: error.message 
    });
  }
};

export const archiveOrders = async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'orderIds array is required' });
    }

    const db = getFirestoreDB();
    const chunks = [];
    for (let i = 0; i < orderIds.length; i += 450) {
      chunks.push(orderIds.slice(i, i + 450));
    }

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((orderId) => {
        batch.update(db.collection('orders').doc(orderId), { archived: true });
      });
      await batch.commit();
    }

    res.status(200).json({
      message: 'Orders archived successfully',
      count: orderIds.length,
    });
    console.log('[API] POST /orders/archive count=' + orderIds.length);
  } catch (error) {
    console.error('Error archiving orders:', error);
    res.status(500).json({ error: 'Failed to archive orders' });
  }
};

// Get all orders with pagination for Refine framework
export const getAllOrders = async (req, res) => {
  try {
    const db = getFirestoreDB();
    let { _start = 0, _end = 10, outletId, from, to, excludeArchived } = req.query;
    _start = parseInt(_start);
    _end = parseInt(_end);
    const limit = Math.max(0, _end - _start);
    const shouldExcludeArchived = excludeArchived === 'true';

    let baseQuery = db.collection('orders');

    if (outletId) {
      baseQuery = baseQuery.where('outletId', '==', outletId);
    }

    // Optional date range — website does not send these; existing calls unchanged.
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        baseQuery = baseQuery.where(
          'Created at',
          '>=',
          admin.firestore.Timestamp.fromDate(fromDate),
        );
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        baseQuery = baseQuery.where(
          'Created at',
          '<=',
          admin.firestore.Timestamp.fromDate(toDate),
        );
      }
    }

    if (shouldExcludeArchived) {
      const snapshot = await baseQuery.orderBy('Created at', 'desc').get();
      let orders = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((order) => order.archived !== true);
      const totalCount = orders.length;
      orders = orders.slice(_start, _end);
      console.log('[API] GET /orders excludeArchived=true total=' + totalCount + ' page=' + orders.length);
      res.set('X-Total-Count', totalCount.toString());
      res.set('Access-Control-Expose-Headers', 'X-Total-Count');
      return res.status(200).json(orders);
    }

    // Get total count for the X-Total-Count header
    const totalSnapshot = await baseQuery.get();
    const totalCount = totalSnapshot.size;

    // Query for the paginated data
    const ordersRef = baseQuery
      .orderBy('Created at', 'desc')
      .offset(_start)
      .limit(limit || 10);

    const snapshot = await ordersRef.get();

    const orders = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Set headers that Refine expects
    res.set('X-Total-Count', totalCount.toString());
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');

    res.status(200).json(orders);

  } catch (error) {
    console.error('Error fetching paginated orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
};

// Update order quantities
export const updateOrderQuantities = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { items } = req.body; // items: [{ productId, quantity, gst?, discountPercentage?, hsn_sac_code? }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid request body: items array is required with productId and quantity.' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      const currentItems = orderData.items || [];
      
      // Create a map of current items for easy lookup
      const currentItemsMap = new Map();
      currentItems.forEach(item => {
        currentItemsMap.set(item.productId, item);
      });

      // Update quantities and recalculate totals
      let totalAmount = 0;
      const updatedItems = [];

      for (const updateItem of items) {
        const { productId, quantity, gst, discountPercentage, hsn_sac_code } = updateItem;
        
        if (!productId || quantity === undefined || quantity < 0) {
          throw new Error(`Invalid item data: productId and quantity (>= 0) are required for each item.`);
        }

        const currentItem = currentItemsMap.get(productId);
        if (!currentItem) {
          throw new Error(`Product with id ${productId} not found in order.`);
        }

        // Skip items with quantity 0 (remove them from order)
        if (quantity === 0) {
          console.log(`Removing item ${productId} from order ${orderId} due to zero quantity`);
          continue;
        }

        // Update item fields - use provided values or keep existing ones
        const finalDiscountPercentage = discountPercentage !== undefined ? discountPercentage : currentItem.discountPercentage;
        const hasGstInPayload = gst !== undefined && gst !== null && String(gst).trim() !== '';
        const parsedGst = Number(gst);
        const finalGst = hasGstInPayload && Number.isFinite(parsedGst) ? parsedGst : currentItem.gst;
        const finalHsnSacCode = hsn_sac_code !== undefined ? hsn_sac_code : currentItem.hsn_sac_code;

        // Calculate discount amount
        const discountAmount = (currentItem.price * quantity) * (finalDiscountPercentage / 100);

        // Update quantity and recalculate item totals
        const updatedItem = {
          ...currentItem,
          quantity: quantity,
          gst: finalGst,
          discountPercentage: finalDiscountPercentage,
          hsn_sac_code: finalHsnSacCode,
          discountAmount: discountAmount,
        };

        // Calculate item subtotal after discount
        const itemSubtotal = currentItem.price * quantity;
        const itemTotalAfterDiscount = itemSubtotal - discountAmount;
        totalAmount += itemTotalAfterDiscount;

        updatedItems.push(updatedItem);
      }

      // Add any items that weren't updated (keep their original quantities)
      currentItems.forEach(item => {
        if (!items.some(updateItem => updateItem.productId === item.productId)) {
          updatedItems.push(item);
          const itemSubtotal = item.price * item.quantity;
          const itemTotalAfterDiscount = itemSubtotal - (itemSubtotal * (item.discountPercentage / 100));
          totalAmount += itemTotalAfterDiscount;
        }
      });

      // Update the order
      transaction.update(orderRef, {
        items: updatedItems,
        'total amount': totalAmount,
        pendingAmount: totalAmount - (orderData.paidAmount || 0),
        item_count: updatedItems.length,
        isPartialAccepted: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    res.status(200).json({ 
      message: 'Order quantities updated successfully',
      id: updatedOrderDoc.id, 
      ...updatedOrderDoc.data() 
    });

  } catch (error) {
    console.error('Error updating order quantities:', error);
    if (error.message.includes('not found') || error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update order quantities' });
  }
};

// Get assigned utensils for an order
export const getOrderUtensils = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;

    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderData = orderDoc.data();
    const utensilsUsed = Array.isArray(orderData.utensilsUsed) ? orderData.utensilsUsed : [];

    // Convert Firestore timestamps to ISO strings for frontend compatibility
    const processedUtensils = utensilsUsed.map(utensil => ({
      utensilId: utensil.utensilId || '',
      name: utensil.name || '',
      type: utensil.type || '',
      usedQuantity: utensil.usedQuantity || utensil.quantity || 0, // Handle both old and new field names
      addedAt: utensil.addedAt ? utensil.addedAt.toDate().toISOString() : null
    }));

    res.status(200).json({
      orderId: orderId,
      utensils: processedUtensils,
      count: processedUtensils.length
    });

  } catch (error) {
    console.error('Error fetching order utensils:', error);
    res.status(500).json({ error: 'Failed to fetch order utensils' });
  }
};

// Add utensils to order (for dispatch)
export const addUtensilsToOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { utensils } = req.body; // utensils: [{ utensilId, usedQuantity }]

    console.log('Adding utensils to order:', { orderId, utensils });

    if (!utensils || !Array.isArray(utensils) || utensils.length === 0) {
      return res.status(400).json({ error: 'Invalid request body: utensils array is required with utensilId and usedQuantity.' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      // STEP 1: READ ALL DOCUMENTS FIRST
      
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      console.log('Order data:', orderData);
      
      // Read all utensil documents first
      const utensilRefs = [];
      const utensilDocs = [];
      
      for (const utensilData of utensils) {
        const { utensilId, usedQuantity } = utensilData;
        
        console.log('Processing utensil:', { utensilId, usedQuantity });
        
        if (!utensilId || usedQuantity === undefined || usedQuantity <= 0) {
          throw new Error(`Invalid utensil data: utensilId and usedQuantity (> 0) are required for each utensil.`);
        }

        // Get utensil from database - try both document ID and utensilId field
        let utensilRef = db.collection('utensils').doc(utensilId);
        let utensilDoc = await transaction.get(utensilRef);
        
        // If not found by document ID, try to find by utensilId field
        if (!utensilDoc.exists) {
          console.log('Utensil not found by document ID, searching by utensilId field...');
          const utensilQuery = await db.collection('utensils').where('utensilId', '==', utensilId).limit(1).get();
          if (!utensilQuery.empty) {
            const foundUtensil = utensilQuery.docs[0];
            utensilRef = db.collection('utensils').doc(foundUtensil.id);
            utensilDoc = await transaction.get(utensilRef);
          }
        }
        
        if (!utensilDoc.exists) {
          throw new Error(`Utensil with id ${utensilId} not found.`);
        }

        const utensil = utensilDoc.data();
        console.log('Found utensil:', utensil);
        
        // Validate quantity constraints
        if (usedQuantity > utensil.quantity) {
          throw new Error(`Cannot add ${usedQuantity} ${utensil.name}. Total available quantity: ${utensil.quantity}`);
        }
        
        if (usedQuantity > utensil.actualQuantity) {
          throw new Error(`Cannot add ${usedQuantity} ${utensil.name}. Available quantity for dispatch: ${utensil.actualQuantity} (Total: ${utensil.quantity})`);
        }

        // Store references and data for later updates
        utensilRefs.push({ utensilRef, utensilData, utensil });
      }

      // STEP 2: PERFORM ALL WRITES
      
      const processedUtensils = [];
      
      for (const { utensilRef, utensilData, utensil } of utensilRefs) {
        const { utensilId, usedQuantity } = utensilData;
        
        // Decrease actualQuantity
        const newActualQuantity = utensil.actualQuantity - usedQuantity;
        console.log('Updating utensil quantity:', { 
          utensilId, 
          currentActualQuantity: utensil.actualQuantity, 
          newActualQuantity, 
          usedQuantity 
        });
        
        transaction.update(utensilRef, {
          actualQuantity: newActualQuantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Add to processed utensils
        processedUtensils.push({
          utensilId: utensilId,
          name: utensil.name,
          type: utensil.type,
          usedQuantity: usedQuantity,
          addedAt: admin.firestore.Timestamp.now(),
        });
      }

      // Update order with utensils
      const currentUtensils = orderData.utensilsUsed || [];
      const updatedUtensils = [...currentUtensils, ...processedUtensils];
      
      console.log('Updating order with utensils:', { 
        currentUtensilsCount: currentUtensils.length, 
        newUtensilsCount: processedUtensils.length,
        totalUtensilsCount: updatedUtensils.length 
      });
      
      transaction.update(orderRef, {
        utensilsUsed: updatedUtensils,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    res.status(200).json({ 
      message: 'Utensils added to order successfully',
      id: updatedOrderDoc.id, 
      ...updatedOrderDoc.data() 
    });

  } catch (error) {
    console.error('Error adding utensils to order:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('Cannot add') || error.message.includes('Cannot deliver')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to add utensils to order', details: error.message });
  }
};

// Deliver order and decrease utensil quantity
export const deliverOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { utensils } = req.body; // utensils: [{ utensilId, usedQuantity }]

    console.log('Delivering order:', { orderId, utensils });

    if (!utensils || !Array.isArray(utensils) || utensils.length === 0) {
      return res.status(400).json({ error: 'Invalid request body: utensils array is required with utensilId and usedQuantity.' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    let deliveredOrderData = null;
    await db.runTransaction(async (transaction) => {
      // STEP 1: READ ALL DOCUMENTS FIRST
      
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      deliveredOrderData = orderData;
      console.log('Order data:', orderData);
      
      // Check if order is in dispatched status
      if (orderData.status !== 'dispatched') {
        throw new Error(`Order must be in 'dispatched' status to be delivered. Current status: ${orderData.status}`);
      }

      // Read all utensil documents first
      const utensilRefs = [];
      
      for (const utensilData of utensils) {
        const { utensilId, usedQuantity } = utensilData;
        
        console.log('Processing utensil for delivery:', { utensilId, usedQuantity });
        
        if (!utensilId || usedQuantity === undefined || usedQuantity <= 0) {
          throw new Error(`Invalid utensil data: utensilId and usedQuantity (> 0) are required for each utensil.`);
        }

        // Get utensil from database
        const utensilRef = db.collection('utensils').doc(utensilId);
        const utensilDoc = await transaction.get(utensilRef);
        
        if (!utensilDoc.exists) {
          throw new Error(`Utensil with id ${utensilId} not found.`);
        }

        const utensil = utensilDoc.data();
        console.log('Found utensil for delivery:', utensil);
        
        // Validate quantity constraints for delivery
        if (usedQuantity > utensil.quantity) {
          throw new Error(`Cannot deliver ${usedQuantity} ${utensil.name}. Available quantity: ${utensil.quantity}`);
        }

        // Store references and data for later updates
        utensilRefs.push({ utensilRef, utensilData, utensil });
      }

      // STEP 2: PERFORM ALL WRITES
      
      // Update all utensil quantities
      for (const { utensilRef, utensilData, utensil } of utensilRefs) {
        const { utensilId, usedQuantity } = utensilData;
        
        // Decrease quantity
        const newQuantity = utensil.quantity - usedQuantity;
        console.log('Updating utensil quantity for delivery:', { 
          utensilId, 
          currentQuantity: utensil.quantity, 
          newQuantity, 
          usedQuantity 
        });
        
        transaction.update(utensilRef, {
          quantity: newQuantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Add to status history
      const deliveredTimestamp = admin.firestore.Timestamp.now();
      const historyEntry = {
        from: 'dispatched',
        to: 'delivered',
        changedAt: deliveredTimestamp,
      };

      const updatedHistory = Array.isArray(orderData.statusHistory)
        ? [...orderData.statusHistory, historyEntry]
        : [historyEntry];

      // Update order status to delivered and set deliveredDate
      transaction.update(orderRef, {
        status: 'delivered',
        deliveredDate: deliveredTimestamp,
        statusHistory: updatedHistory,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    try {
      await addDeliveredOrderItemsToOutletProducts(
        deliveredOrderData?.outletId,
        deliveredOrderData?.items || []
      );
      await orderRef.update({
        mongoDeliverySyncAt: admin.firestore.FieldValue.serverTimestamp(),
        mongoDeliverySyncStatus: 'synced'
      });
    } catch (mongoSyncError) {
      console.error(
        `Order ${orderId} delivered but failed to sync Products stock:`,
        mongoSyncError
      );
    }

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    res.status(200).json({ 
      message: 'Order delivered successfully',
      id: updatedOrderDoc.id, 
      ...updatedOrderDoc.data() 
    });

  } catch (error) {
    console.error('Error delivering order:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('Cannot deliver') || error.message.includes('must be in')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to deliver order', details: error.message });
  }
};

// Restore utensils to inventory and remove from order
export const restoreUtensils = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const { utensils } = req.body; // utensils: [{ utensilId, usedQuantity }]

    console.log('Restoring utensils:', { orderId, utensils });

    if (!utensils || !Array.isArray(utensils) || utensils.length === 0) {
      return res.status(400).json({ error: 'Invalid request body: utensils array is required with utensilId and usedQuantity.' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      // STEP 1: READ ALL DOCUMENTS FIRST
      
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      const currentUtensils = orderData.utensilsUsed || [];
      
      // Create a map of current utensils for easy lookup
      const currentUtensilsMap = new Map();
      currentUtensils.forEach(utensil => {
        currentUtensilsMap.set(utensil.utensilId, utensil);
      });

      // Read all utensil documents first
      const utensilRefs = [];
      
      for (const restoreData of utensils) {
        const { utensilId, usedQuantity } = restoreData;
        
        console.log('Processing utensil for restoration:', { utensilId, usedQuantity });
        
        if (!utensilId || usedQuantity === undefined || usedQuantity <= 0) {
          throw new Error(`Invalid utensil data: utensilId and usedQuantity (> 0) are required for each utensil.`);
        }

        // Check if utensil is assigned to this order
        const assignedUtensil = currentUtensilsMap.get(utensilId);
        if (!assignedUtensil) {
          throw new Error(`Utensil ${utensilId} is not assigned to this order.`);
        }

        // Check if trying to restore more than assigned
        if (usedQuantity > assignedUtensil.usedQuantity) {
          throw new Error(`Cannot restore ${usedQuantity} ${assignedUtensil.name}. Only ${assignedUtensil.usedQuantity} assigned to this order.`);
        }

        // Get utensil from database
        const utensilRef = db.collection('utensils').doc(utensilId);
        const utensilDoc = await transaction.get(utensilRef);
        
        if (!utensilDoc.exists) {
          throw new Error(`Utensil with id ${utensilId} not found.`);
        }

        const utensil = utensilDoc.data();
        console.log('Found utensil for restoration:', utensil);
        
        // Store references and data for later updates
        utensilRefs.push({ utensilRef, restoreData, utensil, assignedUtensil });
      }

      // STEP 2: PERFORM ALL WRITES
      
      // Update all utensil quantities
      for (const { utensilRef, restoreData, utensil } of utensilRefs) {
        const { usedQuantity } = restoreData;
        
        // Increase actualQuantity (restore to available inventory)
        const newActualQuantity = utensil.actualQuantity + usedQuantity;
        console.log('Restoring utensil quantity:', { 
          utensilId: utensil.utensilId, 
          currentActualQuantity: utensil.actualQuantity, 
          newActualQuantity, 
          usedQuantity 
        });
        
        transaction.update(utensilRef, {
          actualQuantity: newActualQuantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Remove restored utensils from order
      const updatedUtensils = currentUtensils.map(assignedUtensil => {
        const restoreUtensil = utensils.find(r => r.utensilId === assignedUtensil.utensilId);
        if (!restoreUtensil) {
          return assignedUtensil; // Keep utensils not being restored
        }
        
        // If restoring all assigned quantity, return null to remove
        if (restoreUtensil.usedQuantity >= assignedUtensil.usedQuantity) {
          return null; // Will be filtered out
        }
        
        // If restoring partial quantity, reduce the assigned quantity
        return {
          ...assignedUtensil,
          usedQuantity: assignedUtensil.usedQuantity - restoreUtensil.usedQuantity
        };
      }).filter(utensil => utensil !== null);
      
      console.log('Updating order utensils after restoration:', { 
        currentUtensilsCount: currentUtensils.length, 
        updatedUtensilsCount: updatedUtensils.length 
      });
      
      transaction.update(orderRef, {
        utensilsUsed: updatedUtensils,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    res.status(200).json({ 
      message: 'Utensils restored successfully',
      id: updatedOrderDoc.id, 
      ...updatedOrderDoc.data() 
    });

  } catch (error) {
    console.error('Error restoring utensils:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('Cannot restore') || error.message.includes('not assigned')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to restore utensils', details: error.message });
  }
};

// Update utensil quantity in order
export const updateOrderUtensilQuantity = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const utensilId = req.params.utensilId;
    const { usedQuantity } = req.body;

    if (!usedQuantity || usedQuantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than 0' });
    }

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      const currentUtensils = orderData.utensilsUsed || [];
      
      // Find the utensil in the order
      const utensilIndex = currentUtensils.findIndex(utensil => utensil.utensilId === utensilId);
      if (utensilIndex === -1) {
        throw new Error(`Utensil ${utensilId} is not assigned to this order.`);
      }

      const currentUtensil = currentUtensils[utensilIndex];
      const currentQuantity = currentUtensil.usedQuantity || currentUtensil.quantity || 0;
      
      // Calculate the difference in quantity
      const quantityDifference = usedQuantity - currentQuantity;
      
      if (quantityDifference === 0) {
        throw new Error(`Quantity is already ${usedQuantity}. No changes needed.`);
      }

      // Get utensil from database to check availability
      const utensilRef = db.collection('utensils').doc(utensilId);
      const utensilDoc = await transaction.get(utensilRef);
      
      if (!utensilDoc.exists) {
        throw new Error(`Utensil with id ${utensilId} not found.`);
      }

      const utensil = utensilDoc.data();
      
      // If increasing quantity, check if enough is available
      if (quantityDifference > 0) {
        if (utensil.actualQuantity < quantityDifference) {
          throw new Error(`Cannot increase to ${quantity} ${utensil.name}. Only ${utensil.actualQuantity} available for dispatch.`);
        }
        
        // Decrease actualQuantity
        const newActualQuantity = utensil.actualQuantity - quantityDifference;
        transaction.update(utensilRef, {
          actualQuantity: newActualQuantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // If decreasing quantity, increase actualQuantity
        const newActualQuantity = utensil.actualQuantity + Math.abs(quantityDifference);
        transaction.update(utensilRef, {
          actualQuantity: newActualQuantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Update the utensil quantity in the order
      const updatedUtensils = [...currentUtensils];
      updatedUtensils[utensilIndex] = {
        ...currentUtensil,
        usedQuantity: usedQuantity
      };
      
      transaction.update(orderRef, {
        utensilsUsed: updatedUtensils,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    res.status(200).json({ 
      message: 'Utensil quantity updated successfully',
      id: updatedOrderDoc.id, 
      ...updatedOrderDoc.data() 
    });

  } catch (error) {
    console.error('Error updating utensil quantity:', error);
    if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('Cannot increase') || error.message.includes('not assigned') || error.message.includes('already')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update utensil quantity' });
  }
};

// Remove utensil from order
export const removeUtensilFromOrder = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const orderId = req.params.id;
    const utensilId = req.params.utensilId;

    const orderRef = db.collection('orders').doc(orderId);
    
    await db.runTransaction(async (transaction) => {
      // Check if order exists
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        throw new Error(`Order ${orderId} not found.`);
      }

      const orderData = orderDoc.data();
      const currentUtensils = orderData.utensilsUsed || [];
      
      // Find the utensil in the order
      const utensilIndex = currentUtensils.findIndex(utensil => utensil.utensilId === utensilId);
      if (utensilIndex === -1) {
        throw new Error(`Utensil ${utensilId} is not assigned to this order.`);
      }

      const utensilToRemove = currentUtensils[utensilIndex];
      const quantityToRestore = utensilToRemove.usedQuantity || utensilToRemove.quantity || 0;

      // Get utensil from database to restore quantity
      const utensilRef = db.collection('utensils').doc(utensilId);
      const utensilDoc = await transaction.get(utensilRef);
      
      if (!utensilDoc.exists) {
        throw new Error(`Utensil with id ${utensilId} not found.`);
      }

      const utensil = utensilDoc.data();
      
      // Restore the quantity to actualQuantity
      const newActualQuantity = utensil.actualQuantity + quantityToRestore;
      transaction.update(utensilRef, {
        actualQuantity: newActualQuantity,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Remove the utensil from the order
      const updatedUtensils = currentUtensils.filter((_, index) => index !== utensilIndex);
      
      transaction.update(orderRef, {
        utensilsUsed: updatedUtensils,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Fetch and return the updated order
    const updatedOrderDoc = await orderRef.get();
    res.status(200).json({ 
      message: 'Utensil removed from order successfully',
      id: updatedOrderDoc.id, 
      ...updatedOrderDoc.data() 
    });

  } catch (error) {
    console.error('Error removing utensil from order:', error);
    if (error.message.includes('not found') || error.message.includes('not assigned')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to remove utensil from order' });
  }
};

// Orders Report API
export const getOrdersReport = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { 
      startDate, 
      endDate, 
      outletId, 
      page = 1, 
      limit = 20 
    } = req.query;

    // Validate required parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required parameters'
      });
    }

    // IST calendar day boundaries (matches opening/closing balance and ledger UI)
    const { startTimestamp, endTimestamp } = getIstReportRangeTimestamps(startDate, endDate);

    // Build query - only include delivered orders filtered by deliveredDate
    let query = db.collection('orders')
      .where('status', '==', 'delivered')
      .where('deliveredDate', '>=', startTimestamp)
      .where('deliveredDate', '<=', endTimestamp)
      .orderBy('deliveredDate', 'desc');

    // Add outlet filter if provided
    if (outletId) {
      query = query.where('outletId', '==', outletId);
    }

    // Get total count for pagination
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;
    const totalPages = Math.ceil(total / parseInt(limit));

    // Apply pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginatedQuery = query.offset(offset).limit(parseInt(limit));
    const snapshot = await paginatedQuery.get();

    // Process orders data
    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      
      // Calculate actual order amount from items (after discounts)
      // The "total amount" field is before discount, so we need to calculate from items
      let orderAmount = 0;
      
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        data.items.forEach((item) => {
          const price = parseFloat(item.price || 0);
          const quantity = parseFloat(item.quantity || 0);
          const discountPercentage = parseFloat(item.discountPercentage || 0);
          
          // Calculate item subtotal
          const itemSubtotal = price * quantity;
          
          // Calculate discount amount (discountAmount might be 0, so calculate from percentage)
          let discountAmount = parseFloat(item.discountAmount || 0);
          if (discountAmount === 0 && discountPercentage > 0) {
            discountAmount = itemSubtotal * (discountPercentage / 100);
          }
          
          // Item total after discount
          const itemTotal = itemSubtotal - discountAmount;
          orderAmount += itemTotal;
        });
        
        // Round to 2 decimal places to avoid floating point precision issues
        orderAmount = Math.round(orderAmount * 100) / 100;
      } else {
        // Fallback: if items array is not available, use total amount
        orderAmount = parseFloat(data["total amount"] || data.totalAmount || 0);
      }
      
      return {
        id: doc.id,
        "parent orderId": data["parent orderId"] || data.orderId,
        outlet: data.outletName || data.outlet,
        status: data.status,
        "total amount": orderAmount, // Use calculated amount after discounts
        "Created at": data["Created at"],
        "deliveredDate": data.deliveredDate || null, // Delivery date when status is 'delivered'
        "payment status": data["payment status"] || data.paymentStatus
      };
    });

    res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: totalPages
      }
    });

  } catch (error) {
    console.error('Orders report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate orders report',
      error: error.message
    });
  }
};

// Helper function to escape CSV values
const escapeCSV = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  // If value contains comma, newline, or double quote, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

// Helper function to generate CSV from deleted orders data
const generateOrdersCSV = (ordersData, selectedDate) => {
  // CSV Headers
  const headers = [
    'Order ID',
    'Parent Order ID',
    'Outlet ID',
    'Outlet Name',
    'Delivery Address',
    'Total Amount',
    'Paid Amount',
    'Pending Amount',
    'Status',
    'Payment Status',
    'Item Count',
    'Created At',
    'Vehicle Number',
    'Invoice Date',
    'Payment ID',
    'Items (Product Name, Quantity, Price)'
  ];

  // Create CSV rows
  const rows = ordersData.map(order => {
    // Format items as a readable string
    const itemsString = order.items.map(item => 
      `${item.name || ''} (Qty: ${item.quantity || 0}, Price: ${item.price || 0})`
    ).join('; ');

    return [
      escapeCSV(order.orderId),
      escapeCSV(order.parentOrderId),
      escapeCSV(order.outletId),
      escapeCSV(order.outletName),
      escapeCSV(order.deliveryAddress),
      escapeCSV(order.totalAmount),
      escapeCSV(order.paidAmount),
      escapeCSV(order.pendingAmount),
      escapeCSV(order.status),
      escapeCSV(order.paymentStatus),
      escapeCSV(order.itemCount),
      escapeCSV(order.createdAt),
      escapeCSV(order.vehicleNumber),
      escapeCSV(order.invoiceDate),
      escapeCSV(order.paymentId),
      escapeCSV(itemsString)
    ];
  });

  // Combine headers and rows
  const csvRows = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ];

  // Add metadata as comments at the top (some CSV readers support this)
  const metadata = [
    `# Deleted Orders Report`,
    `# Selected Date: ${selectedDate.toISOString()}`,
    `# Total Orders Deleted: ${ordersData.length}`,
    `# Generated At: ${new Date().toISOString()}`,
    `#`,
    ''
  ];

  return metadata.join('\n') + csvRows.join('\n');
};

// Delete orders created before a selected date and archive them
export const deleteOrdersByDate = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { date } = req.body; // Expected format: "2025-12-31" or ISO date string

    // Validate date parameter
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date parameter is required. Please provide a date in format: "YYYY-MM-DD" or ISO date string'
      });
    }

    // Parse and validate the date
    let selectedDate;
    try {
      // Try parsing as ISO string or date string
      selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        throw new Error('Invalid date format');
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please provide a valid date in format: "YYYY-MM-DD" or ISO date string'
      });
    }

    // Convert to Firestore Timestamp (start of the selected date)
    const selectedTimestamp = admin.firestore.Timestamp.fromDate(selectedDate);
    
    console.log(`Deleting orders created before: ${selectedDate.toISOString()}`);

    // Query orders created before the selected date
    const ordersQuery = db.collection('orders')
      .where('Created at', '<', selectedTimestamp)
      .orderBy('Created at', 'desc');

    const ordersSnapshot = await ordersQuery.get();

    if (ordersSnapshot.empty) {
      // Return empty CSV file
      const csvContent = generateOrdersCSV([], selectedDate);
      const fileName = `deleted_orders_${selectedDate.toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.status(200).send(csvContent);
    }

    const ordersToDelete = ordersSnapshot.docs;
    const archivedOrders = [];
    const deletedOrdersData = []; // Store full order data for CSV
    let deletedCount = 0;
    let archivedCount = 0;

    // Process orders in batches (Firestore batch limit is 500 operations)
    // Each order requires 2 operations: 1 set (archive) + 1 delete
    const batchSize = 250;
    for (let i = 0; i < ordersToDelete.length; i += batchSize) {
      const batch = db.batch();
      const currentBatch = ordersToDelete.slice(i, i + batchSize);

      for (const orderDoc of currentBatch) {
        const orderData = orderDoc.data();
        const orderId = orderDoc.id;

        // Store full order data for CSV generation
        const createdAt = orderData['Created at'];
        const createdAtDate = createdAt ? (createdAt.toDate ? createdAt.toDate() : new Date(createdAt._seconds * 1000)) : null;
        
        deletedOrdersData.push({
          orderId: orderId,
          parentOrderId: orderData['parent orderId'] || orderId,
          outletId: orderData.outletId || '',
          outletName: orderData.outlet || '',
          deliveryAddress: orderData['delivery address'] || '',
          totalAmount: orderData['total amount'] || 0,
          paidAmount: orderData.paidAmount || 0,
          pendingAmount: orderData.pendingAmount || 0,
          status: orderData.status || '',
          paymentStatus: orderData['payment status'] || '',
          itemCount: orderData['item_count'] || 0,
          createdAt: createdAtDate ? createdAtDate.toISOString() : '',
          vehicleNumber: orderData.vehicleNumber || '',
          invoiceDate: orderData.invoiceDate ? (orderData.invoiceDate.toDate ? orderData.invoiceDate.toDate().toISOString() : new Date(orderData.invoiceDate._seconds * 1000).toISOString()) : '',
          paymentId: orderData.paymentId || '',
          items: orderData.items || []
        });

        // Add metadata for archived order
        const archivedOrderData = {
          ...orderData,
          originalOrderId: orderId,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          deletedDate: selectedDate.toISOString(),
          archivedReason: 'Deleted before selected date'
        };

        // Add to deleted_orders collection
        const archivedOrderRef = db.collection('deleted_orders').doc(orderId);
        batch.set(archivedOrderRef, archivedOrderData);

        // Delete from orders collection
        const orderRef = db.collection('orders').doc(orderId);
        batch.delete(orderRef);

        archivedOrders.push({
          id: orderId,
          parentOrderId: orderData['parent orderId'] || orderId,
          createdAt: createdAt
        });

        archivedCount++;
      }

      // Commit the batch
      await batch.commit();
      deletedCount += currentBatch.length;
      console.log(`Processed batch: ${currentBatch.length} orders archived and deleted`);
    }

    console.log(`Successfully deleted ${deletedCount} orders created before ${selectedDate.toISOString()}`);

    // Generate CSV content
    const csvContent = generateOrdersCSV(deletedOrdersData, selectedDate);

    // Set headers for CSV download
    const fileName = `deleted_orders_${selectedDate.toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Send CSV file
    res.status(200).send(csvContent);

  } catch (error) {
    console.error('Error deleting orders by date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete orders by date',
      error: error.message
    });
  }
};

// Migration: Backfill deliveredDate for existing delivered orders
export const backfillDeliveredDate = async (req, res) => {
  try {
    const db = getFirestoreDB();
    
    // Find all orders with status "delivered" that don't have deliveredDate
    const deliveredOrdersSnapshot = await db.collection('orders')
      .where('status', '==', 'delivered')
      .get();

    const ordersToUpdate = [];
    
    deliveredOrdersSnapshot.forEach((doc) => {
      const orderData = doc.data();
      
      // Skip if deliveredDate already exists
      if (orderData.deliveredDate) {
        return;
      }
      
      // Extract delivery date from statusHistory
      let deliveredTimestamp = null;
      
      if (orderData.statusHistory && Array.isArray(orderData.statusHistory)) {
        // Find the status history entry where status changed to "delivered"
        const deliveredEntry = orderData.statusHistory.find(
          entry => entry.to === 'delivered'
        );
        
        if (deliveredEntry && deliveredEntry.changedAt) {
          // Use the timestamp from statusHistory
          deliveredTimestamp = deliveredEntry.changedAt;
        } else if (orderData.updatedAt) {
          // Fallback: use updatedAt if statusHistory doesn't have the entry
          deliveredTimestamp = orderData.updatedAt;
        }
      } else if (orderData.updatedAt) {
        // Fallback: use updatedAt if statusHistory doesn't exist
        deliveredTimestamp = orderData.updatedAt;
      }
      
      if (deliveredTimestamp) {
        ordersToUpdate.push({
          docRef: doc.ref,
          orderId: doc.id,
          deliveredDate: deliveredTimestamp
        });
      }
    });

    if (ordersToUpdate.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No orders need to be updated. All delivered orders already have deliveredDate.',
        updatedCount: 0
      });
    }

    // Update orders in batches (Firestore batch limit is 500)
    const batchSize = 500;
    let updatedCount = 0;
    const errors = [];

    for (let i = 0; i < ordersToUpdate.length; i += batchSize) {
      const batch = db.batch();
      const currentBatch = ordersToUpdate.slice(i, i + batchSize);

      currentBatch.forEach(({ docRef, orderId, deliveredDate }) => {
        try {
          batch.update(docRef, {
            deliveredDate: deliveredDate
          });
        } catch (error) {
          errors.push({ orderId, error: error.message });
        }
      });

      try {
        await batch.commit();
        updatedCount += currentBatch.length;
        console.log(`Updated batch ${Math.floor(i / batchSize) + 1}: ${currentBatch.length} orders`);
      } catch (error) {
        console.error(`Error updating batch ${Math.floor(i / batchSize) + 1}:`, error);
        errors.push({ batch: Math.floor(i / batchSize) + 1, error: error.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Migration completed. Updated ${updatedCount} orders with deliveredDate.`,
      updatedCount: updatedCount,
      totalFound: deliveredOrdersSnapshot.size,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error backfilling deliveredDate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to backfill deliveredDate',
      error: error.message
    });
  }
};
