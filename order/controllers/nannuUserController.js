// controllers/nannuUserController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { NannuUser } from '../models/NannuUser.js';

// Create Nannu User
export const createNannuUser = async (req, res) => {
  try {
    const { phoneNumber, password, outletId, userProfile, tenantId, enableNotification, fcmToken } = req.body;
    const db = getFirestoreDB();
    
    // Validation
    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber and password are required'
      });
    }
    
    // Check if user already exists with this phone number
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
    
    // Generate user ID
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
      outletId: outletId || '',
      userProfile: userProfile || 'Outlet',
      tenantId: tenantId || '',
      enableNotification: enableNotification !== undefined ? enableNotification : true,
      fcmToken: fcmToken || ''
    });
    
    await db.collection('users').doc(userId).set({ ...user });
    
    res.status(201).json({
      success: true,
      message: 'Nannu user created successfully',
      userId: userId,
      user: {
        userId: user.userId,
        phoneNumber: user.phoneNumber,
        outletId: user.outletId,
        userProfile: user.userProfile,
        tenantId: user.tenantId || '',
        enableNotification: user.enableNotification,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error('Create Nannu user error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create Nannu user'
    });
  }
};

// Get All Nannu Users with Refine framework pagination
export const getAllNannuUsers = async (req, res) => {
  try {
    const { _start = 0, _end = 10, outletId, userProfile } = req.query;
    const db = getFirestoreDB();
    
    let query = db.collection('users');

    const start = parseInt(_start);
    const end = parseInt(_end);
    const limit = end - start;
    
    // Apply filters
    if (outletId) {
      query = query.where('outletId', '==', outletId);
    }
    
    if (userProfile) {
      query = query.where('userProfile', '==', userProfile);
    }
    
    // Get total count for the X-Total-Count header (with filters applied)
    const totalSnapshot = await query.get();
    const totalCount = totalSnapshot.size;
    
    // Apply pagination using Refine framework pattern
    query = query
      .orderBy('createdAt', 'desc')
      .offset(start)
      .limit(limit);
    
    const snapshot = await query.get();
    const users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId || doc.id,
        phoneNumber: data.phoneNumber || '',
        password: data.password ? '****' : '',
        outletId: data.outletId || null,
        userProfile: data.userProfile || '',
        tenantId: data.tenantId ?? '',
        enableNotification: data.enableNotification !== undefined ? data.enableNotification : true,
        fcmToken: data.fcmToken || '',
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
      };
    });
    
    // Get all users for counting (without filters for accurate counts)
    const allUsersSnapshot = await db.collection('users').get();
    const allUsers = allUsersSnapshot.docs.map(doc => doc.data());
    
    // Calculate counts
    const totalUsers = allUsers.length;
    
    // User type wise count
    const userTypeCount = {};
    allUsers.forEach(user => {
      const userType = user.userProfile || 'Unknown';
      userTypeCount[userType] = (userTypeCount[userType] || 0) + 1;
    });
    
    // Notification enabled count
    const notificationEnabledCount = allUsers.filter(user => 
      user.enableNotification !== undefined ? user.enableNotification : true
    ).length;
    
    // Set headers that Refine expects
    res.set('X-Total-Count', totalCount.toString());
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    
    res.status(200).json({
      success: true,
      data: users,
      counts: {
        totalUsers: totalUsers,
        userTypeCount: userTypeCount,
        notificationEnabledCount: notificationEnabledCount,
        notificationDisabledCount: totalUsers - notificationEnabledCount
      }
    });
  } catch (err) {
    console.error('Get all Nannu users error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get Nannu users',
      details: err.message
    });
  }
};

// Get Nannu User by ID
export const getNannuUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getFirestoreDB();
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Nannu user not found'
      });
    }
    
    const userData = userDoc.data();
    
    res.status(200).json({
      success: true,
      data: {
        id: userId,
        userId: userData.userId || userId,
        phoneNumber: userData.phoneNumber || '',
        password: userData.password || '',
        outletId: userData.outletId || null,
        userProfile: userData.userProfile || '',
        tenantId: userData.tenantId ?? '',
        enableNotification: userData.enableNotification !== undefined ? userData.enableNotification : true,
        fcmToken: userData.fcmToken || '',
        createdAt: userData.createdAt || null,
        updatedAt: userData.updatedAt || null
      }
    });
  } catch (err) {
    console.error('Get Nannu user by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get Nannu user'
    });
  }
};

