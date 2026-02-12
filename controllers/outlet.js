// controllers/outletController.js
import { getFirestoreDB } from '../util/firebase.js';

// Format Firestore Timestamp to human-readable
export const formatTimestamp = (timestamp) => {
  if (!timestamp || !timestamp._seconds) return null;
  const date = new Date(timestamp._seconds * 1000);
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

// Generate custom outlet ID in format OUTID### using atomic counter
const generateOutletId = async () => {
    const db = getFirestoreDB();
    const counterRef = db.collection('counters').doc('outlets');
    
    // Use Firestore transaction to ensure atomic increment
    const outletId = await db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        
        let currentCount = 1;
        if (counterDoc.exists) {
            currentCount = counterDoc.data().count + 1;
        }
        
        // Update the counter atomically
        transaction.set(counterRef, { count: currentCount });
        
        return `OUTID${currentCount.toString().padStart(3, '0')}`;
    });
    
    return outletId;
};

// Create outlet
export const createOutlet = async (req, res) => {
  try {
    const {
      outletName,
      name, // Accept both outletName and name for compatibility
      address = '',
      gstNumber = '',
      pincode = '',
      managerName = '',
      primaryPhoneNumber,
      secondaryPhoneNumber = '',
      email = '',
      emailId = '', // Accept both email and emailId for compatibility
      active = true, // Accept active status from request
      discounts = {
        milk: 0,
        ghee: 0,
        sweet: 0,
        namkeen: 0,
        sweet_box: 0,
      },
      isInternal = false,
      openingBalance = 0
    } = req.body;

    // Use outletName or name, whichever is provided
    const finalOutletName = outletName || name;

    if (!finalOutletName || !primaryPhoneNumber) {
      return res.status(400).json({ error: 'Name and Primary Phone Number are required' });
    }

    // Phone number validation - must be exactly 10 digits starting with 6-9
    const isValidPhone = (num) => /^[6-9]\d{9}$/.test(num.toString());
    if (!isValidPhone(primaryPhoneNumber)) {
      return res.status(400).json({ error: 'Primary phone number must be exactly 10 digits starting with 6, 7, 8, or 9' });
    }
    if (secondaryPhoneNumber && !isValidPhone(secondaryPhoneNumber)) {
      return res.status(400).json({ error: 'Secondary phone number must be exactly 10 digits starting with 6, 7, 8, or 9' });
    }

    // Validate opening balance - must be a valid number
    if (openingBalance !== undefined && (isNaN(openingBalance) || openingBalance < 0)) {
      return res.status(400).json({ error: 'Opening balance must be a valid positive number' });
    }

    const db = getFirestoreDB();
    
    // Check if primary phone number already exists
    const existingOutlet = await db.collection('outlets')
      .where('primaryPhoneNumber', '==', primaryPhoneNumber)
      .get();
    
    if (!existingOutlet.empty) {
      return res.status(400).json({ error: 'Primary phone number already exists. Please use a different phone number.' });
    }
    
    const outletId = await generateOutletId();

    const outletData = {
      id: outletId,
      name: finalOutletName,
      address,
      gstNo: gstNumber,
      pincode,
      managerName,
      primaryPhoneNumber,
      secondaryPhoneNumber,
      emailId: emailId || email, // Use emailId if provided, otherwise use email
      active,
      discounts,
      isInternal,
      openingBalance: parseFloat(openingBalance) || 0, // Ensure it's a number
      createdAt: new Date()
    };

    await db.collection('outlets').doc(outletId).set(outletData);

    // If opening balance is greater than 0, update outlet_payments collection only
    if (openingBalance > 0) {
      try {
        // Update outlet_payments collection with opening balance (no payment request needed)
        const outletPaymentRef = db.collection('outlet_payments').doc(outletId);
        await outletPaymentRef.set({
          outletId: outletId,
          outletName: finalOutletName,
          pendingAmount: openingBalance,
          totalAmount: openingBalance,
          paidAmount: 0,
          paymentStatus: 'pending',
          requestStatus: 'none', // No request needed for opening balance
          paymentId: '', // No payment ID needed
          openingBalance: openingBalance,
          orderPendingAmount: 0,
          orderTotalAmount: 0,
          createdAt: new Date(),
          lastUpdated: new Date()
        }, { merge: true });
        
        console.log(`Updated outlet_payments with opening balance for outlet ${outletId}`);
      } catch (paymentError) {
        console.error('Error updating outlet_payments with opening balance:', paymentError);
        // Don't fail the outlet creation if outlet_payments update fails
      }
    }

    // Fetch and return full created outlet with formatted timestamp
    const savedDoc = await db.collection('outlets').doc(outletId).get();
    const savedData = savedDoc.data();

    res.status(201).json({
      ...savedData,
      createdAt: formatTimestamp(savedData.createdAt),
      updatedAt: savedData.updatedAt ? formatTimestamp(savedData.updatedAt) : null,
    });

  } catch (error) {
    console.error('Error creating outlet:', error);
    res.status(500).json({ error: 'Failed to create outlet' });
  }
};

