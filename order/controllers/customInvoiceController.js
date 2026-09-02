import { getFirestoreDB } from '../../util/firebase.js';
import { filterByTenant } from '../../util/tenant.js';
import admin from 'firebase-admin';

// Generate custom invoice ID
const generateInvoiceId = async () => {
  const db = getFirestoreDB();
  const counterRef = db.collection('counters').doc('customInvoiceCounter');
  
  const counterDoc = await counterRef.get();
  let newCounter = 1;
  
  if (counterDoc.exists) {
    const counterData = counterDoc.data();
    newCounter = (counterData.count || 0) + 1;
  }
  
  await counterRef.set({ count: newCounter }, { merge: true });
  return `INV-${newCounter.toString().padStart(8, '0')}`;
};

// Generate invoice number
const generateInvoiceNumber = () => {
  const year = new Date().getFullYear();
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  const day = new Date().getDate().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `INV-${year}-${month}${day}-${random}`;
};

// Calculate invoice totals
const calculateInvoiceTotals = (items, invoiceDiscountPercentage = 0) => {
  let total = 0;
  let itemDiscount = 0;

  items.forEach(item => {
    // Since GST is already included in the product price
    const itemTotal = item.price * item.quantity;
    const itemDiscountAmount = itemTotal * (item.discountPercentage / 100);
    
    total += itemTotal;
    itemDiscount += itemDiscountAmount;
  });

  // Apply invoice-level discount percentage
  const invoiceDiscount = total * (invoiceDiscountPercentage / 100);
  const totalDiscount = itemDiscount + invoiceDiscount;

  const grandTotal = total - totalDiscount;

  return {
    total: Math.round(total * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    totalGst: 0, // GST is already included in product prices
    grandTotal: Math.round(grandTotal * 100) / 100
  };
};

// GET /custom-invoices - Get all custom invoices with pagination
export const getAllCustomInvoices = async (req, res) => {
  try {
    const db = getFirestoreDB();

    const status = req.query.status; // Optional filter by status

    const hasRangeParams =
      req.query._start !== undefined && req.query._end !== undefined;

    let limit;
    let offset;
    let currentPage;

    if (hasRangeParams) {
      const start = parseInt(req.query._start, 10);
      const end = parseInt(req.query._end, 10);

      const parsedStart = Number.isFinite(start) && start >= 0 ? start : 0;
      const parsedEnd =
        Number.isFinite(end) && end > parsedStart ? end : parsedStart + 10;

      limit = parsedEnd - parsedStart;
      offset = parsedStart;
      currentPage = Math.floor(parsedStart / limit) + 1;
    } else {
      const page = parseInt(req.query.page, 10) || 1;
      limit = parseInt(req.query.limit, 10) || 10;
      offset = (page - 1) * limit;
      currentPage = page;
    }

    let query = db.collection('customInvoices').orderBy('createdAt', 'desc');

    // Add status filter if provided
    if (status) {
      query = query.where('status', '==', status);
    }

    // Get total count for pagination
    const countSnapshot = await query.get();
    let invoices = countSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    invoices = filterByTenant(invoices, req.tenantId);
    const totalCount = invoices.length;
    invoices = invoices.slice(offset, offset + limit);

    res.status(200).json({
      invoices,
      pagination: {
        currentPage,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasNextPage: currentPage < Math.ceil(totalCount / limit),
        hasPrevPage: currentPage > 1
      }
    });

  } catch (error) {
    console.error('Error fetching custom invoices:', error);
    res.status(500).json({ error: 'Failed to fetch custom invoices' });
  }
};

// POST /custom-invoices - Create new custom invoice
export const createCustomInvoice = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { customerName, customerPhone, address, customerGst, referredBy, items, discountPercentage, pricesIncludeGST } = req.body;

    // Validation
    if (!customerName || !customerPhone || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request body: customerName, customerPhone, and items array are required.' 
      });
    }

    // Validate discountPercentage if provided
    if (discountPercentage !== undefined && (discountPercentage < 0 || discountPercentage > 100)) {
      return res.status(400).json({ 
        error: 'Invalid discountPercentage: must be between 0 and 100.' 
      });
    }

    // Process items and fetch product details
    const processedItems = [];
    for (const itemData of items) {
      const { productId, quantity } = itemData;
      
      if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({ 
          error: `Invalid item data: productId and quantity (> 0) are required for each item.` 
        });
      }

      // Fetch product details
      const productRef = db.collection('products').doc(productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        return res.status(400).json({ 
          error: `Product with id ${productId} not found.` 
        });
      }

      const product = productDoc.data();
      const price = product.price || 0;
      const discountPercentage = product.discountPercentage || 0;
      const gst = product.gst || 0;
      const itemSubtotal = price * quantity;
      const discountAmount = itemSubtotal * (discountPercentage / 100);

      processedItems.push({
        productId: productId,
        name: product.name,
        price: price,
        quantity: quantity,
        discountPercentage: discountPercentage,
        discountAmount: Math.round(discountAmount * 100) / 100,
        gst: gst,
        description: product.type || product.description || '',
        icon: product.icon || ''
      });
    }

    // Calculate totals
    const totals = calculateInvoiceTotals(processedItems, discountPercentage || 0);

    // Generate invoice ID and number
    const invoiceId = await generateInvoiceId();
    const invoiceNumber = generateInvoiceNumber();

    // Create invoice data
    const invoiceData = {
      id: invoiceId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      address: address ? address.trim() : '',
      customerGst: customerGst ? customerGst.trim() : '',
      referredBy: referredBy ? referredBy.trim() : '',
      items: processedItems,
      total: totals.total,
      totalDiscount: totals.totalDiscount,
      totalGst: totals.totalGst,
      grandTotal: totals.grandTotal,
      discountPercentage: discountPercentage || 0,
      pricesIncludeGST: pricesIncludeGST || false,
      status: 'draft',
      invoiceNumber: invoiceNumber,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user?.id || 'system', // Assuming user info is available in req.user
      tenantId: req.tenantId || 'nannu_milk',
    };

    // Save to Firestore
    await db.collection('customInvoices').doc(invoiceId).set(invoiceData);

    res.status(201).json({
      message: 'Custom invoice created successfully',
      invoice: invoiceData
    });

  } catch (error) {
    console.error('Error creating custom invoice:', error);
    res.status(500).json({ error: 'Failed to create custom invoice' });
  }
};

// GET /custom-invoices/:id - Get specific custom invoice
export const getCustomInvoice = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const invoiceId = req.params.id;

    const invoiceRef = db.collection('customInvoices').doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (!invoiceDoc.exists) {
      return res.status(404).json({ error: 'Custom invoice not found' });
    }

    const invoiceData = {
      id: invoiceDoc.id,
      ...invoiceDoc.data()
    };

    res.status(200).json(invoiceData);

  } catch (error) {
    console.error('Error fetching custom invoice:', error);
    res.status(500).json({ error: 'Failed to fetch custom invoice' });
  }
};

// PUT /custom-invoices/:id - Update custom invoice
export const updateCustomInvoice = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const invoiceId = req.params.id;
    const { customerName, customerPhone, address, customerGst, referredBy, items, status, discountPercentage, pricesIncludeGST } = req.body;

    const invoiceRef = db.collection('customInvoices').doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (!invoiceDoc.exists) {
      return res.status(404).json({ error: 'Custom invoice not found' });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update customer info if provided
    if (customerName !== undefined) {
      updateData.customerName = customerName.trim();
    }
    if (customerPhone !== undefined) {
      updateData.customerPhone = customerPhone.trim();
    }
    if (address !== undefined) {
      updateData.address = address.trim();
    }
    if (customerGst !== undefined) {
      updateData.customerGst = customerGst.trim();
    }
    if (referredBy !== undefined) {
      updateData.referredBy = referredBy.trim();
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    if (discountPercentage !== undefined) {
      if (discountPercentage < 0 || discountPercentage > 100) {
        return res.status(400).json({ 
          error: 'Invalid discountPercentage: must be between 0 and 100.' 
        });
      }
      updateData.discountPercentage = discountPercentage;
    }
    if (pricesIncludeGST !== undefined) {
      updateData.pricesIncludeGST = pricesIncludeGST;
    }

    // Update items if provided
    if (items && Array.isArray(items) && items.length > 0) {
      const processedItems = [];
      
      for (const itemData of items) {
        const { productId, quantity } = itemData;
        
        if (!productId || !quantity || quantity <= 0) {
          return res.status(400).json({ 
            error: `Invalid item data: productId and quantity (> 0) are required for each item.` 
          });
        }

        // Fetch product details
        const productRef = db.collection('products').doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
          return res.status(400).json({ 
            error: `Product with id ${productId} not found.` 
          });
        }

        const product = productDoc.data();
        const price = product.price || 0;
        const discountPercentage = product.discountPercentage || 0;
        const gst = product.gst || 0;
        const itemSubtotal = price * quantity;
        const discountAmount = itemSubtotal * (discountPercentage / 100);

        processedItems.push({
          productId: productId,
          name: product.name,
          price: price,
          quantity: quantity,
          discountPercentage: discountPercentage,
          discountAmount: Math.round(discountAmount * 100) / 100,
          gst: gst,
          description: product.type || product.description || '',
          icon: product.icon || ''
        });
      }

      // Calculate new totals
      const currentDiscountPercentage = updateData.discountPercentage !== undefined ? updateData.discountPercentage : (invoiceDoc.data().discountPercentage || 0);
      const totals = calculateInvoiceTotals(processedItems, currentDiscountPercentage);
      
      updateData.items = processedItems;
      updateData.total = totals.total;
      updateData.totalDiscount = totals.totalDiscount;
      updateData.totalGst = totals.totalGst;
      updateData.grandTotal = totals.grandTotal;
    }

    // Update the invoice
    await invoiceRef.update(updateData);

    // Fetch and return updated invoice
    const updatedInvoiceDoc = await invoiceRef.get();
    const updatedInvoiceData = {
      id: updatedInvoiceDoc.id,
      ...updatedInvoiceDoc.data()
    };

    res.status(200).json({
      message: 'Custom invoice updated successfully',
      invoice: updatedInvoiceData
    });

  } catch (error) {
    console.error('Error updating custom invoice:', error);
    res.status(500).json({ error: 'Failed to update custom invoice' });
  }
};