// Update Nannu User
export const updateNannuUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { phoneNumber, password, outletId, userProfile, tenantId, enableNotification, fcmToken } = req.body;
    const db = getFirestoreDB();
    
    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Nannu user not found'
      });
    }
    
    // Check if phone number is being changed and if it already exists
    if (phoneNumber && phoneNumber !== userDoc.data().phoneNumber) {
      const existingUserSnapshot = await db.collection('users')
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();
      
      if (!existingUserSnapshot.empty) {
        return res.status(409).json({
          success: false,
          message: 'Phone number already exists'
        });
      }
    }
    
    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };
    
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (password !== undefined) updateData.password = password;
    if (outletId !== undefined) updateData.outletId = outletId;
    if (userProfile !== undefined) updateData.userProfile = userProfile;
    if (tenantId !== undefined) updateData.tenantId = tenantId;
    if (enableNotification !== undefined) updateData.enableNotification = enableNotification;
    if (fcmToken !== undefined) updateData.fcmToken = fcmToken;
    
    await db.collection('users').doc(userId).update(updateData);
    
    res.status(200).json({
      success: true,
      message: 'Nannu user updated successfully'
    });
  } catch (err) {
    console.error('Update Nannu user error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update Nannu user'
    });
  }
};

// Delete Nannu User
export const deleteNannuUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getFirestoreDB();
    
    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Nannu user not found'
      });
    }
    
    const userData = userDoc.data();
    const phoneNumber = userData.phoneNumber;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'User phone number not found'
      });
    }
    
    // Delete from users collection
    await db.collection('users').doc(userId).delete();
    
    // Delete from storekeepers collection by phoneNumber
    const storekeepersSnapshot = await db.collection('storekeepers')
      .where('phoneNumber', '==', phoneNumber)
      .get();
    
    const storekeeperDeletions = [];
    storekeepersSnapshot.docs.forEach(doc => {
      storekeeperDeletions.push(doc.ref.delete());
    });
    
    // Delete from outlet_storekeepers collection by phoneNumber
    const outletStorekeepersSnapshot = await db.collection('outlet_storekeepers')
      .where('phoneNumber', '==', phoneNumber)
      .get();
    
    const outletStorekeeperDeletions = [];
    outletStorekeepersSnapshot.docs.forEach(doc => {
      outletStorekeeperDeletions.push(doc.ref.delete());
    });
    
    // Delete from outlets collection by phoneNumber (primaryPhoneNumber or secondaryPhoneNumber)
    const outletsSnapshot = await db.collection('outlets')
      .where('primaryPhoneNumber', '==', phoneNumber)
      .get();
    
    const outletsSecondarySnapshot = await db.collection('outlets')
      .where('secondaryPhoneNumber', '==', phoneNumber)
      .get();
    
    const outletDeletions = [];
    outletsSnapshot.docs.forEach(doc => {
      outletDeletions.push(doc.ref.delete());
    });
    outletsSecondarySnapshot.docs.forEach(doc => {
      outletDeletions.push(doc.ref.delete());
    });
    
    // Execute all deletions in parallel
    await Promise.all([
      ...storekeeperDeletions,
      ...outletStorekeeperDeletions,
      ...outletDeletions
    ]);
    
    const deletedCounts = {
      users: 1,
      storekeepers: storekeepersSnapshot.size,
      outletStorekeepers: outletStorekeepersSnapshot.size,
      outlets: outletsSnapshot.size + outletsSecondarySnapshot.size
    };
    
    res.status(200).json({
      success: true,
      message: 'Nannu user and related records deleted successfully',
      deletedCounts: deletedCounts
    });
  } catch (err) {
    console.error('Delete Nannu user error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete Nannu user',
      details: err.message
    });
  }
};

// Get Nannu Users by Outlet ID
export const getNannuUsersByOutletId = async (req, res) => {
  try {
    const { outletId } = req.params;
    const db = getFirestoreDB();
    
    const snapshot = await db.collection('users')
      .where('outletId', '==', outletId)
      .get();
    
    const users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId || doc.id,
        phoneNumber: data.phoneNumber || '',
        password: data.password || '',
        outletId: data.outletId || null,
        userProfile: data.userProfile || '',
        tenantId: data.tenantId ?? '',
        enableNotification: data.enableNotification !== undefined ? data.enableNotification : true,
        fcmToken: data.fcmToken || '',
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
      };
    });
    
    res.status(200).json({
      success: true,
      data: users,
      count: users.length
    });
  } catch (err) {
    console.error('Get Nannu users by outlet ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get Nannu users by outlet ID'
    });
  }
};

// Update FCM Token for Nannu User
export const updateNannuUserFCMToken = async (req, res) => {
  try {
    const { userId } = req.params;
    const { fcmToken } = req.body;
    const db = getFirestoreDB();
    
    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'fcmToken is required'
      });
    }
    
    // Check if user exists
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Nannu user not found'
      });
    }
    
    await db.collection('users').doc(userId).update({
      fcmToken: fcmToken,
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'FCM token updated successfully for Nannu user'
    });
  } catch (err) {
    console.error('Update FCM token for Nannu user error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update FCM token for Nannu user'
    });
  }
}; 