//Get an outlet by ID
export const getOutletById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const outletId = req.params.id;

    const outletRef = db.collection('outlets').doc(outletId);
    const outletDoc = await outletRef.get();

    if (!outletDoc.exists) {
      return res.status(404).json({ error: 'Outlet not found' });
    }

    const outletData = outletDoc.data();

    return res.status(200).json({
      id: outletDoc.id,
      ...outletData,
      createdAt: formatTimestamp(outletData.createdAt),
      updatedAt: formatTimestamp(outletData.updatedAt),
    });
  } catch (error) {
    console.error('Error fetching outlet by ID:', error);
    return res.status(500).json({ error: 'Failed to fetch outlet' });
  }
};



// Get all outlets
export const getAllOutlets = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const snapshot = await db.collection('outlets').get();

    const outlets = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: formatTimestamp(data.createdAt),
        updatedAt: formatTimestamp(data.updatedAt),
      };
    });

    res.status(200).json(outlets);
  } catch (error) {
    console.error('Error fetching outlets:', error);
    res.status(500).json({ error: 'Failed to fetch outlets' });
  }
};


// Update outlet
export const updateOutlet = async (req, res) => {
    try {
        const { primaryPhoneNumber, secondaryPhoneNumber } = req.body;
        
        // Phone number validation - must be exactly 10 digits starting with 6-9
        if (primaryPhoneNumber || secondaryPhoneNumber) {
            const isValidPhone = (num) => /^[6-9]\d{9}$/.test(num.toString());
            
            if (primaryPhoneNumber && !isValidPhone(primaryPhoneNumber)) {
                return res.status(400).json({ error: 'Primary phone number must be exactly 10 digits starting with 6, 7, 8, or 9' });
            }
            if (secondaryPhoneNumber && !isValidPhone(secondaryPhoneNumber)) {
                return res.status(400).json({ error: 'Secondary phone number must be exactly 10 digits starting with 6, 7, 8, or 9' });
            }
        }
        
        const db = getFirestoreDB();
        const outletId = req.params.id;
        
        // Check if primary phone number already exists (excluding current outlet)
        if (primaryPhoneNumber) {
            const existingOutlet = await db.collection('outlets')
                .where('primaryPhoneNumber', '==', primaryPhoneNumber)
                .get();
            
            const isDuplicate = existingOutlet.docs.some(doc => doc.id !== outletId);
            if (isDuplicate) {
                return res.status(400).json({ error: 'Primary phone number already exists. Please use a different phone number.' });
            }
        }
        
        // Map request fields to database fields
        const updateData = { ...req.body };
        
        // Map gstNumber to gstNo for database consistency
        if (updateData.gstNumber !== undefined) {
            updateData.gstNo = updateData.gstNumber;
            delete updateData.gstNumber; // Remove the original field
        }
        
        // Map email to emailId for database consistency
        if (updateData.email !== undefined) {
            updateData.emailId = updateData.email;
            delete updateData.email; // Remove the original field
        }
        
        // Map outletName to name for database consistency
        if (updateData.outletName !== undefined) {
            updateData.name = updateData.outletName;
            delete updateData.outletName; // Remove the original field
        }
        
        // Validate opening balance if provided
        if (updateData.openingBalance !== undefined) {
            if (isNaN(updateData.openingBalance) || updateData.openingBalance < 0) {
                return res.status(400).json({ error: 'Opening balance must be a valid positive number' });
            }
            updateData.openingBalance = parseFloat(updateData.openingBalance);
        }
        
        updateData.updatedAt = new Date();
        
        const outletRef = db.collection('outlets').doc(outletId);
        
        // Get current outlet data to check if opening balance is being added/changed
        const currentOutletDoc = await outletRef.get();
        const currentOutletData = currentOutletDoc.data();
        const currentOpeningBalance = currentOutletData.openingBalance || 0;
        const newOpeningBalance = updateData.openingBalance || 0;
        
        await outletRef.update(updateData);
        
        // Handle opening balance changes (no payment requests needed)
        if (newOpeningBalance !== currentOpeningBalance) {
          try {
            // Update outlet_payments collection with new opening balance
            const outletPaymentRef = db.collection('outlet_payments').doc(outletId);
            const outletPaymentDoc = await outletPaymentRef.get();
            
            if (outletPaymentDoc.exists) {
              const outletPaymentData = outletPaymentDoc.data();
              const currentOrderPending = outletPaymentData.orderPendingAmount || 0;
              const currentOrderTotal = outletPaymentData.orderTotalAmount || 0;
              
              await outletPaymentRef.update({
                pendingAmount: currentOrderPending + newOpeningBalance,
                totalAmount: currentOrderTotal + newOpeningBalance,
                openingBalance: newOpeningBalance,
                lastUpdated: new Date()
              });
            } else {
              // Create new outlet_payments document
              await outletPaymentRef.set({
                outletId: outletId,
                outletName: currentOutletData.name,
                pendingAmount: newOpeningBalance,
                totalAmount: newOpeningBalance,
                paidAmount: 0,
                paymentStatus: 'pending',
                requestStatus: 'none', // No request needed for opening balance
                paymentId: '', // No payment ID needed
                openingBalance: newOpeningBalance,
                orderPendingAmount: 0,
                orderTotalAmount: 0,
                createdAt: new Date(),
                lastUpdated: new Date()
              }, { merge: true });
            }
            
            console.log(`Updated outlet_payments with opening balance for outlet ${outletId}: ${currentOpeningBalance} -> ${newOpeningBalance}`);
          } catch (paymentError) {
            console.error('Error updating outlet_payments with opening balance:', paymentError);
            // Don't fail the outlet update if outlet_payments update fails
          }
        }
        
        res.status(200).json({ message: 'Outlet updated successfully' });
    } catch (error) {
        console.error('Error updating outlet:', error);
        res.status(500).json({ error: 'Failed to update outlet' });
    }
};

