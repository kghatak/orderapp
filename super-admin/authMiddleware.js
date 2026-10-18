import jwt from 'jsonwebtoken';

function secret() {
  return process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;
}

export function signSuperAdminToken(user) {
  const key = secret();
  if (!key) {
    const error = new Error('SUPER_ADMIN_JWT_SECRET is not configured.');
    error.status = 500;
    throw error;
  }
  return jwt.sign(
    { sub: 'super-admin', userId: user.id, email: user.email },
    key,
    { expiresIn: '12h' },
  );
}

export function requireSuperAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }
    const key = secret();
    if (!key) {
      return res.status(500).json({ success: false, message: 'SUPER_ADMIN_JWT_SECRET is not configured.' });
    }
    const decoded = jwt.verify(header.slice(7), key);
    if (decoded.sub !== 'super-admin' || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    req.superAdmin = { userId: String(decoded.userId), email: decoded.email || '' };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
}
