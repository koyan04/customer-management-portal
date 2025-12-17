const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/authMiddleware');
const { randomBytes } = require('crypto');
const crypto = require('crypto');

// Optional telegram_bot module for login notifications
let tgBot = null;
try {
  tgBot = require('../telegram_bot');
} catch (e) {
  // telegram_bot module not found - notifications disabled
}

// --- REGISTER A NEW ADMIN/EDITOR ---
// This route should ideally be protected or used only once for initial setup.
router.post('/register', async (req, res) => {
  const { display_name, username, password, role } = req.body;

  try {
    // 1. Check if the username already exists
    const user = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (user.rows.length > 0) {
      return res.status(401).json("Username already exists");
    }

    // 2. Hash the password
    const saltRounds = 10;
    const salt = await bcrypt.genSalt(saltRounds);
    const password_hash = await bcrypt.hash(password, salt);

    // 3. Insert the new admin into the database
    const newAdmin = await pool.query(
      'INSERT INTO admins (display_name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
      [display_name, username, password_hash, role]
    );

    res.status(201).json(newAdmin.rows[0]);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// --- LOGIN AN ADMIN/EDITOR ---
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Check if the user exists
    const user = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      return res.status(401).json("Invalid credentials");
    }

    // 2. Compare the provided password with the stored hash
    const admin = user.rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json("Invalid credentials");
    }

    // 3. If credentials are correct, create a JWT token
    const payload = {
      user: {
        id: admin.id,
        role: admin.role
      }
    };

    // include a jti for server-side invalidation support
    const { randomBytes } = require('crypto');
    const jti = randomBytes(12).toString('hex');
    const tokenPayload = { ...payload, jti };
    jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '24h' }, async (err, token) => {
        if (err) throw err;
        
        // Create active session record (delete any old sessions first)
        try {
          await pool.query('DELETE FROM active_sessions WHERE admin_id = $1', [admin.id]);
          await pool.query(
            'INSERT INTO active_sessions (admin_id, token_jti, last_activity) VALUES ($1, $2, NOW())',
            [admin.id, jti]
          );
        } catch (sessionErr) {
          console.error('Failed to create active session:', sessionErr && sessionErr.message);
        }
        
        // Fire-and-forget: record login audit (ignore errors)
        try {
          const ip = (req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '').toString();
          const userAgent = (req.headers['user-agent'] || '').toString();
          
          // Get geolocation from IP
          let geoData = { city: null, country: null, location: null };
          try {
            const { getLocationFromIP } = require('../lib/ipGeolocation');
            geoData = await getLocationFromIP(ip);
            if (process.env.NODE_ENV !== 'production') console.log('[login-audit] geo data:', geoData);
          } catch (e) {
            if (process.env.NODE_ENV !== 'production') console.warn('[login-audit] geolocation failed:', e.message);
          }
          
          // Check columns present to build a compatible INSERT
          let cols = [];
          try {
            const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='login_audit'");
            cols = (r.rows || []).map(x => x.column_name);
          } catch (_) {}
          try { if (process.env.NODE_ENV !== 'production') console.log('[login-audit] table columns:', cols); } catch(_) {}
          if (cols.length > 0) {
            const hasRoleAt = cols.includes('role_at_login');
            const hasRoleCol = cols.includes('role');
            const hasLoc = cols.includes('location');
            const hasGeoCity = cols.includes('geo_city');
            const hasGeoCountry = cols.includes('geo_country');
            const hasIp = cols.includes('ip');
            const hasUA = cols.includes('user_agent');
            const fields = ['admin_id'];
            const values = ['$1'];
            const params = [admin.id];
            if (hasRoleAt) { fields.push('role_at_login'); values.push('$' + (params.push(admin.role))); }
            else if (hasRoleCol) { fields.push('role'); values.push('$' + (params.push(admin.role))); }
            if (hasIp) { fields.push('ip'); values.push('$' + (params.push(ip))); }
            if (hasUA) { fields.push('user_agent'); values.push('$' + (params.push(userAgent))); }
            if (hasLoc) { fields.push('location'); values.push(geoData.location ? ('$' + params.push(geoData.location)) : 'NULL'); }
            if (hasGeoCity) { fields.push('geo_city'); values.push(geoData.city ? ('$' + params.push(geoData.city)) : 'NULL'); }
            if (hasGeoCountry) { fields.push('geo_country'); values.push(geoData.country ? ('$' + params.push(geoData.country)) : 'NULL'); }
            const sql = `INSERT INTO login_audit (${fields.join(',')}) VALUES (${values.join(',')})`;
            try {
              await pool.query(sql, params);
              try { if (process.env.NODE_ENV !== 'production') console.log('[login-audit] recorded for admin_id=', admin.id, 'fields=', fields); } catch (_) {}
            } catch (e) {
              // If targeted insert fails (e.g., NOT NULL or missing cols mismatch), fall back to minimal insert
              try {
                await pool.query('INSERT INTO login_audit (admin_id) VALUES ($1)', [admin.id]);
                try { if (process.env.NODE_ENV !== 'production') console.log('[login-audit] recorded (fallback after error) for admin_id=', admin.id, 'err=', e && e.message); } catch(_) {}
              } catch (e2) {
                try { if (process.env.NODE_ENV !== 'production') console.warn('[login-audit] both main and fallback inserts failed:', (e2 && e2.message) || e2); } catch(_) {}
              }
            }
          } else {
            // minimal fallback insert: rely on defaults (created_at), record only admin_id
            try {
              await pool.query('INSERT INTO login_audit (admin_id) VALUES ($1)', [admin.id]);
              try { if (process.env.NODE_ENV !== 'production') console.log('[login-audit] recorded (fallback) for admin_id=', admin.id); } catch(_) {}
            } catch (e) {
              try { if (process.env.NODE_ENV !== 'production') console.warn('[login-audit] fallback insert failed:', e && e.message ? e.message : e); } catch(_) {}
            }
          }
        } catch (_) {}
        // generate a secure random refresh token value and store a hash in DB
        try {
          const refreshToken = randomBytes(64).toString('hex');
          const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
          // expiry: 30 days
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await pool.query('INSERT INTO refresh_tokens (token_hash, admin_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO NOTHING', [hash, admin.id, expiresAt]);
          // set httpOnly secure cookie (in development, Secure=false on localhost is acceptable)
          const cookieOpts = { httpOnly: true, sameSite: 'lax', expires: expiresAt };
          if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') cookieOpts.secure = true;
          res.cookie('refresh_token', refreshToken, cookieOpts);
        } catch (e) {
          console.error('Failed to persist refresh token', e && e.message ? e.message : e);
        }
        res.json({ token });
        // Fire-and-forget: send a Telegram login notification (if enabled in settings)
        if (tgBot && tgBot.notifyLoginEvent) {
          try {
            const ip = (req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '').toString();
            const userAgent = (req.headers['user-agent'] || '').toString();
            tgBot.notifyLoginEvent({ adminId: admin.id, role: admin.role, username: admin.username || admin.display_name || '', ip, userAgent });
          } catch (_) {}
        }
      }
    );

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


