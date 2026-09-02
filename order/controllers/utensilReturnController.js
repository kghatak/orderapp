import { getFirestoreDB } from '../../util/firebase.js';
import { filterByTenant, matchesTenant } from '../../util/tenant.js';
import admin from 'firebase-admin';

const VALID_STATUSES = [
  'requested',
  'approved',
  'processing',
  'processed',
  'collected',
  'cancelled',
];

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value._seconds != null) return value._seconds * 1000;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const createUtensilReturn = async (req, res) => {
  try {
    const { items = [], outletId, outlet, notes = '' } = req.body;
    if (!Array.isArray(items) || items.length === 0 || !outletId || !outlet) {
      return res.status(400).json({ error: 'items, outletId, and outlet are required' });
    }

    const db = getFirestoreDB();
    const returnId = `UR${Date.now()}`;
    const returnRequest = {
      returnId,
      status: 'requested',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      items,
      notes,
      outlet,
      outletId,
      isArchived: false,
      tenantId: req.tenantId || 'nannu_milk',
    };

    const docRef = await db.collection('utensilReturnRequests').add(returnRequest);
    res.status(201).json({ message: 'Utensil return created successfully', id: docRef.id, returnId });
  } catch (error) {
    console.error('Error creating utensil return:', error);
    res.status(500).json({ error: 'Failed to create utensil return' });
  }
};

export const getAllUtensilReturns = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { _start = 0, _end = 10, outletId, from, to } = req.query;
    const start = parseInt(_start, 10) || 0;
    const end = parseInt(_end, 10) || 10;

    const snapshot = await db.collection('utensilReturnRequests').get();
    let returns = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    returns = filterByTenant(returns, req.tenantId);

    if (outletId) {
      returns = returns.filter((item) => item.outletId === outletId);
    } else {
      returns = returns.filter((item) => item.isArchived !== true);
    }

    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        returns = returns.filter((item) => toMillis(item.createdAt) >= fromDate.getTime());
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        returns = returns.filter((item) => toMillis(item.createdAt) <= toDate.getTime());
      }
    }

    returns.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    const total = returns.length;
    const paginated = returns.slice(start, end);

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
    res.status(200).json(paginated);
  } catch (error) {
    console.error('Error fetching utensil returns:', error);
    res.status(500).json({ error: 'Failed to fetch utensil returns' });
  }
};

export const updateUtensilReturnStatus = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const newStatus = String(status).toLowerCase();
    if (!VALID_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const docRef = db.collection('utensilReturnRequests').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Utensil return not found' });
    }

    const prevData = doc.data();
    if (!matchesTenant(prevData?.tenantId, req.tenantId)) {
      return res.status(404).json({ error: 'Utensil return not found' });
    }
    const prevStatus = (prevData.status || '').toLowerCase();

    if (newStatus === 'collected' && prevStatus !== 'collected') {
      const batch = db.batch();
      const items = prevData.items || [];
      for (const item of items) {
        const utensilId = item?.utensilId || '';
        const returnQuantity = item?.quantity || 0;
        if (utensilId && returnQuantity > 0) {
          batch.update(db.collection('utensils').doc(utensilId), {
            quantity: admin.firestore.FieldValue.increment(returnQuantity),
          });
        }
      }
      await batch.commit();
    }

    await docRef.update({
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const updated = await docRef.get();
    res.status(200).json({
      message: 'Utensil return status updated successfully',
      data: { id: updated.id, ...updated.data() },
    });
  } catch (error) {
    console.error('Error updating utensil return status:', error);
    res.status(500).json({ error: 'Failed to update utensil return status' });
  }
};

export const archiveUtensilReturn = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    await db.collection('utensilReturnRequests').doc(id).update({
      isArchived: true,
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ message: 'Utensil return archived successfully' });
  } catch (error) {
    console.error('Error archiving utensil return:', error);
    res.status(500).json({ error: 'Failed to archive utensil return' });
  }
};
