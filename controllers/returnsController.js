import { getFirestoreDB } from '../util/firebase.js';
import { ReturnOrder, ReturnOrderStatus } from '../models/returnOrder.js';
import admin from 'firebase-admin';

// Generate Return ID in format RET-00000001
const generateReturnId = async () => {
  const db = getFirestoreDB();
  const snapshot = await db.collection('returns').orderBy('createdAt', 'desc').limit(1).get();
  let lastId = 0;
  if (!snapshot.empty) {
    const lastDoc = snapshot.docs[0];
    const id = lastDoc.data().returnId;
    lastId = parseInt(id.replace('RET-', ''));
  }
  const newId = lastId + 1;
  return `RET-${newId.toString().padStart(8, '0')}`;
};

// Create Return Order
export const createReturn = async (req, res) => {
  try {
    const {
      items = [],
      outletId,
      outlet,
      totalAmount,
      notes = '',
      includesDiscounts = false,
    } = req.body;

    if (!items.length || !outletId || !outlet || totalAmount == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = getFirestoreDB();
    const returnId = await generateReturnId();

    const returnOrder = new ReturnOrder({
      returnId,
      outletId,
      outlet,
      items,
      totalAmount,
      includesDiscounts,
      notes,
    });

    await db.collection('returns').doc(returnId).set({ ...returnOrder });
    res.status(201).json({ message: 'Return order created successfully', id: returnId });
  } catch (error) {
    console.error('Error creating return order:', error);
    res.status(500).json({ error: 'Failed to create return order' });
  }
};

// Get All Return Orders
export const getAllReturns = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const snapshot = await db.collection('returns').get();
    const returns = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(returnOrder => !returnOrder.archived); // Filter out archived returns
    res.status(200).json(returns);
  } catch (error) {
    console.error('Error fetching return orders:', error);
    res.status(500).json({ error: 'Failed to fetch return orders' });
  }
};

// Get Return Order by ID
export const getReturnById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const returnId = req.params.id;
    const doc = await db.collection('returns').doc(returnId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Error getting return order:', error);
    res.status(500).json({ error: 'Failed to fetch return order' });
  }
};

// Update Return Status
export const updateReturn = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const returnId = req.params.id;
    const { status } = req.body;

    // Validation
    if (!status) {
      return res.status(400).json({ 
        error: 'Status is required' 
      });
    }

    const validStatuses = Object.values(ReturnOrderStatus);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    // Check if return exists
    const returnDoc = await db.collection('returns').doc(returnId).get();
    if (!returnDoc.exists) {
      return res.status(404).json({ 
        error: 'Return order not found' 
      });
    }

    // Update status
    await db.collection('returns').doc(returnId).update({
      status,
      updatedAt: new Date()
    });

    // Get updated document
    const updatedDoc = await db.collection('returns').doc(returnId).get();

    res.status(200).json({ 
      message: 'Return status updated successfully',
      data: { id: updatedDoc.id, ...updatedDoc.data() }
    });
  } catch (error) {
    console.error('Error updating return status:', error);
    res.status(500).json({ error: 'Failed to update return status' });
  }
};

// Archive Return Order (soft delete)
export const deleteReturn = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const returnId = req.params.id;
    await db.collection('returns').doc(returnId).update({
      archived: true,
      archivedAt: new Date(),
    });
    res.status(200).json({ message: 'Return order archived successfully' });
  } catch (error) {
    console.error('Error archiving return order:', error);
    res.status(500).json({ error: 'Failed to archive return order' });
  }
};

// Filter Returns by Status
export const getReturnsByStatus = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { status } = req.query;

    if (!Object.values(ReturnOrderStatus).includes(status)) {
      return res.status(400).json({ error: 'Invalid return status' });
    }

    const snapshot = await db.collection('returns').where('status', '==', status).get();
    const returns = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(returnOrder => !returnOrder.archived); // Filter out archived returns
    res.status(200).json(returns);
  } catch (error) {
    console.error('Error filtering return orders:', error);
    res.status(500).json({ error: 'Failed to filter return orders' });
  }
};