// Delete outlet
export const deleteOutlet = async (req, res) => {
    try {
        const db = getFirestoreDB();
        const outletId = req.params.id;
        await db.collection('outlets').doc(outletId).delete();
        res.status(200).json({ message: 'Outlet deleted successfully' });
    } catch (error) {
        console.error('Error deleting outlet:', error);
        res.status(500).json({ error: 'Failed to delete outlet' });
    }
};

// Search Outlets by name, phone or managerName
export const searchOutlets = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { query = '' } = req.query;
    const lowerQuery = query.toLowerCase();

    const snapshot = await db.collection('outlets').get();
    const filtered = snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: formatTimestamp(data.createdAt),
          updatedAt: formatTimestamp(data.updatedAt),
        };
      })
      .filter(outlet => {
        return (
          (outlet.name && outlet.name.toLowerCase().includes(lowerQuery)) ||
          (outlet.primaryPhoneNumber && outlet.primaryPhoneNumber.toString().includes(query)) ||
          (outlet.managerName && outlet.managerName.toLowerCase().includes(lowerQuery))
        );
      });

    res.status(200).json(filtered);
  } catch (error) {
    console.error('Error searching outlets:', error);
    res.status(500).json({ error: 'Failed to search outlets' });
  }
};

// Clear all data for a specific outlet (Orders, Returns, Payments)
export const clearOutletData = async (req, res) => {
  try {
    const { id: outletId } = req.params;
    const { confirm } = req.body; // Require explicit confirmation

    if (!outletId) {
      return res.status(400).json({ error: 'Outlet ID is required' });
    }

    // Require explicit confirmation to prevent accidental deletions
    if (confirm !== true && confirm !== 'true') {
      return res.status(400).json({ 
        error: 'This is a destructive operation. Please set "confirm": true in the request body to proceed.' 
      });
    }

    const db = getFirestoreDB();

    // Verify outlet exists
    const outletDoc = await db.collection('outlets').doc(outletId).get();
    if (!outletDoc.exists) {
      return res.status(404).json({ error: 'Outlet not found' });
    }

    const outletData = outletDoc.data();
    const outletName = outletData.name || outletId;

    const deletionSummary = {
      outletId,
      outletName,
      ordersDeleted: 0,
      returnsDeleted: 0,
      paymentsDeleted: 0,
      paymentRequestsDeleted: 0,
      outletPaymentsCleared: false,
      errors: []
    };

    // Helper function to delete documents in batches (Firestore limit is 500 per batch)
    const deleteInBatches = async (query, collectionName) => {
      let deletedCount = 0;
      let lastDoc = null;
      const batchSize = 500;

      while (true) {
        let batchQuery = query.limit(batchSize);
        if (lastDoc) {
          batchQuery = batchQuery.startAfter(lastDoc);
        }

        const snapshot = await batchQuery.get();

        if (snapshot.empty) {
          break;
        }

        // Delete in batches
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
          deletedCount++;
        });

        await batch.commit();

        if (snapshot.docs.length < batchSize) {
          break;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      return deletedCount;
    };

    try {
      // 1. Delete all orders for this outlet
      const ordersQuery = db.collection('orders').where('outletId', '==', outletId);
      deletionSummary.ordersDeleted = await deleteInBatches(ordersQuery, 'orders');
    } catch (error) {
      console.error('Error deleting orders:', error);
      deletionSummary.errors.push({ type: 'orders', error: error.message });
    }

    try {
      // 2. Delete all returns for this outlet
      const returnsQuery = db.collection('returns').where('outletId', '==', outletId);
      deletionSummary.returnsDeleted = await deleteInBatches(returnsQuery, 'returns');
    } catch (error) {
      console.error('Error deleting returns:', error);
      deletionSummary.errors.push({ type: 'returns', error: error.message });
    }

    try {
      // 3. Delete all payments for this outlet
      const paymentsQuery = db.collection('payments').where('outletId', '==', outletId);
      deletionSummary.paymentsDeleted = await deleteInBatches(paymentsQuery, 'payments');
    } catch (error) {
      console.error('Error deleting payments:', error);
      deletionSummary.errors.push({ type: 'payments', error: error.message });
    }

    try {
      // 4. Delete all payment requests for this outlet
      const paymentRequestsQuery = db.collection('payment_requests').where('outletId', '==', outletId);
      deletionSummary.paymentRequestsDeleted = await deleteInBatches(paymentRequestsQuery, 'payment_requests');
    } catch (error) {
      console.error('Error deleting payment requests:', error);
      deletionSummary.errors.push({ type: 'payment_requests', error: error.message });
    }

    try {
      // 5. Clear outlet_payments data (reset to zero)
      const outletPaymentRef = db.collection('outlet_payments').doc(outletId);
      const outletPaymentDoc = await outletPaymentRef.get();

      if (outletPaymentDoc.exists) {
        await outletPaymentRef.update({
          paidAmount: 0,
          pendingAmount: 0,
          totalAmount: 0,
          orderTotalAmount: 0,
          orderPendingAmount: 0,
          lastUpdated: new Date()
        });
        deletionSummary.outletPaymentsCleared = true;
      }
    } catch (error) {
      console.error('Error clearing outlet payments:', error);
      deletionSummary.errors.push({ type: 'outlet_payments', error: error.message });
    }

    const totalDeleted = deletionSummary.ordersDeleted + 
                        deletionSummary.returnsDeleted + 
                        deletionSummary.paymentsDeleted + 
                        deletionSummary.paymentRequestsDeleted;

    res.status(200).json({
      message: `Outlet data cleared successfully for ${outletName}`,
      summary: deletionSummary,
      totalRecordsDeleted: totalDeleted
    });

  } catch (error) {
    console.error('Error clearing outlet data:', error);
    res.status(500).json({ 
      error: 'Failed to clear outlet data',
      details: error.message 
    });
  }
};

