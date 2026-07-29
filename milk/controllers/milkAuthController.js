import jwt from 'jsonwebtoken';
import { MilkUser } from '../models/MilkUser.js';
import { Supplier } from '../models/Supplier.js';
import { getFirestoreDB } from '../../util/firebase.js';

const JWT_SECRET = process.env.JWT_SECRET || 'milk-procurement-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/** Order app profiles allowed to use milk procurement (Admin + StoreKeeper). */
const MILK_ELIGIBLE_ORDER_PROFILES = ['Admin', 'StoreKeeper'];

// Admin users come from Order app (Firestore). Only suppliers sign up here.
export const signup = async (req, res) => {
  try {
    const { tenantId, role, name, phone, email, password, fcmToken } = req.body;

    if (!tenantId || !role || !name || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'tenantId, role, name, phone, and password are required'
      });
    }

    if (role !== 'supplier') {
      return res.status(400).json({
        success: false,
        message: 'Only supplier role can sign up. Admin uses Order app login.'
      });
    }

    if (phone.length < 10 || !/^\d+$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone must be at least 10 digits and contain only numbers'
      });
    }

    const existing = await MilkUser.findOne({ tenantId, phone });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'User with this phone already exists for this tenant'
      });
    }

    const user = new MilkUser({
      tenantId,
      role,
      name,
      phone,
      email: email || '',
      password,
      fcmToken: fcmToken || ''
    });
    await user.save();

    // Link supplier user to Supplier record if exists (admin creates Supplier first, supplier signs up with same phone)
    if (role === 'supplier') {
      await Supplier.findOneAndUpdate(
        { tenantId, phone },
        { $set: { userId: user._id, updatedAt: new Date() } }
      );
    }

    const token = jwt.sign(
      { userId: user._id, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        userId: user._id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        phone: user.phone,
        email: user.email,
        token,
        expiresIn: JWT_EXPIRES
      }
    });
  } catch (err) {
    console.error('Milk signup error:', err);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
};

export const login = async (req, res) => {
  try {
    const { tenantId, phone, password, fcmToken } = req.body;

    if (!tenantId || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'tenantId, phone, and password are required'
      });
    }

    // 1. Try MilkUser first
    let user = await MilkUser.findOne({ tenantId, phone });
    if (!user) {
      // 2. Fallback: check Order app Admin / StoreKeeper (Firestore)
      const orderAdmin = await validateOrderMilkUser(phone, password);
      if (orderAdmin) {
        user = await getOrCreateMilkAdmin(tenantId, orderAdmin);
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or password'
      });
    }

    // Password check: suppliers use MilkUser; admin always validates against Order app
    if (user.role === 'admin') {
      const orderAdmin = await validateOrderMilkUser(phone, password);
      if (!orderAdmin) {
        return res.status(401).json({
          success: false,
          message: 'Invalid phone or password'
        });
      }
    } else if (user.password !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or password'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive'
      });
    }

    if (fcmToken) {
      user.fcmToken = fcmToken;
      user.updatedAt = new Date();
      await user.save();
    }

    const token = jwt.sign(
      { userId: user._id, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        userId: user._id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        phone: user.phone,
        email: user.email,
        token,
        expiresIn: JWT_EXPIRES
      }
    });
  } catch (err) {
    console.error('Milk login error:', err);
    res.status(500).json({ success: false, message: 'Failed to login' });
  }
};

/** Validate Order app Admin / StoreKeeper from Firestore. Returns user data or null. */
async function validateOrderMilkUser(phone, password) {
  try {
    const db = getFirestoreDB();
    // Single-field query (same as /auth/login) — avoids Firestore composite index on phoneNumber + userProfile
    const snapshot = await db.collection('users')
      .where('phoneNumber', '==', phone)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    const data = doc.data();
    if (!MILK_ELIGIBLE_ORDER_PROFILES.includes(data.userProfile)) return null;
    if (data.password !== password) return null;
    const defaultName = data.userProfile === 'StoreKeeper' ? 'StoreKeeper' : 'Admin';
    return {
      userId: doc.id,
      name: data.userId || data.name || defaultName,
      phone: data.phoneNumber,
      userProfile: data.userProfile
    };
  } catch (err) {
    console.error('Order milk user validation error:', err);
    return null;
  }
}

/** Get or create MilkUser with admin role for Order app Admin / StoreKeeper. */
async function getOrCreateMilkAdmin(tenantId, orderUser) {
  let user = await MilkUser.findOne({ tenantId, phone: orderUser.phone });
  if (!user) {
    user = new MilkUser({
      tenantId,
      role: 'admin',
      name: orderUser.name || 'Admin',
      phone: orderUser.phone,
      email: '',
      password: 'order-admin' // Placeholder; always validated via Order app
    });
    await user.save();
  }
  return user;
}

/**
 * Get milk JWT for Order app Admin / StoreKeeper. Used when Order login includes tenantId.
 * Returns { token, tenantId, expiresIn } or null.
 */
export async function getMilkTokenForOrderAdmin(tenantId, phone, password) {
  try {
    const orderAdmin = await validateOrderMilkUser(phone, password);
    if (!orderAdmin) return null;
    const user = await getOrCreateMilkAdmin(tenantId, orderAdmin);
    const token = jwt.sign(
      { userId: user._id, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );
    return { token, tenantId: user.tenantId, expiresIn: JWT_EXPIRES };
  } catch (err) {
    console.error('getMilkTokenForOrderAdmin:', err);
    return null;
  }
}
