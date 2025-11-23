// controllers/authController.js
import { getFirestoreDB } from '../util/firebase.js';
import { NannuUser } from '../models/NannuUser.js';

// Signup API
export const signup = async (req, res) => {
  try {
    const { phoneNumber, password, confirmPassword, userProfile, adminCode, fcmToken } = req.body;
    const db = getFirestoreDB();

    // Validation
    if (!phoneNumber || !password || !confirmPassword || !userProfile) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber, password, confirmPassword, and userProfile are required'
      });
    }

    // Phone number format validation (minimum 10 digits)
    if (phoneNumber.length < 10 || !/^\d+$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be at least 10 digits and contain only numbers'
      });
    }

    // Password confirmation match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirm password do not match'
      });
    }

    // Validate userProfile
    const validProfiles = ['Admin', 'Outlet', 'StoreKeeper'];
    if (!validProfiles.includes(userProfile)) {
      return res.status(400).json({
        success: false,
        message: 'userProfile must be one of: Admin, Outlet, StoreKeeper'
      });
    }

    // Admin code validation for Admin users
    if (userProfile === 'Admin') {
      if (!adminCode || adminCode !== 'ADMIN123') {
        return res.status(400).json({
          success: false,
          message: 'Invalid admin code for Admin user'
        });
      }
    }

    // Check if user account already exists
    const existingUserSnapshot = await db.collection('users')
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (!existingUserSnapshot.empty) {
      return res.status(409).json({
        success: false,
        message: 'User with this phone number already exists'
      });
    }

    // Check if phone number is used by outlet (for Admin and StoreKeeper)
    if (userProfile === 'Admin' || userProfile === 'StoreKeeper') {
      const outletSnapshot = await db.collection('outlets')
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();

      if (!outletSnapshot.empty) {
        return res.status(409).json({
          success: false,
          message: 'Phone number is already used by an outlet'
        });
      }
    }

    // For StoreKeeper users, check if phone number exists in storeKeepers collection
    if (userProfile === 'StoreKeeper') {
      const storeKeeperSnapshot = await db.collection('storeKeepers')
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();

      if (storeKeeperSnapshot.empty) {
        return res.status(400).json({
          success: false,
          message: 'Phone number not found in storeKeepers collection'
        });
      }
    }

    // Generate User ID
    const userCounterRef = db.collection('counters').doc('userCounter');
    const userCounterDoc = await userCounterRef.get();

    let currentCount = 1;
    if (userCounterDoc.exists) {
      currentCount = userCounterDoc.data().count + 1;
    }

    const userId = `UID${currentCount.toString().padStart(4, '0')}`;

    // Update counter
    await userCounterRef.set({ count: currentCount });

    // Create user
    const user = new NannuUser({
      userId,
      phoneNumber,
      password,
      outletId: userProfile === 'Outlet' ? '' : null, // Will be set when linked to outlet
      userProfile,
      enableNotification: true,
      fcmToken: fcmToken || ''
    });

    await db.collection('users').doc(userId).set({ ...user });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        userId: user.userId,
        phoneNumber: user.phoneNumber,
        userProfile: user.userProfile,
        outletId: user.outletId,
        enableNotification: user.enableNotification,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
};

// Login API
export const login = async (req, res) => {
  try {
    const { phoneNumber, password, fcmToken } = req.body;
    const db = getFirestoreDB();

    // Validation
    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber and password are required'
      });
    }

    // Find user by phone number
    const userSnapshot = await db.collection('users')
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    // Verify password
    if (userData.password !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }

    // Update FCM token if provided
    if (fcmToken) {
      await db.collection('users').doc(userDoc.id).update({
        fcmToken: fcmToken,
        updatedAt: new Date()
      });
      userData.fcmToken = fcmToken;
    }

    // Get outlet information if user is linked to an outlet
    let outletData = null;
    if (userData.outletId) {
      const outletDoc = await db.collection('outlets').doc(userData.outletId).get();
      if (outletDoc.exists) {
        outletData = outletDoc.data();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        userId: userData.userId || userDoc.id,
        phoneNumber: userData.phoneNumber,
        userProfile: userData.userProfile,
        outletId: userData.outletId,
        enableNotification: userData.enableNotification,
        fcmToken: userData.fcmToken,
        outlet: outletData ? {
          outletId: outletData.outletId,
          outletName: outletData.outletName,
          address: outletData.address,
          phoneNumber: outletData.phoneNumber
        } : null,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
};