// Paginated outlet listing for Refine framework
export const getPaginatedOutlets = async (req, res) => {
  try {
    const db = getFirestoreDB();
    let { _start = 0, _end = 10 } = req.query;
    _start = parseInt(_start);
    _end = parseInt(_end);
    const limit = _end - _start;

    // Get total count for the X-Total-Count header
    const totalSnapshot = await db.collection('outlets').get();
    const totalCount = totalSnapshot.size;

    // Query for the paginated data
    const outletsRef = db.collection('outlets')
      .orderBy('createdAt', 'desc')
      .offset(_start)
      .limit(limit);
      
    const snapshot = await outletsRef.get();
    
    // Return plain data with formatted timestamps
    const outlets = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: formatTimestamp(data.createdAt),
        updatedAt: formatTimestamp(data.updatedAt),
      };
    });
    // Set headers that Refine expects
    res.set('X-Total-Count', totalCount.toString());
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');

    res.status(200).json(outlets);
    
  } catch (error) {
    console.error('Error fetching paginated outlets:', error);
    res.status(500).json({ error: 'Failed to fetch outlets', details: error.message });
  }
};


// Get active/inactive outlets
export const getOutletsByStatus = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { active } = req.query;
    const status = active === 'true';

    const snapshot = await db.collection('outlets').where('active', '==', status).get();
    const outlets = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: formatTimestamp(data.createdAt),
        updatedAt: formatTimestamp(data.updatedAt),
      };
    });

    res.status(200).json(outlets);
  } catch (error) {
    console.error('Error filtering outlets by status:', error);
    res.status(500).json({ error: 'Failed to filter outlets' });
  }
};




