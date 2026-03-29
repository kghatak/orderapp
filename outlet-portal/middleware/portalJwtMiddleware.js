import jwt from 'jsonwebtoken';

const secret = () =>
  process.env.OUTLET_PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'outlet-portal-jwt-change-me';

/**
 * Validates Bearer token from outlet-portal login (same secret as portalAuthController).
 */
export const portalJwtMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, secret());

    if (decoded.sub !== 'outlet-portal') {
      return res.status(401).json({ success: false, message: 'Invalid token for outlet portal.' });
    }

    const tenantId = decoded.tenantId != null ? String(decoded.tenantId).trim() : '';
    const outletId = decoded.outletId != null ? String(decoded.outletId).trim() : '';

    if (!tenantId || !outletId) {
      return res.status(403).json({
        success: false,
        message: 'Token has no outlet scope. Use /outlet-portal/auth/login and ensure the user has tenantId and outletId.'
      });
    }

    req.portalAuth = {
      userId: decoded.userId != null ? String(decoded.userId) : '',
      tenantId,
      outletId,
      phoneNumber: decoded.phoneNumber != null ? String(decoded.phoneNumber) : ''
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    return res.status(500).json({ success: false, message: 'Authentication failed.' });
  }
};
