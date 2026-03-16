// controllers/outletOpeningClosingBalanceController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { OutletOpeningClosingBalance } from '../models/outletOpeningClosingBalance.js';
import admin from 'firebase-admin';

/**
 * POST /api/balance/calculate-opening-closing
 * 
 * Daily Opening/Closing Balance calculation for all active outlets.
 * Called by Firebase Cloud Function scheduler every day at 6:00 AM IST.
 *
 * Steps:
 *   1. Cleanup old records (older than 1 month)
 *   2. Query all active outlets
 *   3. Create balance calculation record for each outlet
 *   4. Mark each record as success after creation
 *   5. Return summary response
 */
export const calculateDailyOpeningClosingBalance = async (req, res) => {
  const executionStart = new Date();
  let oldRecordsDeleted = 0;

  try {
    const db = getFirestoreDB();
    const { triggeredAt, timeZone, source } = req.body;

    console.log(`📊 [Balance Calculation] Started at ${executionStart.toISOString()}`);
    console.log(`   Triggered at: ${triggeredAt}, TimeZone: ${timeZone}, Source: ${source}`);

    // ──────────────────────────────────────────────
    // Step 1 — Cleanup old records (older than 1 month)
    // ──────────────────────────────────────────────
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoTimestamp = admin.firestore.Timestamp.fromDate(oneMonthAgo);

    console.log(`🧹 [Step 1] Cleaning up records older than ${oneMonthAgo.toISOString()}`);

    const oldRecordsSnapshot = await db
      .collection('OutletOpeningClosingBalance')
      .where('timestamp', '<', oneMonthAgoTimestamp)
      .get();

    if (!oldRecordsSnapshot.empty) {
      const oldDocs = oldRecordsSnapshot.docs;
      // Delete in batches of 500 (Firestore batch limit)
      for (let i = 0; i < oldDocs.length; i += 500) {
        const batch = db.batch();
        const chunk = oldDocs.slice(i, i + 500);
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      oldRecordsDeleted = oldDocs.length;
    }

    console.log(`🧹 [Step 1] Deleted ${oldRecordsDeleted} old records`);

    // ──────────────────────────────────────────────
    // Step 2 — Query all active outlets
    // ──────────────────────────────────────────────
    console.log('🏪 [Step 2] Querying all active outlets...');

    const outletsSnapshot = await db
      .collection('outlets')
      .where('active', '==', true)
      .get();

    if (outletsSnapshot.empty) {
      console.log('🏪 [Step 2] No active outlets found');
      return res.status(200).json({
        success: true,
        message: 'No active outlets found. Nothing to process.',
        summary: {
          totalOutlets: 0,
          successful: 0,
          failed: 0,
          oldRecordsDeleted,
        },
        executedAt: new Date().toISOString(),
      });
    }

    const activeOutlets = [];
    outletsSnapshot.forEach((doc) => {
      const data = doc.data();
      activeOutlets.push({
        id: doc.id,
        name: data.name || 'Unknown Outlet',
      });
    });

    console.log(`🏪 [Step 2] Found ${activeOutlets.length} active outlets`);

    // ──────────────────────────────────────────────
    // Compute date boundaries for the triggered date (in IST)
    // ──────────────────────────────────────────────
    const triggeredDate = new Date(triggeredAt || executionStart.toISOString());
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
    const targetYear = istDate.getUTCFullYear();
    const targetMonth = istDate.getUTCMonth();
    const targetDay = istDate.getUTCDate();

    const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);

    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(startOfDayUTC);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(endOfDayUTC);

    console.log(`📅 Target date (IST): ${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`);

    // ──────────────────────────────────────────────
    // Step 3 & 4 — Create balance records & mark as success
    // Process all outlets in parallel using Promise.allSettled
    // ──────────────────────────────────────────────
    console.log('📝 [Step 3 & 4] Creating balance records for each outlet...');

    const results = await Promise.allSettled(
      activeOutlets.map(async (outlet) => {
        try {
          // Fetch the previous day's totalClosingBalance for this outlet
          const prevBalanceSnapshot = await db.collection('OutletOpeningClosingBalance')
            .where('OutletID', '==', outlet.id)
            .where('status', '==', 'success')
            .where('timestamp', '<', dayStartTimestamp)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

          let previousDayClosingBalance = 0;
          if (!prevBalanceSnapshot.empty) {
            const prevData = prevBalanceSnapshot.docs[0].data();
            previousDayClosingBalance = parseFloat(prevData.totalClosingBalance || 0);
          }

          // Query delivered orders for this outlet on the triggered date
          const ordersSnapshot = await db.collection('orders')
            .where('outletId', '==', outlet.id)
            .where('status', '==', 'delivered')
            .where('deliveredDate', '>=', dayStartTimestamp)
            .where('deliveredDate', '<=', dayEndTimestamp)
            .get();

          let closingBalanceOrder = 0;
          ordersSnapshot.forEach((doc) => {
            const data = doc.data();
            closingBalanceOrder += parseFloat(data['total amount'] || data.totalAmount || 0);
          });

          // Query approved payments for this outlet on the triggered date
          const paymentsSnapshot = await db.collection('payments')
            .where('outletId', '==', outlet.id)
            .where('status', '==', 'approved')
            .where('paymentDate', '>=', dayStartTimestamp)
            .where('paymentDate', '<=', dayEndTimestamp)
            .get();

          let closingBalancePayment = 0;
          paymentsSnapshot.forEach((doc) => {
            closingBalancePayment += parseFloat(doc.data().amount || 0);
          });

          // Query collected returns for this outlet on the triggered date
          const returnsSnapshot = await db.collection('returns')
            .where('outletId', '==', outlet.id)
            .where('status', '==', 'collected')
            .where('createdAt', '>=', dayStartTimestamp)
            .where('createdAt', '<=', dayEndTimestamp)
            .get();

          let closingBanlanceReturn = 0;
          returnsSnapshot.forEach((doc) => {
            closingBanlanceReturn += parseFloat(doc.data().totalAmount || 0);
          });

          // Formula: previousDay totalClosingBalance + orders - returns - payments
          const totalClosingBalance = previousDayClosingBalance + closingBalanceOrder - closingBanlanceReturn - closingBalancePayment;

          // Step 3 — Create the balance calculation record
          const docRef = await db.collection('OutletOpeningClosingBalance').add({
            OutletID: outlet.id,
            outletName: outlet.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'in_progress',
            closingBalanceOrder,
            closingBalancePayment,
            closingBanlanceReturn,
            totalClosingBalance,
            completedAt: null,
          });

          // Step 4 — Mark as success
          await docRef.update({
            status: 'success',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          return { outletId: outlet.id, outletName: outlet.name, docId: docRef.id, status: 'success' };
        } catch (error) {
          console.error(`❌ Failed for outlet ${outlet.id} (${outlet.name}):`, error.message);
          throw error;
        }
      })
    );

    // ──────────────────────────────────────────────
    // Step 5 — Return summary response
    // ──────────────────────────────────────────────
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`✅ [Step 5] Completed — Success: ${successful}, Failed: ${failed}`);

    return res.status(200).json({
      success: true,
      message: 'Opening/Closing balance calculation completed',
      summary: {
        totalOutlets: activeOutlets.length,
        successful,
        failed,
        oldRecordsDeleted,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [Balance Calculation] Fatal error:', error);

    // Create a notification in Firestore for admin
    try {
      const db = getFirestoreDB();
      await db.collection('notifications').add({
        userId: 'admin',
        title: '❌ Balance Calculation Failed',
        body: `Opening/Closing balance calculation failed: ${error.message}`,
        type: 'system',
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        error: error.message,
        executedAt: new Date().toISOString(),
      });
    } catch (notifError) {
      console.error('❌ Failed to create error notification:', notifError.message);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      executedAt: new Date().toISOString(),
    });
  }
};

/**
 * POST /api/balance/daily-product-delivery
 *
 * Aggregates all products delivered across all orders for the triggered date
 * and stores them in the DailyProductDelivery collection with the date as document ID.
 */
export const calculateDailyProductDelivery = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { triggeredAt, timeZone, source } = req.body;
    const executionStart = new Date();

    console.log(`📦 [Daily Product Delivery] Started at ${executionStart.toISOString()}`);
    console.log(`   Triggered at: ${triggeredAt}, TimeZone: ${timeZone}, Source: ${source}`);

    // Compute date boundaries for the triggered date (in IST)
    const triggeredDate = new Date(triggeredAt || executionStart.toISOString());
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(triggeredDate.getTime() + IST_OFFSET_MS);
    const targetYear = istDate.getUTCFullYear();
    const targetMonth = istDate.getUTCMonth();
    const targetDay = istDate.getUTCDate();

    const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

    const startOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfDayUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999) - IST_OFFSET_MS);

    const dayStartTimestamp = admin.firestore.Timestamp.fromDate(startOfDayUTC);
    const dayEndTimestamp = admin.firestore.Timestamp.fromDate(endOfDayUTC);

    console.log(`📅 Target date (IST): ${dateStr}`);

    // Query all delivered orders for this date
    const ordersSnapshot = await db.collection('orders')
      .where('status', '==', 'delivered')
      .where('deliveredDate', '>=', dayStartTimestamp)
      .where('deliveredDate', '<=', dayEndTimestamp)
      .get();

    console.log(`📦 Found ${ordersSnapshot.size} delivered orders for ${dateStr}`);

    // Aggregate products across all orders (with price, unit, totalAmount)
    const productMap = new Map();
    let totalOrders = 0;

    ordersSnapshot.forEach((doc) => {
      const data = doc.data();
      totalOrders++;
      const items = data.items || [];

      items.forEach((item) => {
        const productId = item.productId || item.prodid || 'unknown';
        const name = item.name || 'Unknown Product';
        const quantity = parseFloat(item.quantity || 0);
        const price = parseFloat(item.price || 0);
        const itemAmount = price * quantity;

        if (productMap.has(productId)) {
          const existing = productMap.get(productId);
          existing.totalQuantity += quantity;
          existing.totalAmount += itemAmount;
        } else {
          productMap.set(productId, {
            productId,
            name,
            totalQuantity: quantity,
            totalAmount: itemAmount,
          });
        }
      });
    });

    // Fetch unit from products collection for each productId
    const productIds = Array.from(productMap.keys()).filter((id) => id !== 'unknown');
    const unitMap = new Map();
    if (productIds.length > 0) {
      const productDocs = await Promise.all(
        productIds.map((id) => db.collection('products').doc(id).get())
      );
      productDocs.forEach((doc, i) => {
        const pid = productIds[i];
        unitMap.set(pid, doc.exists ? (doc.data().unit || '') : '');
      });
    }

    const products = Array.from(productMap.values()).map((p) => {
      const unit = unitMap.get(p.productId) || '';
      const price = p.totalQuantity > 0 ? p.totalAmount / p.totalQuantity : 0;
      return {
        productId: p.productId,
        name: p.name,
        totalQuantity: p.totalQuantity,
        unit,
        price: Math.round(price * 100) / 100,
        totalAmount: Math.round(p.totalAmount * 100) / 100,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const grandTotalAmount = products.reduce((sum, p) => sum + (p.totalAmount || 0), 0);

    // Store in DailyProductDelivery collection with date as document ID
    const docRef = db.collection('DailyProductDelivery').doc(dateStr);
    await docRef.set({
      date: dateStr,
      deliveredDate: dateStr,
      products,
      totalProducts: products.length,
      totalOrders,
      totalAmount: Math.round(grandTotalAmount * 100) / 100,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'success',
    });

    console.log(`✅ Stored ${products.length} products from ${totalOrders} orders for ${dateStr}`);

    return res.status(200).json({
      success: true,
      message: `Daily product delivery recorded for ${dateStr}`,
      summary: {
        date: dateStr,
        totalOrders,
        totalProducts: products.length,
      },
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [Daily Product Delivery] Fatal error:', error);

    try {
      const db = getFirestoreDB();
      await db.collection('notifications').add({
        userId: 'admin',
        title: '❌ Daily Product Delivery Failed',
        body: `Daily product delivery calculation failed: ${error.message}`,
        type: 'system',
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        error: error.message,
        executedAt: new Date().toISOString(),
      });
    } catch (notifError) {
      console.error('❌ Failed to create error notification:', notifError.message);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      executedAt: new Date().toISOString(),
    });
  }
};

/**
 * GET /api/balance/daily-product-delivery?date=2026-02-23&page=1&limit=20
 *
 * Returns the daily product delivery record for a specific date with pagination on products.
 */
export const getDailyProductDelivery = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { date, page = 1, limit = 20 } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'date query parameter is required (format: YYYY-MM-DD)',
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-02-23)',
      });
    }

    const doc = await db.collection('DailyProductDelivery').doc(date).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: `No product delivery record found for ${date}`,
      });
    }

    const data = doc.data();
    const allProducts = data.products || [];

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const totalProducts = allProducts.length;
    const totalPages = Math.ceil(totalProducts / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginatedProducts = allProducts.slice(offset, offset + limitNum);

    return res.status(200).json({
      success: true,
      message: `Product delivery details for ${date}`,
      data: {
        date: data.date,
        deliveredDate: data.deliveredDate,
        totalOrders: data.totalOrders,
        totalProducts,
        totalAmount: data.totalAmount,
        products: paginatedProducts,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
        status: data.status,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalProducts,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('❌ [Get Daily Product Delivery] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get all OutletOpeningClosingBalance records
 * Supports optional query parameters:
 * - outletId: Filter by OutletID
 * - status: Filter by status
 * - date: Filter by date (format: YYYY-MM-DD, e.g., 2026-01-16)
 * - limit: Limit the number of results
 */
export const getOutletOpeningClosingBalances = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { outletId, status, date, limit } = req.query;

    let query = db.collection('OutletOpeningClosingBalance');

    // Apply date filter if provided
    if (date) {
      // Parse date string (format: YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD (e.g., 2026-01-16)',
        });
      }

      try {
        // Create start of day (00:00:00) in UTC
        const [year, month, day] = date.split('-').map(Number);
        const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

        // Convert to Firestore Timestamps
        const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

        // Filter by timestamp range for the selected date
        query = query.where('timestamp', '>=', startTimestamp)
                     .where('timestamp', '<=', endTimestamp);
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid date. Please provide a valid date in YYYY-MM-DD format',
        });
      }
    }

    // Apply filters if provided
    if (outletId) {
      query = query.where('OutletID', '==', outletId);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    // Order by timestamp descending (most recent first)
    query = query.orderBy('timestamp', 'desc');

    // Apply limit if provided
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        query = query.limit(limitNum);
      }
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return res.status(200).json({
        message: 'No records found',
        data: [],
        count: 0,
      });
    }

    const records = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      records.push({
        id: doc.id,
        ...data,
        // Convert Firestore timestamps to ISO strings for JSON response
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
        completedAt: data.completedAt?.toDate ? data.completedAt.toDate().toISOString() : data.completedAt,
      });
    });

    res.status(200).json({
      message: 'Records retrieved successfully',
      data: records,
      count: records.length,
    });
  } catch (error) {
    console.error('Error fetching OutletOpeningClosingBalance records:', error);
    res.status(500).json({
      error: 'Failed to fetch records',
      details: error.message,
    });
  }
};

