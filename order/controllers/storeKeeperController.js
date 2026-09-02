import { getFirestoreDB } from '../../util/firebase.js';
import { filterByTenant, matchesTenant } from '../../util/tenant.js';

// Create Store Keeper
export const createStoreKeeper = async (req, res) => {
  try {
    const { name, phoneNumber } = req.body;

    // Validate inputs
    if (!name || !phoneNumber) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Check if phone number is 10 digits
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ error: 'Phone number must be exactly 10 digits' });
    }

    const db = getFirestoreDB();

    // Check if phone number already exists
    const snapshot = await db.collection('storeKeepers').where('phoneNumber', '==', phoneNumber).get();
    const duplicate = snapshot.docs.some((doc) => matchesTenant(doc.data()?.tenantId, req.tenantId));
    if (duplicate) {
      return res.status(409).json({ error: 'Store keeper with this phone number already exists' });
    }

    // Add to DB
    const now = new Date().toISOString();
    const newDocRef = await db.collection('storeKeepers').add({
      name,
      phoneNumber,
      tenantId: req.tenantId || 'nannu_milk',
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({ message: 'Store keeper created', id: newDocRef.id });
  } catch (error) {
    console.error('Error creating store keeper:', error);
    res.status(500).json({ error: 'Failed to create store keeper' });
  }
};


// Get All Store Keepers
export const getAllStoreKeepers = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const snapshot = await db.collection('storeKeepers').get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(filterByTenant(data, req.tenantId));
  } catch (err) {
    console.error('Fetch Store Keepers error:', err);
    res.status(500).json({ error: 'Failed to fetch Store Keepers' });
  }
};

// Get Store Keeper by ID
export const getStoreKeeperById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const doc = await db.collection('storeKeepers').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Store Keeper not found' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('Get Store Keeper error:', err);
    res.status(500).json({ error: 'Failed to fetch Store Keeper' });
  }
};

// Update Store Keeper
export const updateStoreKeeper = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const { name, phoneNumber } = req.body;

    if (!name || !phoneNumber) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Validate phone number
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ error: 'Phone number must be 10 digits' });
    }

    // Check if the phone number is used by another user
    const snapshot = await db.collection('storeKeepers')
      .where('phoneNumber', '==', phoneNumber)
      .get();

    const isDuplicate = snapshot.docs.some(doc => doc.id !== id);
    if (isDuplicate) {
      return res.status(409).json({ error: 'Phone number already used by another store keeper' });
    }

    // Check if the document exists
    const docRef = db.collection('storeKeepers').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Store keeper not found' });
    }

    await docRef.update({
      name,
      phoneNumber,
      updatedAt: new Date().toISOString(),
    });

    // Return the updated document
    const updatedDoc = await docRef.get();
    res.status(200).json({ id, ...updatedDoc.data() });
  } catch (error) {
    console.error('Error updating store keeper:', error);
    res.status(500).json({ error: 'Failed to update store keeper' });
  }
};


// Delete Store Keeper
export const deleteStoreKeeper = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;

    await db.collection('storeKeepers').doc(id).delete();
    res.status(200).json({ message: 'Store Keeper deleted' });
  } catch (err) {
    console.error('Delete Store Keeper error:', err);
    res.status(500).json({ error: 'Failed to delete Store Keeper' });
  }
};

// Search Store Keepers by Name or Phone Number
export const searchStoreKeepers = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { query = '' } = req.query;
    const lowerQuery = query.toLowerCase();

    const snapshot = await db.collection('storeKeepers').get();
    const results = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(sk =>
        (sk.name && sk.name.toLowerCase().includes(lowerQuery)) ||
        (sk.phoneNumber && sk.phoneNumber.includes(query))
      );

    res.status(200).json(results);
  } catch (error) {
    console.error('Error searching store keepers:', error);
    res.status(500).json({ error: 'Failed to search store keepers' });
  }
};

