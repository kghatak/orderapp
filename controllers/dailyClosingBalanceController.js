// controllers/dailyClosingBalanceController.js
import { getFirestoreDB } from '../util/firebase.js';
import { DailyClosingBalance } from '../models/dailyClosingBalance.js';
import admin from 'firebase-admin';

// Opening balance and starting date are now read from each outlet's document
// Each outlet has: openingBalance and openingBalanceDate fields

/**
 * Calculate and store daily closing balance for all outlets
 * @param {Date} targetDate - The date for which to calculate closing balance (defaults to yesterday)
 */
export const calculateDailyClosingBalance = async (targetDate = null) => {
  try {
    const db = getFirestoreDB();
    
    // If no target date provided, use today
    const date = targetDate || new Date();
    date.setHours(0, 0, 0, 0);
    
    // Format date as YYYY-MM-DD (using local date to avoid timezone issues)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    // Get start and end of the day
    const startOfDay = admin.firestore.Timestamp.fromDate(date);
    const endOfDay = admin.firestore.Timestamp.fromDate(new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1));
    
    console.log(`📊 Calculating daily closing balance for ${dateString}`);
    
    // Get all outlets
    const outletsSnapshot = await db.collection('outlets').get();
    
    if (outletsSnapshot.empty) {
      console.log('⚠️ No outlets found');
      return { success: false, message: 'No outlets found' };
    }
    
    const results = [];
    const errors = [];
    
    // Process each outlet
    for (const outletDoc of outletsSnapshot.docs) {
      try {
        const outletData = outletDoc.data();
        const outletId = outletDoc.id;
        const outletName = outletData.name || outletData.outletName || 'Unknown';
        
        // Get opening balance and opening balance date from outlet document
        const outletOpeningBalance = parseFloat(outletData.openingBalance || 0);
        const outletOpeningBalanceDate = outletData.openingBalanceDate || null;
        
        // Skip this outlet if no opening balance date is set
        if (!outletOpeningBalanceDate) {
          console.warn(`⚠️ Outlet ${outletName} (${outletId}) does not have openingBalanceDate. Skipping.`);
          errors.push({ outletId, error: 'openingBalanceDate not set' });
          continue;
        }
        
        // Check if date is before this outlet's opening balance date
        if (dateString < outletOpeningBalanceDate) {
          console.log(`⚠️ Date ${dateString} is before opening balance date ${outletOpeningBalanceDate} for ${outletName}. Skipping this outlet.`);
          continue;
        }
        
        // Determine opening balance based on date
        let openingBalance = 0;
        
        // If this is the opening balance date, use outlet's opening balance
        if (dateString === outletOpeningBalanceDate) {
          openingBalance = outletOpeningBalance;
          console.log(`📅 Using outlet's opening balance ₹${openingBalance} for ${outletName} on opening balance date ${outletOpeningBalanceDate}`);
        } else {
          // For dates after opening balance date, use previous day's closing balance
          const previousDate = new Date(date);
          previousDate.setDate(previousDate.getDate() - 1);
          previousDate.setHours(0, 0, 0, 0);
          
          // Format previous date using same method as current date (local timezone)
          const prevYear = previousDate.getFullYear();
          const prevMonth = String(previousDate.getMonth() + 1).padStart(2, '0');
          const prevDay = String(previousDate.getDate()).padStart(2, '0');
          const previousDateString = `${prevYear}-${prevMonth}-${prevDay}`;
          
          // Try to get previous day's closing balance from date document
          const previousDateDoc = await db.collection('daily_closing_balances')
            .doc(previousDateString)
            .get();
          
          if (previousDateDoc.exists) {
            const previousDateData = previousDateDoc.data();
            // Check if outlets object exists and has this outlet
            if (previousDateData.outlets && previousDateData.outlets[outletId]) {
              openingBalance = previousDateData.outlets[outletId].closingBalance || 0;
              console.log(`📅 Using previous day's closing balance ₹${openingBalance} for ${outletName} on ${dateString} (from ${previousDateString})`);
            } else {
              console.warn(`⚠️ Previous day's document exists but outlet ${outletId} not found. Using 0 as opening balance.`);
              openingBalance = 0;
            }
          } else {
            // If previous day's balance not found, try to get from opening balance date
            if (previousDateString >= outletOpeningBalanceDate) {
              // Previous date is after opening balance date but document doesn't exist
              // Try to get from opening balance date as fallback
              const openingBalanceDateDoc = await db.collection('daily_closing_balances')
                .doc(outletOpeningBalanceDate)
                .get();
              
              if (openingBalanceDateDoc.exists) {
                const openingBalanceDateData = openingBalanceDateDoc.data();
                if (openingBalanceDateData.outlets && openingBalanceDateData.outlets[outletId]) {
                  openingBalance = openingBalanceDateData.outlets[outletId].closingBalance || outletOpeningBalance;
                  console.log(`📅 Using opening balance date's closing balance ₹${openingBalance} for ${outletName} (previous date ${previousDateString} not found, using ${outletOpeningBalanceDate})`);
                } else {
                  openingBalance = outletOpeningBalance;
                  console.log(`📅 Using outlet's opening balance ₹${openingBalance} for ${outletName} (outlet not found in opening balance date document)`);
                }
              } else {
                // Opening balance date document also doesn't exist, use outlet's opening balance
                openingBalance = outletOpeningBalance;
                console.log(`📅 Using outlet's opening balance ₹${openingBalance} for ${outletName} (previous date ${previousDateString} and opening balance date ${outletOpeningBalanceDate} not found)`);
              }
            } else {
              // If previous date is before opening balance date, use outlet's opening balance
              openingBalance = outletOpeningBalance;
              console.log(`📅 Using outlet's opening balance ₹${openingBalance} for ${outletName} (previous date ${previousDateString} is before opening balance date)`);
            }
          }
        }
        
        // Calculate order amount for the day
        // Query by date range first, then filter by outletId and only include delivered orders
        let orderAmount = 0;
        const ordersSnapshot = await db.collection('orders')
          .where('Created at', '>=', startOfDay)
          .where('Created at', '<=', endOfDay)
          .get();
        
        ordersSnapshot.forEach(orderDoc => {
          const orderData = orderDoc.data();
          // Only include orders for this outlet that are delivered
          if (orderData.outletId === outletId && orderData.status === 'delivered') {
            orderAmount += parseFloat(orderData['total amount'] || 0);
          }
        });
        
        // Calculate return amount for the day
        let returnAmount = 0;
        try {
          // Try to use date range query (requires index)
          const returnsSnapshot = await db.collection('returns')
            .where('createdAt', '>=', startOfDay)
            .where('createdAt', '<=', endOfDay)
            .get();
          
          returnsSnapshot.forEach(returnDoc => {
            const returnData = returnDoc.data();
            if (returnData.outletId === outletId) {
              returnAmount += parseFloat(returnData.totalAmount || 0);
            }
          });
        } catch (error) {
          // Fallback: query all returns and filter in memory (if index doesn't exist)
          console.warn(`Warning: Could not use date range query for returns, falling back to full query: ${error.message}`);
          const returnsSnapshot = await db.collection('returns').get();
          returnsSnapshot.forEach(returnDoc => {
            const returnData = returnDoc.data();
            if (returnData.outletId === outletId && returnData.createdAt) {
              let returnDate = null;
              if (returnData.createdAt._seconds) {
                returnDate = new Date(returnData.createdAt._seconds * 1000);
              } else if (returnData.createdAt.toDate) {
                returnDate = returnData.createdAt.toDate();
              } else {
                returnDate = new Date(returnData.createdAt);
              }
              if (returnDate >= date && returnDate < new Date(date.getTime() + 24 * 60 * 60 * 1000)) {
                returnAmount += parseFloat(returnData.totalAmount || 0);
              }
            }
          });
        }
        
        // Calculate payment amount for the day (only approved payments)
        let paymentAmount = 0;
        try {
          // Try to use date range query (requires index)
          const paymentsSnapshot = await db.collection('payments')
            .where('status', '==', 'approved')
            .where('createdAt', '>=', startOfDay)
            .where('createdAt', '<=', endOfDay)
            .get();
          
          paymentsSnapshot.forEach(paymentDoc => {
            const paymentData = paymentDoc.data();
            if (paymentData.outletId === outletId) {
              paymentAmount += parseFloat(paymentData.amount || 0);
            }
          });
        } catch (error) {
          // Fallback: query all approved payments and filter in memory (if index doesn't exist)
          console.warn(`Warning: Could not use date range query for payments, falling back to full query: ${error.message}`);
          const paymentsSnapshot = await db.collection('payments')
            .where('status', '==', 'approved')
            .get();
          
          paymentsSnapshot.forEach(paymentDoc => {
            const paymentData = paymentDoc.data();
            if (paymentData.outletId === outletId && paymentData.createdAt) {
              let paymentDate = null;
              if (paymentData.createdAt._seconds) {
                paymentDate = new Date(paymentData.createdAt._seconds * 1000);
              } else if (paymentData.createdAt.toDate) {
                paymentDate = paymentData.createdAt.toDate();
              } else {
                paymentDate = new Date(paymentData.createdAt);
              }
              if (paymentDate >= date && paymentDate < new Date(date.getTime() + 24 * 60 * 60 * 1000)) {
                paymentAmount += parseFloat(paymentData.amount || 0);
              }
            }
          });
        }
        
        // Calculate closing balance
        // Closing Balance = Opening Balance + Orders - Returns - Payments
        const closingBalance = openingBalance + orderAmount - returnAmount - paymentAmount;
        
        // Store outlet data in results array (will be stored together after processing all outlets)
        results.push({
          outletId,
          outletName,
          openingBalance,
          orderAmount,
          returnAmount,
          paymentAmount,
          closingBalance,
        });
        
        console.log(`✅ Calculated closing balance for ${outletName} (${outletId}): ₹${closingBalance.toFixed(2)}`);
        
      } catch (error) {
        console.error(`❌ Error processing outlet ${outletDoc.id}:`, error);
        errors.push({ outletId: outletDoc.id, error: error.message });
      }
    }
    
    // Store all outlets data as nested objects in date document
    // Structure: date document → outlets object → individual outlet data
    // daily_closing_balances/{date} contains { date, outlets: { outletId1: {...}, outletId2: {...} } }
    if (results.length > 0) {
      try {
        // Convert results array to outlets object (keyed by outletId)
        const outletsObject = {};
        results.forEach(outlet => {
          outletsObject[outlet.outletId] = {
            outletId: outlet.outletId,
            outletName: outlet.outletName,
            openingBalance: outlet.openingBalance,
            orderAmount: outlet.orderAmount,
            returnAmount: outlet.returnAmount,
            paymentAmount: outlet.paymentAmount,
            closingBalance: outlet.closingBalance,
          };
        });
        
        // Create or update the date document with outlets as nested object
        const dateDocument = {
          date: dateString,
          outlets: outletsObject,
          timestamp: admin.firestore.Timestamp.now(),
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        };
        
        // Store in Firestore with date as document ID
        await db.collection('daily_closing_balances').doc(dateString).set(dateDocument, { merge: true });
        
        console.log(`💾 Stored closing balance data for ${dateString} with ${results.length} outlets`);
      } catch (error) {
        console.error('❌ Error storing closing balance document:', error);
        errors.push({ error: 'Failed to store document', details: error.message });
      }
    }
    
    console.log(`✅ Daily closing balance calculation completed for ${dateString}`);
    console.log(`   Processed: ${results.length} outlets`);
    if (errors.length > 0) {
      console.log(`   Errors: ${errors.length}`);
    }
    
    return {
      success: true,
      date: dateString,
      processed: results.length,
      errors: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    };
    
  } catch (error) {
    console.error('❌ Error calculating daily closing balance:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Backfill closing balances from earliest opening balance date to today
 */
export const backfillClosingBalances = async () => {
  try {
    const db = getFirestoreDB();
    
    // Get all outlets to find the earliest openingBalanceDate
    const outletsSnapshot = await db.collection('outlets').get();
    
    if (outletsSnapshot.empty) {
      return {
        success: false,
        error: 'No outlets found',
      };
    }
    
    // Find the earliest openingBalanceDate from all outlets
    let earliestDate = null;
    outletsSnapshot.forEach(outletDoc => {
      const outletData = outletDoc.data();
      const openingBalanceDate = outletData.openingBalanceDate;
      if (openingBalanceDate) {
        if (!earliestDate || openingBalanceDate < earliestDate) {
          earliestDate = openingBalanceDate;
        }
      }
    });
    
    if (!earliestDate) {
      return {
        success: false,
        error: 'No outlets have openingBalanceDate set',
      };
    }
    
    // Parse earliest date to get the start date
    const [startYear, startMonth, startDay] = earliestDate.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, startDay);
    startDate.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    console.log(`🔄 Starting backfill from ${earliestDate} (earliest opening balance date) to ${todayStr}...`);
    
    const results = [];
    const errors = [];
    
    // Loop through each date from earliest opening balance date to today
    for (let date = new Date(startDate); date <= today; date.setDate(date.getDate() + 1)) {
      const dateCopy = new Date(date); // Create a copy to avoid mutation issues
      dateCopy.setHours(0, 0, 0, 0);
      
      const result = await calculateDailyClosingBalance(dateCopy);
      
      if (result.success) {
        results.push(result.date);
        console.log(`✅ Backfilled closing balance for ${result.date}`);
      } else {
        const dateStr = `${dateCopy.getFullYear()}-${String(dateCopy.getMonth() + 1).padStart(2, '0')}-${String(dateCopy.getDate()).padStart(2, '0')}`;
        errors.push({ date: dateStr, error: result.message || result.error });
        console.log(`⚠️ Skipped ${dateStr}: ${result.message || result.error}`);
      }
    }
    
    console.log(`✅ Backfill completed. Processed: ${results.length} dates, Errors: ${errors.length}`);
    
    return {
      success: true,
      processed: results.length,
      errors: errors.length,
      dates: results,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error('❌ Error in backfill:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * API endpoint handler for calculating daily closing balance
 */
export const calculateClosingBalance = async (req, res) => {
  try {
    // Optional: Allow date to be passed as query parameter (for manual runs or testing)
    let targetDate = null;
    if (req.query.date) {
      targetDate = new Date(req.query.date);
      if (isNaN(targetDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
    }
    
    const result = await calculateDailyClosingBalance(targetDate);
    
    if (result.success) {
      res.status(200).json({
        message: 'Daily closing balance calculated successfully',
        ...result,
      });
    } else {
      res.status(500).json({
        error: 'Failed to calculate daily closing balance',
        details: result.error || result.message,
      });
    }
  } catch (error) {
    console.error('Error in calculateClosingBalance endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get daily closing balance for a specific outlet and date range
 */
export const getClosingBalance = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { outletId, startDate, endDate, date } = req.query;
    
    // If specific date is provided, return that date's data
    if (date) {
      const dateDoc = await db.collection('daily_closing_balances').doc(date).get();
      if (!dateDoc.exists) {
        return res.status(404).json({ error: `No closing balance data found for date ${date}` });
      }
      
      const dateData = dateDoc.data();
      
      // If outletId is specified, return only that outlet's data from nested outlets object
      if (outletId) {
        if (!dateData.outlets || !dateData.outlets[outletId]) {
          return res.status(404).json({ error: `No closing balance data found for outlet ${outletId} on date ${date}` });
        }
        
        return res.status(200).json({
          date: dateData.date,
          outlet: dateData.outlets[outletId],
          timestamp: dateData.timestamp,
        });
      }
      
      // Return all outlets for the date from nested outlets object
      return res.status(200).json({
        date: dateData.date,
        outlets: dateData.outlets || {},
        timestamp: dateData.timestamp,
      });
    }
    
    // If date range is provided, query multiple dates
    if (startDate && endDate) {
      const dates = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      // Generate all dates in range
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }
      
      // Fetch all dates with their outlets
      const datePromises = dates.map(async dateStr => {
        const dateDoc = await db.collection('daily_closing_balances').doc(dateStr).get();
        if (!dateDoc.exists) {
          return null;
        }
        
        const dateData = dateDoc.data();
        
        // If outletId is specified, get only that outlet from nested outlets object
        if (outletId) {
          if (!dateData.outlets || !dateData.outlets[outletId]) {
            return null;
          }
          
          return {
            date: dateData.date,
            outlet: dateData.outlets[outletId],
            timestamp: dateData.timestamp,
          };
        }
        
        // Get all outlets for this date from nested outlets object
        return {
          date: dateData.date,
          outlets: dateData.outlets || {},
          timestamp: dateData.timestamp,
        };
      });
      
      const balances = (await Promise.all(datePromises)).filter(item => item !== null);
      
      return res.status(200).json(balances);
    }
    
    // If no filters, return error (too many documents to fetch all)
    res.status(400).json({ 
      error: 'Please provide either a specific date or date range (startDate and endDate)' 
    });
  } catch (error) {
    console.error('Error fetching closing balance:', error);
    res.status(500).json({ error: 'Failed to fetch closing balance' });
  }
};