/**
 * Get a specific OutletOpeningClosingBalance record by ID
 */
export const getOutletOpeningClosingBalanceById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Record ID is required' });
    }

    const doc = await db.collection('OutletOpeningClosingBalance').doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const data = doc.data();
    const record = {
      id: doc.id,
      ...data,
      // Convert Firestore timestamps to ISO strings for JSON response
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
      completedAt: data.completedAt?.toDate ? data.completedAt.toDate().toISOString() : data.completedAt,
    };

    res.status(200).json({
      message: 'Record retrieved successfully',
      data: record,
    });
  } catch (error) {
    console.error('Error fetching OutletOpeningClosingBalance record:', error);
    res.status(500).json({
      error: 'Failed to fetch record',
      details: error.message,
    });
  }
};

/**
 * Calculate and update closing balances for an outlet
 * This endpoint:
 * 1. Gets outlet's openingBalance and openingBalanceDate
 * 2. Sets opening balance on the previous date (one day before openingBalanceDate)
 *    - Creates/updates a document for previous date with totalClosingBalance = openingBalance
 *    - This ensures ledger reports show the correct opening balance
 * 3. Fetches existing OutletOpeningClosingBalance documents within date range
 * 4. Calculates closing balances for each date from openingBalanceDate to today
 * 5. Only includes:
 *    - Orders with status "delivered"
 *    - Returns with status "collected"
 *    - Payments with status "approved"
 * 6. Formula: openingBalance + orders - returns - payments = totalClosingBalance
 */
