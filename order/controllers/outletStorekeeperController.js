import { getFirestoreDB } from '../../util/firebase.js';
import { filterByTenant, matchesTenant } from '../../util/tenant.js';
import admin from 'firebase-admin';

const getNextStorekeeperId = async (db) => {
  const counterRef = db.collection('counters').doc('storekeeperIdCounter');
  const counterSnapshot = await counterRef.get();
  let currentCounter = 0;
  if (counterSnapshot.exists) {
    currentCounter = counterSnapshot.data().count || 0;
  }
  const nextCounter = currentCounter + 1;
  await counterRef.set({ count: nextCounter });
  return `SK${nextCounter.toString().padStart(6, '0')}`;
};

export const getOutletStorekeepers = async (req, res) => {
  try {
    const { outletId } = req.query;
    if (!outletId) {
      return res.status(400).json({ error: 'outletId is required' });
    }

    const db = getFirestoreDB();
    const snapshot = await db.collection('outlet_storekeepers')
      .where('outletId', '==', outletId)
      .get();

    const storekeepers = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => item.isActive === true)
      .filter((item) => matchesTenant(item.tenantId, req.tenantId))
      .sort((a, b) => {
        const aTime = a.createdAt?.toDate?.()?.getTime?.() || a.createdAt?._seconds || 0;
        const bTime = b.createdAt?.toDate?.()?.getTime?.() || b.createdAt?._seconds || 0;
        return bTime - aTime;
      });

    res.status(200).json(storekeepers);
  } catch (error) {
    console.error('Error fetching outlet storekeepers:', error);
    res.status(500).json({ error: 'Failed to fetch outlet storekeepers' });
  }
};

export const createOutletStorekeeper = async (req, res) => {
  try {
    const { name, phoneNumber, outletId, outletName } = req.body;
    if (!name || !phoneNumber || !outletId || !outletName) {
      return res.status(400).json({ error: 'name, phoneNumber, outletId, and outletName are required' });
    }

    const db = getFirestoreDB();
    const existing = await db.collection('outlet_storekeepers')
      .where('phoneNumber', '==', phoneNumber)
      .get();

    const activeDuplicate = existing.docs.some((doc) => doc.data().isActive === true);
    if (activeDuplicate) {
      return res.status(409).json({ error: 'Phone number already registered with another storekeeper' });
    }

    const storekeeperId = await getNextStorekeeperId(db);
    await db.collection('outlet_storekeepers').doc(storekeeperId).set({
      id: storekeeperId,
      name,
      phoneNumber,
      outletId,
      outletName,
      isActive: true,
      needsSignup: true,
      tenantId: req.tenantId || 'nannu_milk',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ message: 'Storekeeper created', id: storekeeperId });
  } catch (error) {
    console.error('Error creating outlet storekeeper:', error);
    res.status(500).json({ error: 'Failed to create outlet storekeeper' });
  }
};

export const updateOutletStorekeeper = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const { name, phoneNumber } = req.body;
    const docRef = db.collection('outlet_storekeepers').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Storekeeper not found' });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (name != null) updateData.name = name;
    if (phoneNumber != null) updateData.phoneNumber = phoneNumber;

    await docRef.update(updateData);
    const updated = await docRef.get();
    res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    console.error('Error updating outlet storekeeper:', error);
    res.status(500).json({ error: 'Failed to update outlet storekeeper' });
  }
};

export const deleteOutletStorekeeper = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    await db.collection('outlet_storekeepers').doc(id).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ message: 'Storekeeper deleted' });
  } catch (error) {
    console.error('Error deleting outlet storekeeper:', error);
    res.status(500).json({ error: 'Failed to delete outlet storekeeper' });
  }
};
