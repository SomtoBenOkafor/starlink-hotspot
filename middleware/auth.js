const jwt           = require('jsonwebtoken');
const { userHelpers } = require('../db');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token =
    (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
    req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user    = userHelpers.findById.get(payload.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }
    req.user = { id: user.id, name: user.name, email: user.email };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth };
