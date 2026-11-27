import { getFirestoreDB } from '../../util/firebase.js';
import { belongsToTenant } from '../../util/tenantMiddleware.js';

/** Event orders are admin-only. The admin panel already sends X-User-Id for the signed-in user. */
export async function requireOrderAdmin(req, res, next) {
  try {
    const userId = String(req.headers['x-user-id'] || '').trim();
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(userId)) {
      return res.status(401).json({
        success: false,
        message: 'Sign in as an admin to manage event orders.',
      });
    }

    const db = getFirestoreDB();
    let doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) {
      const snap = await db.collection('users').where('userId', '==', userId).limit(1).get();
      doc = snap.empty ? null : snap.docs[0];
    }
    if (!doc || !doc.exists) {
      return res.status(403).json({
        success: false,
        message: 'Only an admin can manage event orders.',
      });
    }

    const data = doc.data() || {};
    if (data.userProfile !== 'Admin' || !belongsToTenant(data.tenantId, req.tenantId)) {
      return res.status(403).json({
        success: false,
        message: 'Only an admin can manage event orders.',
      });
    }

    req.adminUser = {
      userId: doc.id,
      name: data.name || data.phoneNumber || doc.id,
      phoneNumber: data.phoneNumber || '',
      userProfile: data.userProfile,
    };
    next();
  } catch (err) {
    console.error('Event order admin check failed:', err);
    return res.status(500).json({
      success: false,
      message: 'Could not verify admin access.',
    });
  }
}
