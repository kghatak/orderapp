// controllers/authController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { NannuUser } from '../models/NannuUser.js';
import { getMilkTokenForOrderAdmin } from '../../milk/controllers/milkAuthController.js';
import { isMongoConnected } from '../../config/db.js';
import { canonicalizeTenantId, isAllowedOrderTenantId } from '../../util/tenantMiddleware.js';
import { nextTenantCounter } from '../../util/tenantCounter.js';

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
    const validProfiles = ['Admin', 'Outlet', 'StoreKeeper', 'OutletStorekeeper'];
    if (!validProfiles.includes(userProfile)) {
      return res.status(400).json({
        success: false,
        message: 'userProfile must be one of: Admin, Outlet, StoreKeeper, OutletStorekeeper'
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
    let storeKeeperTenantId = '';
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
      storeKeeperTenantId = storeKeeperSnapshot.docs[0].data().tenantId || '';
    }

    // Outlet signup must use the outlet's own tenant. The phone app looks this up
    // through the API so it hits the same Firestore project that created the outlet.
    let outletIdForUser = '';
    let outletTenantId = '';
    let storekeeperDoc = null;
    let storekeeperName = '';
    let storekeeperOutletName = '';
    if (userProfile === 'OutletStorekeeper') {
      const storekeeperSnapshot = await db.collection('outlet_storekeepers')
        .where('phoneNumber', '==', phoneNumber)
        .get();

      const activeStorekeeper = storekeeperSnapshot.docs.find((doc) => doc.data().isActive === true) || null;
      if (activeStorekeeper && activeStorekeeper.data().needsSignup !== true) {
        return res.status(409).json({
          success: false,
          message: 'This storekeeper has already signed up. Please login.'
        });
      }

      storekeeperDoc = activeStorekeeper;

      if (!storekeeperDoc) {
        return res.status(400).json({
          success: false,
          message: 'This phone number is not registered as an Outlet Storekeeper. Please contact your outlet owner to add you as a storekeeper first.'
        });
      }

      const storekeeper = storekeeperDoc.data();
      outletIdForUser = storekeeper.outletId || '';
      storekeeperName = storekeeper.name || '';
      storekeeperOutletName = storekeeper.outletName || '';
      outletTenantId = storekeeper.tenantId || '';

      if (outletIdForUser && (!outletTenantId || !storekeeperOutletName)) {
        const outletDoc = await db.collection('outlets').doc(outletIdForUser).get();
        if (outletDoc.exists) {
          const outlet = outletDoc.data();
          if (!outletTenantId) outletTenantId = outlet.tenantId || '';
          if (!storekeeperOutletName) storekeeperOutletName = outlet.name || '';
        }
      }

      if (!outletIdForUser) {
        return res.status(400).json({
          success: false,
          message: 'Outlet is not assigned to this storekeeper'
        });
      }
      if (!outletTenantId || !isAllowedOrderTenantId(canonicalizeTenantId(outletTenantId))) {
        return res.status(400).json({
          success: false,
          message: 'Tenant is not assigned to this outlet'
        });
      }
    }

    if (userProfile === 'Outlet') {
      const phoneAsNumber = Number(phoneNumber);
      const numericQuery = Number.isSafeInteger(phoneAsNumber)
        ? db.collection('outlets').where('primaryPhoneNumber', '==', phoneAsNumber).limit(5).get()
        : Promise.resolve({ docs: [] });
      const [numericSnapshot, stringSnapshot] = await Promise.all([
        numericQuery,
        db.collection('outlets').where('primaryPhoneNumber', '==', phoneNumber).limit(5).get(),
      ]);

      const matches = new Map();
      for (const doc of [...numericSnapshot.docs, ...stringSnapshot.docs]) {
        matches.set(doc.id, doc);
      }
      const outletDoc = [...matches.values()].find((doc) => doc.data().active !== false);

      if (!outletDoc) {
        return res.status(400).json({
          success: false,
          message: 'This phone number is not associated with any outlet. Please use the primary phone number registered with your outlet.'
        });
      }

      outletIdForUser = outletDoc.id;
      outletTenantId = outletDoc.data().tenantId || '';
      if (!outletTenantId || !isAllowedOrderTenantId(canonicalizeTenantId(outletTenantId))) {
        return res.status(400).json({
          success: false,
          message: 'Tenant is not assigned to this outlet'
        });
      }
    }

    const resolvedTenantId = canonicalizeTenantId(
      userProfile === 'Outlet' || userProfile === 'OutletStorekeeper'
        ? outletTenantId
        : (tenantId || storeKeeperTenantId)
    );
    const { globalCount } = await nextTenantCounter(db, 'userCounter', resolvedTenantId);
    const userId = `UID${globalCount.toString().padStart(4, '0')}`;

    // Create user
    const user = new NannuUser({
      userId,
      phoneNumber,
      password,
      outletId: userProfile === 'Outlet' || userProfile === 'OutletStorekeeper' ? outletIdForUser : null,
      userProfile,
      tenantId: resolvedTenantId || '',
      enableNotification: true,
      fcmToken: fcmToken || ''
    });

    await db.collection('users').doc(userId).set({
      ...user,
      ...(userProfile === 'OutletStorekeeper'
        ? { name: storekeeperName, outletName: storekeeperOutletName }
        : {}),
    });

    if (userProfile === 'OutletStorekeeper' && storekeeperDoc) {
      await storekeeperDoc.ref.update({
        needsSignup: false,
        password,
        userId,
        tenantId: resolvedTenantId,
        updatedAt: new Date(),
      });
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        userId: user.userId,
        phoneNumber: user.phoneNumber,
        userProfile: user.userProfile,
        outletId: user.outletId,
        tenantId: user.tenantId || '',
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

    // users.tenantId can be empty for StoreKeepers; the admin-created storeKeepers doc holds the tenant.
    let userTenant = canonicalizeTenantId(userData.tenantId);
    if (!userTenant && (userData.userProfile === 'Outlet' || userData.userProfile === 'OutletStorekeeper') && outletData) {
      userTenant = canonicalizeTenantId(outletData.tenantId);
    }
    if (!userTenant && userData.userProfile === 'StoreKeeper') {
      const storeKeeperSnapshot = await db.collection('storeKeepers')
        .where('phoneNumber', '==', userData.phoneNumber)
        .limit(1)
        .get();
      if (!storeKeeperSnapshot.empty) {
        userTenant = canonicalizeTenantId(storeKeeperSnapshot.docs[0].data().tenantId);
      }
    }

    if (!userTenant || !isAllowedOrderTenantId(userTenant)) {
      return res.status(403).json({
        success: false,
        message: 'Tenant is not assigned to this user',
      });
    }

    const responseData = {
      userId: userData.userId || userDoc.id,
      phoneNumber: userData.phoneNumber,
      userProfile: userData.userProfile,
      outletId: userData.outletId,
      outletName: userData.outletName || (outletData && outletData.name) || '',
      name: userData.name || '',
      tenantId: userTenant || (userData.tenantId ?? ''),
      enableNotification: userData.enableNotification,
      fcmToken: userData.fcmToken,
      outlet: outletData ? {
        id: userData.outletId,
        name: outletData.name || '',
        tenantId: canonicalizeTenantId(outletData.tenantId) || userTenant,
        address: outletData.address || '',
      } : null,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt
    };

    // Milk JWT uses the user's refine-auth tenant from Firestore (not a body/hardcoded id).
    const milkEligibleProfiles = ['Admin', 'StoreKeeper'];
    if (
      milkEligibleProfiles.includes(userData.userProfile) &&
      userTenant &&
      isAllowedOrderTenantId(userTenant)
    ) {
      if (!isMongoConnected()) {
        console.warn('Login: milkToken skipped — MongoDB not connected.');
      } else {
        try {
          const milkAuth = await getMilkTokenForOrderAdmin(userTenant, userData.phoneNumber, password);
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

// Outlet owner adds a storekeeper who will sign up later.
// Written here so the record lands in the same Firestore project as signup.
export const createOutletStorekeeper = async (req, res) => {
  try {
    const { name, phoneNumber, outletId, outletName } = req.body;
    if (!name || !phoneNumber || !outletId) {
      return res.status(400).json({
        success: false,
        message: 'name, phoneNumber, and outletId are required'
      });
    }
    if (!/^\d{10}$/.test(String(phoneNumber))) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits'
      });
    }

    const db = getFirestoreDB();
    const outletDoc = await db.collection('outlets').doc(outletId).get();
    if (!outletDoc.exists) {
      return res.status(400).json({
        success: false,
        message: 'Outlet not found'
      });
    }

    const outlet = outletDoc.data();
    const tenantId = canonicalizeTenantId(outlet.tenantId);
    if (!tenantId || !isAllowedOrderTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: 'Tenant is not assigned to this outlet'
      });
    }

    const existing = await db.collection('outlet_storekeepers')
      .where('phoneNumber', '==', String(phoneNumber))
      .get();
    const alreadyActive = existing.docs.some((doc) => doc.data().isActive === true);
    if (alreadyActive) {
      return res.status(409).json({
        success: false,
        message: 'Phone number already registered with another storekeeper'
      });
    }

    const counterRef = db.collection('counters').doc('storekeeperIdCounter');
    const counterSnap = await counterRef.get();
    const current = counterSnap.exists ? (counterSnap.data().count || 0) : 0;
    const next = current + 1;
    await counterRef.set({ count: next }, { merge: true });
    const storekeeperId = `SK${String(next).padStart(6, '0')}`;
    const resolvedOutletName = String(outletName || outlet.name || '').trim();

    await db.collection('outlet_storekeepers').doc(storekeeperId).set({
      id: storekeeperId,
      name: String(name).trim(),
      phoneNumber: String(phoneNumber),
      outletId,
      outletName: resolvedOutletName,
      tenantId,
      isActive: true,
      needsSignup: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Storekeeper added successfully',
      data: {
        id: storekeeperId,
        name: String(name).trim(),
        phoneNumber: String(phoneNumber),
        outletId,
        outletName: resolvedOutletName,
        tenantId,
      }
    });
  } catch (err) {
    console.error('Create outlet storekeeper error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to add storekeeper'
    });
  }
};

