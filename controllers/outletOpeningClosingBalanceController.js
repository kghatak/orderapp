// controllers/outletOpeningClosingBalanceController.js
import { getFirestoreDB } from '../util/firebase.js';
import { OutletOpeningClosingBalance } from '../models/outletOpeningClosingBalance.js';
import admin from 'firebase-admin';

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

