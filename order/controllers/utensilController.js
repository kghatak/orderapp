// controllers/utensilController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { filterByTenant, matchesTenant } from '../../util/tenant.js';
import admin from 'firebase-admin';

// Generate Utensil ID in format UTEN-00001
const generateUtensilId = async () => {
  const db = getFirestoreDB();
  const snapshot = await db.collection('utensils').orderBy('createdAt', 'desc').limit(1).get();
  let lastId = 0;
  if (!snapshot.empty) {
    const lastDoc = snapshot.docs[0];
    const id = lastDoc.data().utensilId;
    if (id) {
      lastId = parseInt(id.replace('UTEN-', ''));
    }
  }
  const newId = lastId + 1;
  return `UTEN-${newId.toString().padStart(5, '0')}`;
};

// Create Utensil
export const createUtensil = async (req, res) => {
  try {
    const {
      name,
      type,
      quantity,
      actualQuantity,
    } = req.body;

    if (!name || !type || !quantity) {
      return res.status(400).json({ error: 'Required fields: name, type, quantity' });
    }

    const db = getFirestoreDB();
    const utensilId = await generateUtensilId();

    const utensilData = {
      utensilId,
      name,
      type,
      quantity,
      actualQuantity: actualQuantity || quantity, // Use provided actualQuantity or default to quantity
      tenantId: req.tenantId || 'nannu_milk',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('utensils').doc(utensilId).set(utensilData);
    res.status(201).json({ 
      message: 'Utensil created successfully', 
      id: utensilId,
      ...utensilData 
    });
  } catch (error) {
    console.error('Create utensil error:', error);
    res.status(500).json({ error: 'Failed to create utensil' });
  }
};

// Get Utensil by ID
export const getUtensilById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const doc = await db.collection('utensils').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Utensil not found' });
    }
    if (!matchesTenant(doc.data()?.tenantId, req.tenantId)) {
      return res.status(404).json({ error: 'Utensil not found' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('Get utensil error:', err);
    res.status(500).json({ error: 'Failed to fetch utensil' });
  }
};

// Get All Utensils with pagination for Refine framework
export const getAllUtensils = async (req, res) => {
  try {
    const db = getFirestoreDB();
    let { _start = 0, _end = 10 } = req.query;
    _start = parseInt(_start);
    _end = parseInt(_end);

    const totalSnapshot = await db.collection('utensils').get();
    let utensils = totalSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    utensils = filterByTenant(utensils, req.tenantId);
    const totalCount = utensils.length;
    utensils = utensils.slice(_start, _end);

    // Set headers that Refine expects
    res.set('X-Total-Count', totalCount.toString());
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');

    res.status(200).json(utensils);
    
  } catch (error) {
    console.error('Fetch utensils error:', error);
    res.status(500).json({ error: 'Failed to fetch utensils', details: error.message });
  }
};

// Update Utensil
export const updateUtensil = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const data = req.body;

    // Check if utensil exists
    const docRef = db.collection('utensils').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Utensil not found' });
    }

    // Add updated timestamp
    data.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await docRef.update(data);

    // Fetch and return the updated utensil
    const updatedDoc = await docRef.get();
    res.status(200).json({ 
      message: 'Utensil updated successfully',
      id: updatedDoc.id,
      ...updatedDoc.data()
    });
  } catch (error) {
    console.error('Update utensil error:', error);
    res.status(500).json({ error: 'Failed to update utensil' });
  }
};

// Delete Utensil
export const deleteUtensil = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    
    // Check if utensil exists
    const docRef = db.collection('utensils').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Utensil not found' });
    }
    
    await docRef.delete();
    res.status(200).json({ message: 'Utensil deleted successfully' });
  } catch (error) {
    console.error('Delete utensil error:', error);
    res.status(500).json({ error: 'Failed to delete utensil' });
  }
}; 