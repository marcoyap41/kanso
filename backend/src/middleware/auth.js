const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'kanso-mvp-secret-key-2026';

/**
 * Express middleware that validates a JWT Bearer token and attaches req.user.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub || decoded.id;
    req.user = {
      id: userId,
      email: decoded.email,
      username: decoded.username,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

module.exports = {
  authMiddleware,
  JWT_SECRET,
};