// PATCH /custom-invoices/:id/status - Update invoice status
export const updateInvoiceStatus = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const invoiceId = req.params.id;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending', 'paid', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be one of: pending, paid, cancelled' 
      });
    }

    const invoiceRef = db.collection('customInvoices').doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (!invoiceDoc.exists) {
      return res.status(404).json({ error: 'Custom invoice not found' });
    }

    // Update the status
    await invoiceRef.update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Fetch and return updated invoice
    const updatedInvoiceDoc = await invoiceRef.get();
    const updatedInvoiceData = {
      id: updatedInvoiceDoc.id,
      ...updatedInvoiceDoc.data()
    };

    res.status(200).json({
      message: 'Invoice status updated successfully',
      invoice: updatedInvoiceData
    });

  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ error: 'Failed to update invoice status' });
  }
};

// PATCH /custom-invoices/:id/date - Update invoice date
export const updateInvoiceDate = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const invoiceId = req.params.id;
    const { invoiceDate } = req.body;

    // Validate invoiceDate
    if (!invoiceDate) {
      return res.status(400).json({ 
        error: 'invoiceDate is required' 
      });
    }

    // Validate date format (DD-MM-YYYY)
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (!dateRegex.test(invoiceDate)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use DD-MM-YYYY format' 
      });
    }

    // Convert DD-MM-YYYY to YYYY-MM-DD for validation
    const [day, month, year] = invoiceDate.split('-');
    const isoDate = `${year}-${month}-${day}`;
    
    // Validate if it's a valid date
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ 
        error: 'Invalid date provided' 
      });
    }

    const invoiceRef = db.collection('customInvoices').doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (!invoiceDoc.exists) {
      return res.status(404).json({ error: 'Custom invoice not found' });
    }

    // Update the invoice date
    await invoiceRef.update({
      invoiceDate: invoiceDate,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Fetch and return updated invoice
    const updatedInvoiceDoc = await invoiceRef.get();
    const updatedInvoiceData = {
      id: updatedInvoiceDoc.id,
      ...updatedInvoiceDoc.data()
    };

    res.status(200).json({
      message: 'Invoice date updated successfully',
      invoice: updatedInvoiceData
    });

  } catch (error) {
    console.error('Error updating invoice date:', error);
    res.status(500).json({ error: 'Failed to update invoice date' });
  }
};

// DELETE /custom-invoices/:id - Delete custom invoice
export const deleteCustomInvoice = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const invoiceId = req.params.id;

    const invoiceRef = db.collection('customInvoices').doc(invoiceId);
    const invoiceDoc = await invoiceRef.get();

    if (!invoiceDoc.exists) {
      return res.status(404).json({ error: 'Custom invoice not found' });
    }

    await invoiceRef.delete();

    res.status(200).json({
      message: 'Custom invoice deleted successfully',
      invoiceId: invoiceId
    });

  } catch (error) {
    console.error('Error deleting custom invoice:', error);
    res.status(500).json({ error: 'Failed to delete custom invoice' });
  }
};
