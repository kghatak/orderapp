import jwt from 'jsonwebtoken';
import { getFirestoreDB } from '../../util/firebase.js';
import { getPortalOutletUserStateModel } from '../models/PortalOutletUserState.js';

const JWT_SECRET = process.env.OUTLET_PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'outlet-portal-jwt-change-me';
const JWT_EXPIRES = process.env.OUTLET_PORTAL_JWT_EXPIRES || process.env.JWT_EXPIRES || '7d';

/**
 * POST /outlet-portal/auth/login
 * Body: { phoneNumber, password, fcmToken? }
 * tenantId is read from Firestore users document and returned in the response / JWT.
 */
export const login = async (req, res) => {
  try {
    const { phoneNumber, password, fcmToken } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber and password are required'
      });
    }

    const db = getFirestoreDB();

    const userSnap = await db.collection('users')
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (userSnap.empty) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }

    const userDoc = userSnap.docs[0];
    const userData = userDoc.data();

    if (userData.password !== password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }

    const allowedProfiles = ['Outlet', 'OutletStorekeeper'];
    if (!allowedProfiles.includes(userData.userProfile)) {
      return res.status(403).json({
        success: false,
        message: 'Only outlet and outlet storekeeper users can use this login'
      });
    }

    const userTenantId = userData.tenantId;
    if (userTenantId === undefined || userTenantId === null || String(userTenantId).trim() === '') {
      return res.status(403).json({
        success: false,
        message: 'User tenantId is not set. Add tenantId on this user in Firestore to use outlet portal.'
      });
    }

    const tenantId = String(userTenantId).trim();

    const linkedOutletId = userData.outletId || '';
    if (!linkedOutletId) {
      return res.status(403).json({
        success: false,
        message: 'User is not linked to an outlet'
      });
    }

    const outletDoc = await db.collection('outlets').doc(linkedOutletId).get();
    if (!outletDoc.exists) {
      return res.status(401).json({
        success: false,
        message: 'Outlet not found for this user'
      });
    }

    const outletData = outletDoc.data();
    if (outletData.active === false) {
      return res.status(403).json({
        success: false,
        message: 'Outlet is inactive'
      });
    }

    if (fcmToken) {
      await db.collection('users').doc(userDoc.id).update({
        fcmToken,
        updatedAt: new Date()
      });
      userData.fcmToken = fcmToken;
    }

    const firestoreUserId = userData.userId || userDoc.id;
    const outletDocId = outletDoc.id;

    const PortalOutletUserState = getPortalOutletUserStateModel();
    await PortalOutletUserState.findOneAndUpdate(
      { tenantId, firestoreUserId },
      {
        $set: {
          outletId: outletDocId,
          lastLoginAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    const token = jwt.sign(
      {
        sub: 'outlet-portal',
        userId: firestoreUserId,
        tenantId,
        outletId: outletDocId,
        phoneNumber: userData.phoneNumber
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    const profileName = String(userData.name || '').trim();
    const outletName = String(outletData.name || outletData.outletName || '').trim();
    const responseName = userData.userProfile === 'OutletStorekeeper'
      ? (profileName || outletName)
      : outletName;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        expiresIn: JWT_EXPIRES,
        tenantId,
        userId: firestoreUserId,
        outletId: outletDocId,
        phoneNumber: userData.phoneNumber,
        name: responseName,
        outlet: {
          outletId: outletDocId,
          name: responseName,
          address: outletData.address || '',
          primaryPhoneNumber: outletData.primaryPhoneNumber || outletData.phoneNumber || ''
        }
      }
    });
  } catch (err) {
    console.error('Outlet portal login error:', err);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};