module.exports = router;

// Invalidate current token (server-side). Requires a valid token and will record its jti.
router.post('/invalidate', authenticateToken, async (req, res) => {
  try {
    const jti = req.tokenPayload && req.tokenPayload.jti;
    if (!jti) return res.status(400).json({ msg: 'Token does not contain jti' });
    const adminId = req.user && req.user.id ? req.user.id : null;
    await pool.query('INSERT INTO invalidated_tokens (jti, admin_id) VALUES ($1, $2) ON CONFLICT (jti) DO UPDATE SET invalidated_at = now()', [jti, adminId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to invalidate token', err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

// Refresh current token: issue a new JWT with fresh jti and expiry
// Refresh using rotating refresh token cookie. Accepts refresh token from httpOnly cookie and
// returns a new access token. Also rotates the refresh token (deletes old DB hash and inserts new).
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies && req.cookies.refresh_token;
    if (!refreshToken) return res.status(401).json({ msg: 'No refresh token' });
    const hash = crypto.createHash('sha256').update(String(refreshToken)).digest('hex');
    // look up refresh token in DB
    const found = await pool.query('SELECT admin_id, expires_at FROM refresh_tokens WHERE token_hash = $1 LIMIT 1', [hash]);
    if (!found || !found.rows || found.rows.length === 0) return res.status(401).json({ msg: 'Invalid refresh token' });
    const row = found.rows[0];
    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() < Date.now()) {
      // delete expired token
      try { await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]); } catch (_) {}
      return res.status(401).json({ msg: 'Refresh token expired' });
    }
    const adminId = row.admin_id;
    // load admin record to include role in access token
    const ures = await pool.query('SELECT id, role FROM admins WHERE id = $1', [adminId]);
    if (!ures || !ures.rows || ures.rows.length === 0) return res.status(401).json({ msg: 'User not found' });
    const admin = ures.rows[0];
    // rotate: remove old token and insert new one
    const newRefresh = randomBytes(64).toString('hex');
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
      await client.query('INSERT INTO refresh_tokens (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)', [newHash, adminId, newExpires]);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally { client.release(); }

    // issue new access token with jti
    const newJti = randomBytes(12).toString('hex');
    const payload = { user: { id: admin.id, role: admin.role }, jti: newJti };
    const newAccess = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
    
    // Replace old session with new one for refreshed token
    try {
      // Delete all old sessions for this admin, then insert the new one
      await pool.query('DELETE FROM active_sessions WHERE admin_id = $1', [adminId]);
      await pool.query(
        'INSERT INTO active_sessions (admin_id, token_jti, last_activity) VALUES ($1, $2, NOW())',
        [adminId, newJti]
      );
    } catch (sessionErr) {
      console.error('Failed to replace active session on refresh:', sessionErr && sessionErr.message);
    }
    
    // set rotated refresh cookie
    const cookieOpts = { httpOnly: true, sameSite: 'lax', expires: newExpires };
    if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') cookieOpts.secure = true;
    res.cookie('refresh_token', newRefresh, cookieOpts);
    return res.json({ token: newAccess });
  } catch (err) {
    console.error('Refresh error', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

// Logout: remove refresh token cookie and delete its hash from DB. Also optionally invalidate current access token jti.
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies && req.cookies.refresh_token;
    if (refreshToken) {
      const h = crypto.createHash('sha256').update(String(refreshToken)).digest('hex');
      try { await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [h]); } catch (e) { console.error('Failed to delete refresh token row', e); }
    }
    // Also invalidate access token jti if provided via Authorization header
    let jtiToCleanup = null;
    let adminIdToUpdate = null;
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const jti = decoded && decoded.jti;
          if (jti) {
            jtiToCleanup = jti;
            const adminId = decoded && decoded.user && decoded.user.id ? decoded.user.id : null;
            adminIdToUpdate = adminId;
            await pool.query('INSERT INTO invalidated_tokens (jti, admin_id) VALUES ($1, $2) ON CONFLICT (jti) DO UPDATE SET invalidated_at = now()', [jti, adminId]);
          }
        } catch (_) {}
      }
    } catch (e) { /* ignore */ }
    
    // Remove active session and update last_seen
    if (jtiToCleanup) {
      try {
        await pool.query('DELETE FROM active_sessions WHERE token_jti = $1', [jtiToCleanup]);
      } catch (e) {
        console.error('Failed to delete active session:', e && e.message);
      }
    }
    if (adminIdToUpdate) {
      try {
        await pool.query('UPDATE admins SET last_seen = NOW() WHERE id = $1', [adminIdToUpdate]);
      } catch (e) {
        console.error('Failed to update last_seen:', e && e.message);
      }
    }
    
    // clear cookie
    res.clearCookie('refresh_token');
    return res.json({ ok: true });
  } catch (err) {
    console.error('Logout error', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

// Heartbeat endpoint: update last_activity for current session
router.post('/heartbeat', authenticateToken, async (req, res) => {
  try {
    const jti = req.tokenPayload && req.tokenPayload.jti;
    if (!jti) {
      return res.status(400).json({ msg: 'Token does not contain jti' });
    }

    const adminId = req.user && req.user.id;
    
    // Clean up any duplicate/old sessions for this admin (keep only current jti)
    // Then update or insert the current session
    try {
      await pool.query('DELETE FROM active_sessions WHERE admin_id = $1 AND token_jti != $2', [adminId, jti]);
    } catch (e) {
      console.error('Failed to cleanup duplicate sessions:', e && e.message);
    }
    
    // Update session last_activity or create if not exists
    await pool.query(
      'INSERT INTO active_sessions (admin_id, token_jti, last_activity) VALUES ($1, $2, NOW()) ON CONFLICT (token_jti) DO UPDATE SET last_activity = NOW()',
      [adminId, jti]
    );
    
    return res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Heartbeat error:', err && err.message);
    return res.status(500).json({ msg: 'Server error' });
  }
});

// Get active sessions (with timeout check)
router.get('/sessions/active', authenticateToken, async (req, res) => {
  try {
    const timeoutMinutes = 60; // Match your session timeout setting
    
    // First, find all expired sessions and update last_seen before deleting them
    const expiredSessions = await pool.query(
      `SELECT admin_id, last_activity 
       FROM active_sessions 
       WHERE last_activity < NOW() - INTERVAL '1 minute' * $1`,
      [timeoutMinutes]
    );
    
    // Update last_seen for users with expired sessions
    if (expiredSessions.rows && expiredSessions.rows.length > 0) {
      for (const row of expiredSessions.rows) {
        try {
          await pool.query(
            'UPDATE admins SET last_seen = $1 WHERE id = $2',
            [row.last_activity, row.admin_id]
          );
        } catch (e) {
          console.error('Failed to update last_seen for admin', row.admin_id, e.message);
        }
      }
    }
    
    // Now clean up inactive sessions
    await pool.query(
      'DELETE FROM active_sessions WHERE last_activity < NOW() - INTERVAL \'1 minute\' * $1',
      [timeoutMinutes]
    );
    
    // Get currently active sessions
    const result = await pool.query(
      `SELECT 
        a.id,
        a.username,
        a.display_name,
        a.role,
        a.last_seen,
        s.last_activity,
        s.created_at as session_started
       FROM admins a
       LEFT JOIN active_sessions s ON a.id = s.admin_id
       ORDER BY a.id`
    );
    
    const sessions = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      isOnline: !!row.last_activity,
      lastActivity: row.last_activity,
      sessionStarted: row.session_started,
      lastSeen: row.last_seen
    }));
    
    return res.json({ sessions });
  } catch (err) {
    console.error('Sessions active error:', err && err.message);
    return res.status(500).json({ msg: 'Server error' });
  }
});


