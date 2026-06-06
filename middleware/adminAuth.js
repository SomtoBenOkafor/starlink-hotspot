const jwt = require('jsonwebtoken');

/**
 * Middleware: verify admin JWT.
 * Admin tokens carry { role: 'admin' } in their payload.
 * They are issued by POST /api/admin/login and are separate
 * from regular user tokens.
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin access required.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not an admin token.' });
    }
    req.admin = true;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
  }
}

module.exports = { requireAdmin };
