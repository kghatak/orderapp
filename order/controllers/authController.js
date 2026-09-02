// controllers/authController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { NannuUser } from '../models/NannuUser.js';
import { getMilkTokenForOrderAdmin } from '../../milk/controllers/milkAuthController.js';
import { isMongoConnected } from '../../config/db.js';
import { DEFAULT_TENANT_ID, isValidTenantId, docTenantId } from '../../util/tenant.js';

// Signup API
export const signup = async (req, res) => {
  try {
    const { phoneNumber, password, confirmPassword, userProfile, adminCode, fcmToken, tenantId } = req.body;
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
      tenantId: (tenantId && isValidTenantId(tenantId)) ? String(tenantId).trim() : DEFAULT_TENANT_ID,
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
        tenantId: user.tenantId || DEFAULT_TENANT_ID,
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
    const { phoneNumber, password, fcmToken, tenantId } = req.body;
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

    const responseData = {
      userId: userData.userId || userDoc.id,
      phoneNumber: userData.phoneNumber,
      userProfile: userData.userProfile,
      outletId: userData.outletId,
      tenantId: docTenantId(userData.tenantId),
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
    };

    // If Admin or StoreKeeper and tenantId provided, include milk JWT (requires MongoDB + MilkUser)
    const milkEligibleProfiles = ['Admin', 'StoreKeeper'];
    if (milkEligibleProfiles.includes(userData.userProfile) && tenantId) {
      if (!isMongoConnected()) {
        console.warn('Login: milkToken skipped — MongoDB not connected (set MONGODB_URI).');
      } else {
        try {
          const milkAuth = await getMilkTokenForOrderAdmin(tenantId, userData.phoneNumber, password);
          if (milkAuth) {
            responseData.milkToken = milkAuth.token;
            responseData.milkTenantId = milkAuth.tenantId;
            responseData.milkTokenExpiresIn = milkAuth.expiresIn;
          }
        } catch (err) {
          console.error('Login: milk token failed (login still OK):', err.message);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: responseData
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
};

export const outletStorekeeperLogin = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;
    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber and password are required',
      });
    }

    const db = getFirestoreDB();
    const snapshot = await db.collection('outlet_storekeepers')
      .where('phoneNumber', '==', String(phoneNumber).trim())
      .get();

    const trimmedPassword = String(password).trim();
    let matched = null;
    snapshot.forEach((doc) => {
      if (matched) return;
      const data = doc.data();
      if (data.password === trimmedPassword && data.isActive === true) {
        matched = { id: doc.id, ...data };
      }
    });

    if (!matched) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        id: matched.id,
        name: matched.name,
        phoneNumber: matched.phoneNumber,
        outletId: matched.outletId,
        outletName: matched.outletName,
        userProfile: 'OutletStorekeeper',
        tenantId: docTenantId(matched.tenantId),
        createdAt: matched.createdAt,
        updatedAt: matched.updatedAt,
      },
    });
  } catch (err) {
    console.error('Outlet storekeeper login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login',
    });
  }
};

export const outletStorekeeperSignup = async (req, res) => {
  try {
    const { phoneNumber, password, confirmPassword } = req.body;
    if (!phoneNumber || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber, password, and confirmPassword are required',
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirm password do not match',
      });
    }

    const db = getFirestoreDB();
    const trimmedPhoneNumber = String(phoneNumber).trim();
    const trimmedPassword = String(password).trim();

    const snapshot = await db.collection('outlet_storekeepers')
      .where('phoneNumber', '==', trimmedPhoneNumber)
      .get();

    let storekeeperDoc = null;
    snapshot.forEach((doc) => {
      if (storekeeperDoc) return;
      const data = doc.data();
      if (data.isActive === true && data.needsSignup === true) {
        storekeeperDoc = doc;
      }
    });

    if (!storekeeperDoc) {
      return res.status(400).json({
        success: false,
        message: 'Storekeeper information not found',
      });
    }

    const storekeeperData = storekeeperDoc.data();
    if (storekeeperData.needsSignup !== true) {
      return res.status(400).json({
        success: false,
        message: 'Storekeeper already signed up',
      });
    }

    const userCounterRef = db.collection('counters').doc('userIdCounter');
    const userCounterDoc = await userCounterRef.get();
    let currentCount = 0;
    if (userCounterDoc.exists) {
      currentCount = userCounterDoc.data().count || 0;
    }
    const nextCount = currentCount + 1;
    const userId = `UID${nextCount.toString().padStart(4, '0')}`;
    await userCounterRef.set({ count: nextCount }, { merge: true });

    await db.collection('users').doc(userId).set({
      id: userId,
      phoneNumber: trimmedPhoneNumber,
      password: trimmedPassword,
      userProfile: 'OutletStorekeeper',
      outletId: storekeeperData.outletId,
      outletName: storekeeperData.outletName,
      name: storekeeperData.name,
      tenantId: storekeeperData.tenantId || DEFAULT_TENANT_ID,
      enableNotification: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await storekeeperDoc.ref.update({
      needsSignup: false,
      password: password,
      userId,
      updatedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { userId },
    });
  } catch (err) {
    console.error('Outlet storekeeper signup error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
    });
  }
};
