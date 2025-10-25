const jwt = require('jsonwebtoken');
const pool = require('../db');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

  try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // development-only helper: also log the decoded payload (unsafe) to aid debugging
    if (process.env.NODE_ENV !== 'production') {
      try {
        const unsafe = jwt.decode(token, { complete: true });
        console.debug('[auth] token decoded (unsafe):', unsafe && unsafe.payload ? unsafe.payload : unsafe);
      } catch (e) {
        // ignore decode errors
      }
    }
  // attach decoded payload and full token payload (useful for refresh/jti access)
  req.tokenPayload = decoded; // full decoded JWT payload (may contain jti/exp etc)
  req.user = (decoded && decoded.user) ? decoded.user : decoded;
    // if token has jti, check invalidated_tokens table
    (async () => {
      try {
        if (!decoded.jti) return next();
        const r = await pool.query('SELECT 1 FROM invalidated_tokens WHERE jti = $1 LIMIT 1', [decoded.jti]);
        if (r && r.rows && r.rows.length > 0) {
          return res.status(401).json({ msg: 'Token revoked' });
        }
      } catch (e) {
        // on DB error, fail closed and allow request (avoid lockout) but log the issue
        try { console.error('[auth] failed to check invalidated_tokens', e); } catch (_) {}
      }
      return next();
    })();
  } catch (err) {
    console.error('[auth] token verification failed:', err && err.message ? err.message : err);
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

const isAdmin = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ msg: 'Unauthorized' });
    const { id } = req.user;
    const { rows } = await pool.query('SELECT role FROM admins WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(403).json({ msg: 'User not found' });
    if (rows[0].role !== 'ADMIN') {
      try { console.warn('[isAdmin] deny', { path: req.originalUrl, method: req.method, userId: id, role: rows[0].role }); } catch (e) {}
      return res.status(403).json({ msg: 'Admin role required' });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Check if the current user is either global admin or a server-admin for the provided serverId
const isServerAdminOrGlobal = (serverIdFromReqParamName = 'serverId') => {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ msg: 'Unauthorized' });
      if (req.user.role === 'ADMIN') return next();
      const serverId = Number(req.params[serverIdFromReqParamName] || req.body.server_id || req.query.server_id);
      if (!serverId || Number.isNaN(serverId)) return res.status(403).json({ msg: 'Forbidden' });
      const { rows } = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [req.user.id, serverId]);
      if (rows && rows.length > 0) return next();
      return res.status(403).json({ msg: 'Forbidden' });
    } catch (err) {
      console.error('isServerAdminOrGlobal middleware error', err);
      return res.status(500).json({ msg: 'Server error' });
    }
  };
};

module.exports = { authenticateToken, isAdmin, isServerAdminOrGlobal };