function outletStorekeeperJson(doc) {
  const data = doc.data() || {};
  const createdAt = data.createdAt?.toDate?.() || data.createdAt || null;
  const updatedAt = data.updatedAt?.toDate?.() || data.updatedAt || null;
  return {
    id: data.id || doc.id,
    name: data.name || '',
    phoneNumber: data.phoneNumber || '',
    outletId: data.outletId || '',
    outletName: data.outletName || '',
    tenantId: data.tenantId || '',
    isActive: data.isActive !== false,
    needsSignup: data.needsSignup === true,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
}

export const listOutletStorekeepers = async (req, res) => {
  try {
    const outletId = String(req.query.outletId || '').trim();
    if (!outletId) {
      return res.status(400).json({
        success: false,
        message: 'outletId is required'
      });
    }

    const db = getFirestoreDB();
    const snapshot = await db.collection('outlet_storekeepers')
      .where('outletId', '==', outletId)
      .get();

    const storekeepers = snapshot.docs
      .filter((doc) => doc.data().isActive !== false)
      .map(outletStorekeeperJson)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    res.status(200).json({
      success: true,
      data: storekeepers,
    });
  } catch (err) {
    console.error('List outlet storekeepers error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to load storekeepers'
    });
  }
};

export const deleteOutletStorekeeper = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const ref = db.collection('outlet_storekeepers').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Storekeeper not found'
      });
    }

    await ref.update({
      isActive: false,
      updatedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Storekeeper deleted successfully',
    });
  } catch (err) {
    console.error('Delete outlet storekeeper error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete storekeeper'
    });
  }
};