// Update Return Order Items (Edit Quantities)
export const updateReturnItems = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const returnId = req.params.id;
    const { items } = req.body; // items: [{ productId, quantity }] or [{ productId, quantity, ...otherFields }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request body: items array is required with productId and quantity.' 
      });
    }

    // Get the return order
    const returnDoc = await db.collection('returns').doc(returnId).get();
    if (!returnDoc.exists) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    const returnData = returnDoc.data();
    const currentItems = returnData.items || [];
    
    // Check if return is already processed/collected (should not allow editing)
    if (returnData.status === 'processed' || returnData.status === 'collected' || returnData.status === 'cancelled') {
      return res.status(400).json({ 
        error: `Cannot edit items for return order with status: ${returnData.status}` 
      });
    }

    // Create a map of current items for easy lookup
    const currentItemsMap = new Map();
    currentItems.forEach(item => {
      currentItemsMap.set(item.productId, item);
    });

    // Process updated items and calculate new total
    const updatedItems = [];
    let newTotalAmount = 0;

    for (const updateItem of items) {
      const { productId, quantity } = updateItem;
      
      if (!productId || quantity === undefined || quantity < 0) {
        return res.status(400).json({ 
          error: `Invalid item data: productId and quantity (>= 0) are required for each item.` 
        });
      }

      // Find the current item
      const currentItem = currentItemsMap.get(productId);
      if (!currentItem) {
        return res.status(400).json({ 
          error: `Product with id ${productId} not found in return order.` 
        });
      }

      // If quantity is 0, skip this item (effectively removing it)
      if (quantity === 0) {
        console.log(`Removing item ${productId} from return order ${returnId} due to zero quantity`);
        continue;
      }

      // Update item with new quantity, preserving all other fields including existing discountPercentage
      const updatedItem = {
        ...currentItem,
        quantity: parseFloat(quantity),
      };

      // Always use the existing discountPercentage from the return order
      // Recalculate item total using existing discountPercentage
      if (updatedItem.price) {
        const itemSubtotal = updatedItem.price * updatedItem.quantity;
        
        // Use existing discountPercentage from return order
        const discountPercentage = updatedItem.discountPercentage || 0;
        const discountAmount = itemSubtotal * (discountPercentage / 100);
        updatedItem.discountAmount = discountAmount;
        
        const itemTotal = itemSubtotal - discountAmount;
        updatedItem.total = itemTotal;
        newTotalAmount += itemTotal;
      } else {
        // If no price, recalculate based on quantity change and existing discountPercentage
        const discountPercentage = updatedItem.discountPercentage || 0;
        const quantityRatio = updatedItem.quantity / (currentItem.quantity || 1);
        const baseTotal = (currentItem.total || 0) + (currentItem.discountAmount || 0); // Get original subtotal
        
        // Recalculate with new quantity
        const newSubtotal = baseTotal * quantityRatio;
        const discountAmount = newSubtotal * (discountPercentage / 100);
        const itemTotal = newSubtotal - discountAmount;
        
        updatedItem.discountAmount = discountAmount;
        updatedItem.total = itemTotal;
        newTotalAmount += itemTotal;
      }

      updatedItems.push(updatedItem);
    }

    // Check if all items were removed
    if (updatedItems.length === 0) {
      return res.status(400).json({ 
        error: 'Cannot remove all items from return order. At least one item with quantity > 0 is required.' 
      });
    }

    // Update the return order
    await db.collection('returns').doc(returnId).update({
      items: updatedItems,
      totalAmount: newTotalAmount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Fetch and return the updated return order
    const updatedReturnDoc = await db.collection('returns').doc(returnId).get();
    const updatedReturnData = updatedReturnDoc.data();

    res.status(200).json({ 
      message: 'Return order items updated successfully',
      id: updatedReturnDoc.id,
      ...updatedReturnData
    });

  } catch (error) {
    console.error('Error updating return order items:', error);
    if (error.message.includes('not found') || error.message.includes('Invalid') || error.message.includes('Cannot')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update return order items' });
  }
};

// Returns Report API
export const getReturnsReport = async (req, res) => {
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

    // Convert dates to Firestore timestamps
    const startTimestamp = admin.firestore.Timestamp.fromDate(new Date(startDate + 'T00:00:00.000Z'));
    const endTimestamp = admin.firestore.Timestamp.fromDate(new Date(endDate + 'T23:59:59.999Z'));

    // Build query - only include collected returns
    let query = db.collection('returns')
      .where('status', '==', 'collected')
      .where('createdAt', '>=', startTimestamp)
      .where('createdAt', '<=', endTimestamp)
      .orderBy('createdAt', 'desc');

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

    // Process returns data
    const returns = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        returnId: data.returnId,
        outlet: data.outlet,
        status: data.status,
        totalAmount: data.totalAmount,
        createdAt: data.createdAt
      };
    });

    res.status(200).json({
      success: true,
      data: returns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: totalPages
      }
    });

  } catch (error) {
    console.error('Returns report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate returns report',
      error: error.message
    });
  }
};