export const calculateClosingBalances = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { outletId } = req.body;

    if (!outletId) {
      return res.status(400).json({ error: 'outletId is required' });
    }

    // Get outlet data
    const outletRef = db.collection('outlets').doc(outletId);
    const outletDoc = await outletRef.get();

    if (!outletDoc.exists) {
      return res.status(404).json({ error: 'Outlet not found' });
    }

    const outletData = outletDoc.data();
    const outletName = outletData.name || outletData.outletName || '';
    const openingBalance = parseFloat(outletData.openingBalance) || 0;
    const openingBalanceDate = outletData.openingBalanceDate;

    if (!openingBalanceDate) {
      return res.status(400).json({ 
        error: 'Opening balance date not found for this outlet. Please set openingBalanceDate in the outlet collection.' 
      });
    }

    // Parse opening balance date
    const [year, month, day] = openingBalanceDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Calculate previous date (one day before openingBalanceDate)
    const previousDate = new Date(startDate);
    previousDate.setDate(previousDate.getDate() - 1);
    previousDate.setHours(23, 59, 59, 999);
    
    const previousDateStr = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;
    const previousDateTimestamp = admin.firestore.Timestamp.fromDate(previousDate);

    // Get existing OutletOpeningClosingBalance documents for this outlet within date range only
    // Include previous date in the range to check if it exists
    const startOfRange = new Date(previousDate);
    startOfRange.setHours(0, 0, 0, 0);
    const endOfRange = new Date(today);
    endOfRange.setHours(23, 59, 59, 999);
    
    const startRangeTimestamp = admin.firestore.Timestamp.fromDate(startOfRange);
    const endRangeTimestamp = admin.firestore.Timestamp.fromDate(endOfRange);

    const existingBalancesSnapshot = await db.collection('OutletOpeningClosingBalance')
      .where('OutletID', '==', outletId)
      .where('timestamp', '>=', startRangeTimestamp)
      .where('timestamp', '<=', endRangeTimestamp)
      .get();

    // Create a map of existing documents by date for easy lookup
    const existingDocsByDate = new Map();
    existingBalancesSnapshot.forEach((doc) => {
      const data = doc.data();
      const docTimestamp = data.timestamp;
      
      if (docTimestamp) {
        // Convert to Date if it's a Firestore Timestamp
        const date = docTimestamp.toDate ? docTimestamp.toDate() : new Date(docTimestamp);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        existingDocsByDate.set(dateKey, { ref: doc.ref, id: doc.id });
      }
    });

    // Note: Payments will be queried per date (same as orders and returns)
    // This requires a composite index: (outletId, status, createdAt)
    // Firestore will provide a link to create it if needed

    // Set opening balance on the previous date (one day before openingBalanceDate)
    // This ensures the ledger report shows the correct opening balance
    const previousDoc = existingDocsByDate.get(previousDateStr);
    const previousCompletedAt = admin.firestore.Timestamp.now();

    if (previousDoc) {
      // Update existing document for previous date
      await previousDoc.ref.update({
        closingBalanceOrder: 0,
        closingBalancePayment: 0,
        closingBanlanceReturn: 0,
        totalClosingBalance: openingBalance,
        completedAt: previousCompletedAt,
        status: 'success',
        outletName,
      });
    } else {
      // Create new document for previous date
      const previousDocRef = db.collection('OutletOpeningClosingBalance').doc();
      await previousDocRef.set({
        OutletID: outletId,
        outletName,
        closingBalanceOrder: 0,
        closingBalancePayment: 0,
        closingBanlanceReturn: 0,
        totalClosingBalance: openingBalance,
        timestamp: previousDateTimestamp,
        completedAt: previousCompletedAt,
        status: 'success',
      });
      // Add to map for consistency
      existingDocsByDate.set(previousDateStr, { ref: previousDocRef, id: previousDocRef.id });
    }

    // Calculate balances for each date from openingBalanceDate to today
    const results = [];
    // Start with opening balance (which is now set as previous date's closing balance)
    let currentOpeningBalance = openingBalance;
    const currentDate = new Date(startDate);

    while (currentDate <= today) {
      // Get start and end of day timestamps
      const startOfDay = new Date(currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
      const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

      // Calculate date string for this iteration
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;
      const currentDay = currentDate.getDate();
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;

      // Query orders for this specific date (only delivered orders)
      const ordersSnapshot = await db.collection('orders')
        .where('outletId', '==', outletId)
        .where('status', '==', 'delivered')
        .where('Created at', '>=', startTimestamp)
        .where('Created at', '<=', endTimestamp)
        .get();

      let closingBalanceOrder = 0;
      ordersSnapshot.forEach((doc) => {
        const orderData = doc.data();
        // Double check status in case query didn't filter properly
        if (orderData.status === 'delivered') {
          const orderAmount = parseFloat(orderData['total amount'] || orderData.totalAmount || 0);
          closingBalanceOrder += orderAmount;
        }
      });

      // Query returns for this specific date (only collected returns)
      const returnsSnapshot = await db.collection('returns')
        .where('outletId', '==', outletId)
        .where('status', '==', 'collected')
        .where('createdAt', '>=', startTimestamp)
        .where('createdAt', '<=', endTimestamp)
        .get();

      let closingBanlanceReturn = 0;
      returnsSnapshot.forEach((doc) => {
        const returnData = doc.data();
        // Double check status in case query didn't filter properly
        if (returnData.status === 'collected') {
          const returnAmount = parseFloat(returnData.totalAmount || 0);
          closingBanlanceReturn += returnAmount;
        }
      });

      // Query payments for this specific date
      const paymentsSnapshot = await db.collection('payments')
        .where('outletId', '==', outletId)
        .where('status', '==', 'approved')
        .where('createdAt', '>=', startTimestamp)
        .where('createdAt', '<=', endTimestamp)
        .get();

      let closingBalancePayment = 0;
      paymentsSnapshot.forEach((doc) => {
        const paymentData = doc.data();
        const paymentAmount = parseFloat(paymentData.amount || 0);
        closingBalancePayment += paymentAmount;
      });

      // Calculate total closing balance
      const totalClosingBalance = currentOpeningBalance + closingBalanceOrder - closingBanlanceReturn - closingBalancePayment;

      const timestamp = admin.firestore.Timestamp.fromDate(endOfDay);
      const completedAt = admin.firestore.Timestamp.now();

      // Find existing document by date from our map
      const existingDoc = existingDocsByDate.get(dateStr);

      if (existingDoc) {
        // Update existing document
        await existingDoc.ref.update({
          closingBalanceOrder,
          closingBalancePayment,
          closingBanlanceReturn,
          totalClosingBalance,
          completedAt,
          status: 'success',
          outletName, // Update outlet name in case it changed
        });
        results.push({
          date: dateStr,
          documentId: existingDoc.id,
          openingBalance: currentOpeningBalance,
          closingBalanceOrder,
          closingBanlanceReturn,
          closingBalancePayment,
          totalClosingBalance,
        });
      } else {
        // Create new document
        const newDocRef = db.collection('OutletOpeningClosingBalance').doc();
        await newDocRef.set({
          OutletID: outletId,
          outletName,
          closingBalanceOrder,
          closingBalancePayment,
          closingBanlanceReturn,
          totalClosingBalance,
          timestamp,
          completedAt,
          status: 'success',
        });
        results.push({
          date: dateStr,
          documentId: newDocRef.id,
          openingBalance: currentOpeningBalance,
          closingBalanceOrder,
          closingBanlanceReturn,
          closingBalancePayment,
          totalClosingBalance,
        });
      }

      // Update opening balance for next day (use today's closing balance)
      currentOpeningBalance = totalClosingBalance;

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.status(200).json({
      message: 'Closing balances calculated and updated successfully',
      outletId,
      outletName,
      openingBalance,
      openingBalanceDate,
      calculatedDates: results.length,
      results,
    });
  } catch (error) {
    console.error('Error calculating closing balances:', error);
    res.status(500).json({
      error: 'Failed to calculate closing balances',
      details: error.message,
    });
  }
};

