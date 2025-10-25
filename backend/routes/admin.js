const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dns = require('dns').promises;
const net = require('net');
const { Pool: PgPool } = require('pg');
const sharp = require('sharp');

const uploadsPath = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true }); } catch(e) { console.warn('mkdir uploads failed', e && e.message ? e.message : e); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsPath),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

// --- PUBLIC: read-only access to selected app settings (e.g., general)
router.get('/public/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (key !== 'general') return res.status(404).json({ msg: 'Not found' });
    const { rows } = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
    const data = rows && rows[0] ? rows[0].data : {};
    return res.json({ key, data: maskSecrets(key, data) });
  } catch (err) {
    console.error('public settings read failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// --- ADMIN: Get all editors/admins (admin only)
router.get('/accounts', authenticateToken, isAdmin, async (req, res) => {
  try {
  const result = await pool.query('SELECT id, display_name, username, role, avatar_url, created_at FROM admins ORDER BY created_at DESC');
  const rows = Array.isArray(result.rows) ? result.rows : [];
  res.json(rows);
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- ADMIN: Get single account by id
// --- PUBLIC: Get an account's avatar (no auth required) - returns either absolute URL or avatar_data
router.get('/public/accounts/:id/avatar', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT avatar_url, avatar_data FROM admins WHERE id = $1', [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ msg: 'Account not found' });
    const rec = rows[0];
    // prefer avatar_url (served from /uploads) and return absolute URL for convenience
    if (rec.avatar_url) {
      const origin = req.protocol + '://' + req.get('host');
      const url = rec.avatar_url.startsWith('http') ? rec.avatar_url : (origin + rec.avatar_url);
      return res.json({ type: 'url', url });
    }
    if (rec.avatar_data) return res.json({ type: 'data', data: rec.avatar_data });
    return res.status(404).json({ msg: 'No avatar' });
  } catch (err) {
    console.error('public avatar error', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// --- Get current authenticated user's account (no isAdmin required)
router.get('/accounts/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user && req.user.id ? req.user.id : null;
    if (!userId) return res.status(401).json({ msg: 'Unauthorized' });
    const { rows } = await pool.query('SELECT id, display_name, username, role, avatar_url, avatar_data, created_at FROM admins WHERE id = $1', [userId]);
    if (!rows || rows.length === 0) return res.status(404).json({ msg: 'Account not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- Simple ping endpoint to validate token server-side
router.get('/ping', authenticateToken, async (req, res) => {
  return res.json({ ok: true, id: req.user && req.user.id ? req.user.id : null });
});

// --- ADMIN: Get single account by id
router.get('/accounts/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT id, display_name, username, role, avatar_url, created_at FROM admins WHERE id = $1', [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ msg: 'Account not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- ADMIN: Create editor/admin
// accept multipart/form-data with optional 'avatar' file
router.post('/accounts', authenticateToken, isAdmin, upload.single('avatar'), async (req, res) => {
  try {
  let display_name, username, password, role = 'VIEWER', avatar_url = null;
    if (req.file) {
      avatar_url = `/uploads/${req.file.filename}`;
    }
    if (req.is('multipart/form-data')) {
      display_name = req.body.display_name;
      username = req.body.username;
      password = req.body.password;
  role = req.body.role || 'VIEWER';
  // accept legacy 'EDITOR' tag from older clients/scripts
  if (role === 'EDITOR') role = 'VIEWER';
      // allow clearing avatar on create if client requested it (edge-case)
      if (req.body.clear_avatar === '1' || req.body.clear_avatar === 'true') {
        avatar_url = null;
      }
    } else {
  ({ display_name, username, password, role = 'VIEWER', clear_avatar = false } = req.body || {});
  if (role === 'EDITOR') role = 'VIEWER';
      if (clear_avatar) avatar_url = null;
    }

    // basic validation
    if (!display_name || !username || !password) {
      return res.status(400).json({ msg: 'display_name, username and password are required' });
    }

    // check for existing username
    const exists = await pool.query('SELECT id FROM admins WHERE username = $1', [username]);
    if (exists.rows && exists.rows.length > 0) {
      return res.status(409).json({ msg: 'Username already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const { rows } = await pool.query('INSERT INTO admins (display_name, username, password_hash, role, avatar_url) VALUES ($1,$2,$3,$4,$5) RETURNING id, display_name, username, role, avatar_url', [display_name, username, password_hash, role, avatar_url]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating admin account:', err && err.message ? err.message : err);
    // detect unique constraint errors from Postgres
    if (err && err.code === '23505') {
      return res.status(409).json({ msg: 'Username already exists' });
    }
    res.status(500).json({ msg: 'Server Error' });
  }
});

// --- ADMIN: Update account
router.put('/accounts/:id', authenticateToken, isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    console.log('[PUT /accounts/:id] req.file =', !!req.file, ' req.body keys =', Object.keys(req.body));
    const { id } = req.params;
  let display_name = null, role = null, avatar_url = null, username = null;
  let clearRequested = false;
    if (req.file) {
      avatar_url = `/uploads/${req.file.filename}`;
    }
    // allow client to send a clear_avatar flag to remove existing avatar
    if (req.is('multipart/form-data')) {
      display_name = req.body.display_name;
      role = req.body.role;
      username = typeof req.body.username === 'string' ? req.body.username : null;
      if (role === 'EDITOR') role = 'VIEWER';
      if ((req.body.clear_avatar === '1' || req.body.clear_avatar === 'true') && !req.file) {
        // explicit clear and no new file -> mark for clearing avatar_url in DB
        avatar_url = null;
        clearRequested = true;
      }
    } else {
      ({ display_name, role, clear_avatar = false, username = null } = req.body || {});
      if (role === 'EDITOR') role = 'VIEWER';
      if (clear_avatar && !req.file) {
        avatar_url = null;
        clearRequested = true;
      }
    }

    // If username provided, ensure it's unique (excluding current id)
    if (username !== null && typeof username === 'string' && username.trim().length > 0) {
      try {
        const exists = await pool.query('SELECT id FROM admins WHERE username = $1 AND id <> $2', [username, id]);
        if (exists.rows && exists.rows.length > 0) {
          return res.status(409).json({ msg: 'Username already exists' });
        }
      } catch (checkErr) {
        console.warn('Username uniqueness check failed:', checkErr && checkErr.message ? checkErr.message : checkErr);
      }
    } else if (username !== null && typeof username === 'string' && username.trim().length === 0) {
      return res.status(400).json({ msg: 'username cannot be empty' });
    }
    const updates = [];
    const params = [];
    let idx = 1;
    if (display_name !== null) { updates.push(`display_name = $${idx++}`); params.push(display_name); }
    if (role !== null) { updates.push(`role = $${idx++}`); params.push(role); }
    if (username !== null) { updates.push(`username = $${idx++}`); params.push(username); }
    if (avatar_url !== null) {
      updates.push(`avatar_url = $${idx++}`); params.push(avatar_url);
    } else if (clearRequested) {
      // client explicitly requested clearing the avatar; set DB column to NULL
      updates.push(`avatar_url = NULL`);
    }
    if (updates.length === 0) {
      const { rows } = await pool.query('SELECT id, display_name, username, role, avatar_url FROM admins WHERE id = $1', [id]);
      return res.json(rows[0]);
    }
    params.push(id);
    const q = `UPDATE admins SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, display_name, username, role, avatar_url`;
  console.log('[PUT /accounts/:id] SQL:', q);
  console.log('[PUT /accounts/:id] params:', params);
    try {
      const { rows } = await pool.query(q, params);
      res.json(rows[0]);
    } catch (dbErr) {
      // handle unique constraint violation on username
      if (dbErr && dbErr.code === '23505') {
        return res.status(409).json({ msg: 'Username already exists' });
      }
      throw dbErr;
    }
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- ADMIN: Delete account
router.delete('/accounts/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM admins WHERE id = $1', [id]);
    res.json({ msg: 'Account deleted' });
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- ADMIN: Assign server permissions to editor
router.post('/permissions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { editor_id, server_ids } = req.body || {}; // server_ids = [1,2]

    // Basic validation with helpful error responses
    if (!editor_id || Number.isNaN(Number(editor_id))) {
      return res.status(400).json({ msg: 'editor_id is required and must be a number' });
    }
    if (!Array.isArray(server_ids)) {
      return res.status(400).json({ msg: 'server_ids is required and must be an array' });
    }

    // normalize server ids
    const sids = server_ids.map(x => Number(x)).filter(x => !Number.isNaN(x));

    // perform delete + inserts in a transaction to avoid partial updates
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      console.log('[PERMS] updating permissions for editor_id=', editor_id, ' sids=', sids);

      // First try the new table name
      let usedTable = 'viewer_server_permissions';
      try {
        console.log('[PERMS] running DELETE FROM', usedTable, ' WHERE editor_id = $1', editor_id);
        await client.query(`DELETE FROM ${usedTable} WHERE editor_id = $1`, [editor_id]);
        if (sids.length > 0) {
          const insertText = `INSERT INTO ${usedTable} (editor_id, server_id) VALUES ` + sids.map((_, i) => `($1,$${i + 2})`).join(',') + ' ON CONFLICT DO NOTHING';
          const params = [editor_id, ...sids];
          console.log('[PERMS] running insert (new table):', insertText, ' params:', params);
          await client.query(insertText, params);
        }
      } catch (firstErr) {
        // If the new table doesn't exist, fallback to the old table name to remain tolerant in mixed state
        if (firstErr && firstErr.code === '42P01') {
          const fallbackTable = 'editor_server_permissions';
          console.warn('[PERMS] new table not found, falling back to', fallbackTable, ' Error:', firstErr && firstErr.message ? firstErr.message : firstErr);
          // attempt using old table name
          console.log('[PERMS] running DELETE FROM', fallbackTable, ' WHERE editor_id = $1', editor_id);
          await client.query(`DELETE FROM ${fallbackTable} WHERE editor_id = $1`, [editor_id]);
          if (sids.length > 0) {
            const insertText = `INSERT INTO ${fallbackTable} (editor_id, server_id) VALUES ` + sids.map((_, i) => `($1,$${i + 2})`).join(',') + ' ON CONFLICT DO NOTHING';
            const params = [editor_id, ...sids];
            console.log('[PERMS] running insert (fallback table):', insertText, ' params:', params);
            await client.query(insertText, params);
            usedTable = fallbackTable;
          }
        } else {
          throw firstErr; // rethrow unknown errors
        }
      }

      // If the target account is a SERVER_ADMIN, also update server_admin_permissions to match selected servers
      try {
        const roleRes = await client.query('SELECT role FROM admins WHERE id = $1', [editor_id]);
        const targetRole = roleRes.rows && roleRes.rows[0] ? roleRes.rows[0].role : null;
        if (targetRole === 'SERVER_ADMIN') {
          console.log('[PERMS] target is SERVER_ADMIN; updating server_admin_permissions for admin_id=', editor_id);
          await client.query('DELETE FROM server_admin_permissions WHERE admin_id = $1', [editor_id]);
          if (sids.length > 0) {
            const insertText2 = 'INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ' + sids.map((_, i) => `($1,$${i+2})`).join(',') + ' ON CONFLICT DO NOTHING';
            const params2 = [editor_id, ...sids];
            await client.query(insertText2, params2);
          }
        }
      } catch (innerErr) {
        console.error('Failed to update server_admin_permissions:', innerErr && innerErr.message ? innerErr.message : innerErr);
        // don't fail the whole operation if server_admin permissions update fails; continue
      }

      await client.query('COMMIT');
      res.json({ msg: 'Permissions updated', table: usedTable });
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('Failed to update permissions transactionally:', txErr && txErr.stack ? txErr.stack : (txErr && txErr.message ? txErr.message : txErr));
      return res.status(500).json({ msg: 'Failed to update permissions', error: txErr && txErr.message ? txErr.message : null });
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- Get editor's server permissions
// Admins can query anyone. Non-admins can only query their own id.
router.get('/permissions/:editorId', authenticateToken, async (req, res) => {
  try {
    const { editorId } = req.params;
    const uidRaw = req.user && req.user.id;
    const uid = typeof uidRaw === 'string' ? Number(uidRaw) : (typeof uidRaw === 'number' ? uidRaw : NaN);
    const eid = Number(editorId);
    const isAdminRole = req.user && req.user.role === 'ADMIN';
    const isSelf = Number.isFinite(uid) && Number.isFinite(eid) && uid === eid;
    console.log('[GET /api/admin/permissions/:editorId] uid=', uidRaw, ' parsedUid=', uid, ' eid=', eid, ' role=', req.user && req.user.role, ' isAdminRole=', isAdminRole, ' isSelf=', isSelf);
    if (!isAdminRole && !isSelf) {
      return res.status(403).json({ msg: 'Forbidden' });
    }

    // Try the new table name first, fallback to old table if it doesn't exist (42P01)
    let rows = [];
    try {
      const result = await pool.query('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [eid]);
      rows = result.rows || [];
    } catch (err) {
      if (err && err.code === '42P01') {
        // Table not found; use legacy name
        const legacy = await pool.query('SELECT server_id FROM editor_server_permissions WHERE editor_id = $1', [eid]);
        rows = legacy.rows || [];
      } else {
        throw err;
      }
    }
    res.json(rows.map(r => r.server_id));
  } catch (err) {
    console.error('GET /permissions/:editorId failed:', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// --- Get current authenticated user's viewer permissions (convenience endpoint)
router.get('/permissions/me', authenticateToken, async (req, res) => {
  try {
    const uidRaw = req.user && req.user.id;
    const uid = typeof uidRaw === 'string' ? Number(uidRaw) : (typeof uidRaw === 'number' ? uidRaw : NaN);
    if (!Number.isFinite(uid)) return res.status(401).json({ msg: 'Unauthorized' });
    let rows = [];
    try {
      const result = await pool.query('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [uid]);
      rows = result.rows || [];
    } catch (err) {
      if (err && err.code === '42P01') {
        const legacy = await pool.query('SELECT server_id FROM editor_server_permissions WHERE editor_id = $1', [uid]);
        rows = legacy.rows || [];
      } else {
        throw err;
      }
    }
    res.json(rows.map(r => r.server_id));
  } catch (err) {
    console.error('GET /permissions/me failed:', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// --- Get current user's server-admin assignments (any authenticated user)
router.get('/my-server-admins', authenticateToken, async (req, res) => {
  try {
    const uid = req.user && req.user.id ? req.user.id : null;
    if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
    // If global admin, return role and empty list (frontend can assume full privileges)
    if (req.user.role === 'ADMIN') return res.json({ role: 'ADMIN', server_admin_for: [] });
    // otherwise return list of server ids this user is server-admin for
    const { rows } = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [uid]);
    return res.json({ role: req.user.role, server_admin_for: rows.map(r => r.server_id) });
  } catch (err) { console.error(err); res.status(500).json({ msg: 'Server Error' }); }
});

// --- ADMIN: set server-admin permissions for an admin account (admin only)
router.post('/server-admins', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { admin_id, server_ids } = req.body || {};
    if (!admin_id || !Array.isArray(server_ids)) return res.status(400).json({ msg: 'admin_id and server_ids required' });
    const sids = server_ids.map(x => Number(x)).filter(x => !Number.isNaN(x));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM server_admin_permissions WHERE admin_id = $1', [admin_id]);
      if (sids.length > 0) {
        const insertText = 'INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ' + sids.map((_, i) => `($1,$${i+2})`).join(',') + ' ON CONFLICT DO NOTHING';
        const params = [admin_id, ...sids];
        await client.query(insertText, params);
      }
      await client.query('COMMIT');
      res.json({ msg: 'Server-admin permissions updated' });
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('Failed to update server-admin permissions:', txErr);
      res.status(500).json({ msg: 'Failed to update' });
    } finally { client.release(); }
  } catch (err) { console.error(err); res.status(500).json({ msg: 'Server Error' }); }
});

// --- ADMIN: get server-admin assignments for a specific admin id (admin only)
router.get('/server-admins/:adminId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { adminId } = req.params;
    const { rows } = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [adminId]);
    res.json(rows.map(r => r.server_id));
  } catch (err) { console.error(err); res.status(500).json({ msg: 'Server Error' }); }
});

// --- ADMIN: get recent login audit entries for an account (admin only)
router.get('/accounts/:id/login-audit', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Check table/columns existence to be tolerant of partially applied migrations
    const info = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'login_audit'`
    );
    const cols = new Set((info.rows || []).map(r => r.column_name));
    if (cols.size === 0) return res.json([]); // table not found yet
  const hasRoleAt = cols.has('role_at_login');
  const hasRoleCol = cols.has('role');
  const hasLoc = cols.has('location');
  const hasGeo = cols.has('geo_city') || cols.has('geo_country');
  // Build a compatible SELECT; prefer table role_at_login, then table.role, else admins.role
  let selectRole = 'COALESCE(a.role, NULL) AS role_at_login';
  let join = 'LEFT JOIN admins a ON a.id = la.admin_id';
  if (hasRoleAt) { selectRole = 'la.role_at_login'; join = ''; }
  else if (hasRoleCol) { selectRole = 'la.role AS role_at_login'; join = ''; }
  // For location: prefer location column; else synthesize from geo columns; else NULL
  let selectLoc = 'NULL AS location';
  if (hasLoc) selectLoc = 'la.location';
  else if (hasGeo) selectLoc = "NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ', la.geo_city, la.geo_country)), '') AS location";
    const sql = `SELECT la.id, la.created_at, ${selectRole}, la.ip, la.user_agent, ${selectLoc}
                 FROM login_audit la ${join}
                 WHERE la.admin_id = $1
                 ORDER BY la.created_at DESC
                 LIMIT 20`;
  const { rows } = await pool.query(sql, [id]);
  try { if (process.env.NODE_ENV !== 'production') console.log('[login-audit] returning', (rows || []).length, 'rows for account', id); } catch (_) {}
  res.json(rows || []);
  } catch (err) {
    console.error('get login audit failed:', err && err.message ? err.message : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// --- Password change for logged-in user
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;
    const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(404).json({ msg: 'User not found' });
    const isMatch = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!isMatch) return res.status(401).json({ msg: 'Old password incorrect' });
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [newHash, userId]);
    res.json({ msg: 'Password updated' });
  } catch (err) { console.error(err); res.status(500).send('Server Error'); }
});

// --- Admin: reset another account's password (admin only)
router.post('/accounts/:id/reset-password', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ msg: 'newPassword is required and must be at least 6 characters' });
    }
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);
    const { rowCount } = await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [newHash, id]);
    if (rowCount === 0) return res.status(404).json({ msg: 'Account not found' });

    // record audit entry: who reset which account
    try {
      const adminId = req.user && req.user.id ? req.user.id : null;
      const note = req.body.note || null;
      await pool.query('INSERT INTO password_reset_audit (admin_id, target_account_id, note) VALUES ($1,$2,$3)', [adminId, id, note]);
    } catch (auditErr) {
      console.error('Failed to write password reset audit:', auditErr && auditErr.message ? auditErr.message : auditErr);
      // don't fail the main operation if audit logging fails
    }

    res.json({ msg: 'Password reset' });
  } catch (err) { console.error('Error resetting password:', err); res.status(500).json({ msg: 'Server Error' }); }
});

// =============================
// Admin Settings Endpoints
// =============================

// Helper: mask secrets from objects before returning/auditing
function maskSecrets(key, data) {
  if (!data || typeof data !== 'object') return data;
  const clone = JSON.parse(JSON.stringify(data));
  const star = (v) => (v ? '********' : v);
  if (key === 'database') {
    if (clone.password) clone.password = star(clone.password);
  } else if (key === 'telegram') {
    if (clone.botToken) clone.botToken = star(clone.botToken);
  } else if (key === 'remoteServer') {
    if (clone.password) clone.password = star(clone.password);
    if (clone.privateKey) clone.privateKey = star(clone.privateKey);
    if (clone.passphrase) clone.passphrase = star(clone.passphrase);
  } else if (key === 'general') {
    // no secrets expected in general settings
  }
  return clone;
}

const { validateSettings } = require('../lib/validateSettings');

// Financial reports: monthly/yearly summaries using historical prices from settings_audit
router.get('/financial', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Single SQL to aggregate counts per month and per service_type for the last 12 months,
    // plus fetch the most-recent `settings_audit.after_data` per month (LATERAL) so we can derive prices.
    const q = `
      WITH months AS (
        SELECT generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') AS month_start
      ),
      user_counts AS (
        SELECT m.month_start,
               COALESCE(u.service_type, '') AS service_type,
               COUNT(u.*)::int AS cnt
        FROM months m
        LEFT JOIN users u
          ON u.created_at <= (m.month_start + interval '1 month' - interval '1 ms')
          AND (u.expire_date IS NULL OR u.expire_date >= m.month_start)
        GROUP BY m.month_start, u.service_type
      )
      SELECT m.month_start, uc.service_type, uc.cnt,
             sa.after_data AS audit_after,
             app.data AS current_app
      FROM months m
      LEFT JOIN LATERAL (
        SELECT after_data FROM settings_audit WHERE settings_key = 'general' AND created_at <= (m.month_start + interval '1 month' - interval '1 ms') ORDER BY created_at DESC LIMIT 1
      ) sa ON true
      LEFT JOIN (SELECT data FROM app_settings WHERE settings_key = 'general') app ON true
      LEFT JOIN user_counts uc ON uc.month_start = m.month_start
      ORDER BY m.month_start ASC, uc.service_type NULLS FIRST
    `;

    const { rows } = await pool.query(q);

    // organize rows by month
    const monthsMap = new Map();
    const normalizeService = (svc) => {
      const v = (svc || '').toString().toLowerCase();
      if (v === 'x-ray' || v === 'xray' || v === 'outline') return 'Mini';
      if (v === 'mini') return 'Mini';
      if (v === 'basic') return 'Basic';
      if (v === 'unlimited') return 'Unlimited';
      return svc || '';
    };

    for (const r of rows) {
      const monthStart = r.month_start ? new Date(r.month_start) : null;
      const label = monthStart ? `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}` : null;
      if (!monthsMap.has(label)) {
        monthsMap.set(label, { month: label, start: monthStart ? monthStart.toISOString() : null, end: monthStart ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23,59,59,999).toISOString() : null, counts: { Mini:0, Basic:0, Unlimited:0 }, prices: { price_mini_cents:0, price_basic_cents:0, price_unlimited_cents:0 }, revenue_cents: 0, rawAudit: r.audit_after, currentApp: r.current_app });
      }
      const entry = monthsMap.get(label);
      const svcNorm = normalizeService(r.service_type);
      const cnt = Number(r.cnt || 0);
      if (svcNorm === 'Mini' || svcNorm === 'Basic' || svcNorm === 'Unlimited') {
        entry.counts[svcNorm] += cnt;
      }
      // Store audit & app once (may be repeated across rows)
      if (r.audit_after && !entry.rawAudit) entry.rawAudit = r.audit_after;
      if (r.current_app && !entry.currentApp) entry.currentApp = r.current_app;
    }

    // finalize prices and revenue per month
    for (const [k, v] of monthsMap.entries()) {
      const d = v.rawAudit || v.currentApp || {};
      const safeNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
      // try audit after_data's *_cents first
      v.prices.price_mini_cents = safeNum((d && d.price_mini_cents) || (d && d.price_backup_decimal && d.price_backup_decimal.price_mini ? Math.round(Number(d.price_backup_decimal.price_mini) * 100) : 0));
      v.prices.price_basic_cents = safeNum((d && d.price_basic_cents) || (d && d.price_backup_decimal && d.price_backup_decimal.price_basic ? Math.round(Number(d.price_backup_decimal.price_basic) * 100) : 0));
      v.prices.price_unlimited_cents = safeNum((d && d.price_unlimited_cents) || (d && d.price_backup_decimal && d.price_backup_decimal.price_unlimited ? Math.round(Number(d.price_backup_decimal.price_unlimited) * 100) : 0));
      v.revenue_cents = (v.counts.Mini * v.prices.price_mini_cents) + (v.counts.Basic * v.prices.price_basic_cents) + (v.counts.Unlimited * v.prices.price_unlimited_cents);
    }

    const results = Array.from(monthsMap.values());
    // compute year totals for current year
    const now = new Date();
    const thisYear = now.getFullYear();
    const yearMonths = results.filter(r => Number(r.month.slice(0,4)) === thisYear);
    const yearTotals = { counts: { Mini: 0, Basic: 0, Unlimited: 0 }, revenue_cents: 0 };
    for (const m of yearMonths) {
      yearTotals.counts.Mini += m.counts.Mini;
      yearTotals.counts.Basic += m.counts.Basic;
      yearTotals.counts.Unlimited += m.counts.Unlimited;
      yearTotals.revenue_cents += m.revenue_cents;
    }

    return res.json({ months: results, year: thisYear, yearTotals });
  } catch (err) {
    console.error('GET /financial failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// GET current settings for a category
router.get('/settings/:key', authenticateToken, isAdmin, async (req, res) => {
  try {
    const key = req.params.key;
    const { rows } = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
    const data = rows && rows[0] ? rows[0].data : {};
    return res.json({ key, data: maskSecrets(key, data) });
  } catch (err) {
    console.error('GET settings failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// PUT update settings for a category with validation + audit
router.put('/settings/:key', authenticateToken, isAdmin, async (req, res) => {
  try {
    const key = req.params.key;
    const body = req.body || {};
    const { ok, errors, cleaned } = validateSettings(key, body);
    if (!ok) return res.status(400).json({ msg: 'Validation failed', errors });

    // read current (before) value
    const beforeRes = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
    const before = beforeRes.rows && beforeRes.rows[0] ? beforeRes.rows[0].data : null;

    // For 'general', preserve non-validated fields like logo_url and logo_url_2x by merging
    // This prevents accidental removal of logo when saving title/theme/etc.
    const toStore = key === 'general' ? { ...(before || {}), ...cleaned } : cleaned;

    const upRes = await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING data`,
      [key, toStore, req.user && req.user.id ? req.user.id : null]
    );
    const after = upRes.rows && upRes.rows[0] ? upRes.rows[0].data : toStore;

    // audit (store masked to avoid leaking secrets in audit trail)
    try {
      await pool.query(
        'INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)',
        [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', maskSecrets(key, before), maskSecrets(key, after)]
      );
    } catch (auditErr) {
      console.warn('Failed to write settings audit:', auditErr && auditErr.message ? auditErr.message : auditErr);
    }

    return res.json({ key, data: maskSecrets(key, after) });
  } catch (err) {
    console.error('PUT settings failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// ADMIN: Upload and set General logo (stores URL under app_settings.general.logo_url)
router.post('/settings/general/logo', authenticateToken, isAdmin, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });
    // basic type guard: allow only common image types
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (req.file.mimetype && !allowed.includes(req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ msg: 'Unsupported file type' });
    }

    // Read existing general to capture previous logo for cleanup
    const { rows } = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', ['general']);
    const current = rows && rows[0] ? (rows[0].data || {}) : {};

    // Server-side resize to 70x70 (1x) and 140x140 (2x) PNG for crisp display on high-DPI screens
    const inputPath = req.file.path;
  const ext = '.png';
  const baseName = path.basename(req.file.filename, path.extname(req.file.filename));
  const outName1x = `${baseName}-70x70${ext}`;
  const outName2x = `${baseName}-140x140${ext}`;
    const outPath1x = path.join(uploadsPath, outName1x);
    const outPath2x = path.join(uploadsPath, outName2x);
    try {
      // Generate 2x first from original for maximum fidelity
      await sharp(inputPath)
        .resize(140, 140, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toFile(outPath2x);
      // Generate 1x from original to avoid double resampling
      await sharp(inputPath)
        .resize(70, 70, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toFile(outPath1x);
      // remove original upload to save space
      try { fs.unlinkSync(inputPath); } catch (_) {}
    } catch (e) {
      // on failure, keep original as fallback
      console.error('sharp resize failed:', e && e.message ? e.message : e);
      // use original file as 1x fallback
      try { fs.renameSync(inputPath, outPath1x); } catch (_) {}
    }
    const logoUrl = `/uploads/${outName1x}`;
    const logoUrl2x = fs.existsSync(outPath2x) ? `/uploads/${outName2x}` : undefined;
    const next = { ...current };
    next.logo_url = logoUrl;
    if (logoUrl2x) next.logo_url_2x = logoUrl2x; else delete next.logo_url_2x;
    await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      ['general', next, req.user && req.user.id ? req.user.id : null]
    );
    // audit write (masked)
    try {
      await pool.query(
        'INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)',
        [req.user && req.user.id ? req.user.id : null, 'general', 'UPDATE_LOGO', maskSecrets('general', current), maskSecrets('general', next)]
      );
    } catch (_) {}

    // Cleanup old logo file if different
    try {
      const oldUrl = current && current.logo_url;
      if (oldUrl && typeof oldUrl === 'string' && oldUrl.startsWith('/uploads/')) {
        const oldPath = path.join(uploadsPath, path.basename(oldUrl));
        if (fs.existsSync(oldPath) && path.dirname(oldPath) === uploadsPath) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
      }
    } catch (_) {}

  const origin = req.protocol + '://' + req.get('host');
  const absolute = logoUrl.startsWith('http') ? logoUrl : (origin + logoUrl);
  const absolute2x = logoUrl2x ? (logoUrl2x.startsWith('http') ? logoUrl2x : (origin + logoUrl2x)) : undefined;
  return res.json({ ok: true, logo_url: logoUrl, logo_url_2x: logoUrl2x, url: absolute, url2x: absolute2x });
  } catch (err) {
    console.error('Upload general logo failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// ADMIN: Clear General logo (delete file and remove from app_settings)
router.delete('/settings/general/logo', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', ['general']);
    const current = rows && rows[0] ? (rows[0].data || {}) : {};
  const oldUrl = current && current.logo_url;
  const oldUrl2x = current && current.logo_url_2x;
    const next = { ...current };
    delete next.logo_url;
    delete next.logo_url_2x;
    await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      ['general', next, req.user && req.user.id ? req.user.id : null]
    );
    // attempt to delete file if under uploads
    try {
      const deleteIfLocal = (u) => {
        if (u && typeof u === 'string' && u.startsWith('/uploads/')) {
          const p = path.join(uploadsPath, path.basename(u));
          if (fs.existsSync(p) && path.dirname(p) === uploadsPath) {
            try { fs.unlinkSync(p); } catch (_) {}
          }
        }
      };
      deleteIfLocal(oldUrl);
      deleteIfLocal(oldUrl2x);
    } catch (_) {}
    try {
      await pool.query(
        'INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)',
        [req.user && req.user.id ? req.user.id : null, 'general', 'CLEAR_LOGO', maskSecrets('general', current), maskSecrets('general', next)]
      );
    } catch (_) {}
    return res.json({ ok: true });
  } catch (err) {
    console.error('Clear general logo failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// POST test endpoint for a category
router.post('/settings/:key/test', authenticateToken, isAdmin, async (req, res) => {
  const key = req.params.key;
  try {
    // Accept overrides from body; if not provided, use stored settings
    let cfg = req.body && Object.keys(req.body).length ? req.body : null;
    if (!cfg) {
      const { rows } = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
      cfg = rows && rows[0] ? rows[0].data : {};
    }
    if (key === 'database') {
      const { ok, errors, cleaned } = validateSettings('database', cfg);
      if (!ok) return res.status(400).json({ msg: 'Validation failed', errors });
      const testPool = new PgPool({
        host: cleaned.host,
        port: cleaned.port,
        user: cleaned.user,
        password: cleaned.password,
        database: cleaned.database,
        ssl: cleaned.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 3000,
      });
      let client;
      try {
        client = await testPool.connect();
        const r = await client.query('SELECT 1 as ok');
        return res.json({ ok: true, details: 'Connected successfully', result: r.rows && r.rows[0] });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message || String(e) });
      } finally {
        try { if (client) client.release(); } catch (_) {}
        try { await testPool.end(); } catch (_) {}
      }
    } else if (key === 'telegram') {
      const { ok, errors, cleaned } = validateSettings('telegram', cfg);
      if (!ok) return res.status(400).json({ msg: 'Validation failed', errors });
      // For safety, we do not call external Telegram API here. Validate token shape only.
      const tokenPattern = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
      const tokenLooksValid = tokenPattern.test(cleaned.botToken);
      return res.json({ ok: tokenLooksValid, details: tokenLooksValid ? 'Token format looks valid' : 'Token format appears invalid' });
    } else if (key === 'remoteServer') {
      const { ok, errors, cleaned } = validateSettings('remoteServer', cfg);
      if (!ok) return res.status(400).json({ msg: 'Validation failed', errors });
      // Attempt a TCP connect to the host:port to verify reachability
      const timeoutMs = 3000;
      await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let finished = false;
        const done = (err) => { if (finished) return; finished = true; try { socket.destroy(); } catch (_) {} err ? reject(err) : resolve(); };
        socket.setTimeout(timeoutMs);
        socket.once('error', done);
        socket.once('timeout', () => done(new Error('Connection timed out')));
        socket.connect(cleaned.port, cleaned.host, () => done());
      });
      return res.json({ ok: true, details: 'TCP port reachable' });
    } else if (key === 'general') {
      const { ok, errors, cleaned } = validateSettings('general', cfg);
      if (!ok) return res.status(400).json({ msg: 'Validation failed', errors });
      // Nothing external to test; echo back normalized config
      return res.json({ ok: true, details: 'General settings validated', config: cleaned });
    } else {
      return res.status(400).json({ msg: 'Unknown settings category' });
    }
  } catch (err) {
    console.error('TEST settings failed:', err && err.stack ? err.stack : err);
    // record an audit entry for failed test without leaking secrets
    try {
      await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'TEST', null, null]);
    } catch (_) {}
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// =============================
// Backups: Configuration and Database (admin-only)
// =============================

// Helper to format download filenames
function tsName(prefix, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
  return name;
}

// GET config backup (config.json)
router.get('/backup/config', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Optional: record a backup audit if ?record=1
    try {
      if (String(req.query.record || '') === '1') {
        await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, 'backup', 'BACKUP', null, null]);
      }
    } catch (_) {}
    const admins = await pool.query('SELECT id, display_name, username, role, avatar_url, created_at FROM admins ORDER BY id');
    const settings = await pool.query('SELECT settings_key, data, updated_at FROM app_settings ORDER BY settings_key');
    const payload = {
      type: 'config-backup-v1',
      createdAt: new Date().toISOString(),
      admins: admins.rows || [],
      app_settings: (settings.rows || []).map(r => ({ settings_key: r.settings_key, data: maskSecrets(r.settings_key, r.data), updated_at: r.updated_at })),
    };
    const json = JSON.stringify(payload, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${tsName('config', 'json')}"`);
    return res.send(json);
  } catch (err) {
    console.error('backup config failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// POST restore config (config.json) — merge only, no password changes
router.post('/restore/config', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
  const parseBody = () => {
    try {
      if (req.file && req.file.buffer) return JSON.parse(req.file.buffer.toString('utf8'));
      return req.body && typeof req.body === 'object' ? req.body : null;
    } catch (e) { return null; }
  };
  const data = parseBody();
  if (!data || data.type !== 'config-backup-v1') return res.status(400).json({ msg: 'Invalid config backup format' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // restore app_settings (masked values are just for view; rely on provided data if secrets present)
    if (Array.isArray(data.app_settings)) {
      for (const s of data.app_settings) {
        const key = s.settings_key;
        const raw = s.data || {};
        // we will accept data as-is; it may be masked; caller should re-enter secrets after restore
        await client.query(
          `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
           VALUES ($1,$2,$3, now())
           ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, raw, req.user && req.user.id ? req.user.id : null]
        );
        // audit
        try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', null, maskSecrets(key, raw)]); } catch (_) {}
      }
    }
    // merge admins by username (no password updates)
    if (Array.isArray(data.admins)) {
      for (const a of data.admins) {
        const { display_name, username, role, avatar_url } = a;
        if (!username) continue;
        await client.query(
          `INSERT INTO admins (display_name, username, password_hash, role, avatar_url)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, avatar_url = EXCLUDED.avatar_url`,
          [display_name || username, username, '$2b$10$PLACEHOLDERPLACEHOLDERPLACEHOLDERuIvqJwQoak', role || 'VIEWER', avatar_url || null]
        );
      }
    }
    await client.query('COMMIT');
    return res.json({ msg: 'Config restored (merge)', admins: data.admins ? data.admins.length : 0, settings: data.app_settings ? data.app_settings.length : 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('restore config failed:', err);
    return res.status(500).json({ msg: 'Failed to restore config' });
  } finally {
    client.release();
  }
});

// GET database backup (.db) — JSON payload with .db extension
router.get('/backup/db', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Optional: record a backup audit if ?record=1
    try {
      if (String(req.query.record || '') === '1') {
        await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, 'backup', 'BACKUP', null, null]);
      }
    } catch (_) {}
    const admins = await pool.query('SELECT id, display_name, username, role, avatar_url, created_at FROM admins ORDER BY id');
    const servers = await pool.query('SELECT id, server_name, created_at FROM servers ORDER BY id');
    // permissions tables: prefer new name, fallback to legacy
    let viewerPerms = [];
    try { const r = await pool.query('SELECT editor_id, server_id FROM viewer_server_permissions'); viewerPerms = r.rows || []; }
    catch (e) { try { const r2 = await pool.query('SELECT editor_id, server_id FROM editor_server_permissions'); viewerPerms = r2.rows || []; } catch (_) {} }
    const serverAdmins = await pool.query('SELECT admin_id, server_id FROM server_admin_permissions');
    const settings = await pool.query('SELECT settings_key, data, updated_at FROM app_settings ORDER BY settings_key');
    const payload = {
      type: 'db-backup-v1',
      createdAt: new Date().toISOString(),
      admins: admins.rows || [],
      servers: servers.rows || [],
      viewer_server_permissions: viewerPerms,
      server_admin_permissions: serverAdmins.rows || [],
      app_settings: (settings.rows || []).map(r => ({ settings_key: r.settings_key, data: maskSecrets(r.settings_key, r.data), updated_at: r.updated_at })),
    };
    const json = JSON.stringify(payload);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${tsName('database', 'db')}"`);
    return res.send(json);
  } catch (err) {
    console.error('backup db failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// POST restore DB (.db) — merge only, safe subset
router.post('/restore/db', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ msg: 'No file uploaded' });
    if (req.file.size > 5 * 1024 * 1024) return res.status(413).json({ msg: 'File too large' });
    let payload;
    try { payload = JSON.parse(req.file.buffer.toString('utf8')); } catch (e) { return res.status(400).json({ msg: 'Invalid .db file (must be JSON)' }); }
    if (!payload || payload.type !== 'db-backup-v1') return res.status(400).json({ msg: 'Unsupported .db format' });
    // optional checksum verification if client provided x-checksum-sha256 header (hex)
    try {
      const provided = (req.headers['x-checksum-sha256'] || '').toString().trim().toLowerCase();
      if (provided) {
        const crypto = require('crypto');
        const actual = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        if (provided !== actual) return res.status(400).json({ msg: 'Checksum mismatch' });
      }
    } catch (_) {}
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // servers
      if (Array.isArray(payload.servers)) {
        for (const s of payload.servers) {
          const name = s.server_name || s.name;
          if (!name) continue;
          await client.query(
            `INSERT INTO servers (id, server_name, created_at)
             VALUES ($1,$2,COALESCE($3, now()))
             ON CONFLICT (id) DO UPDATE SET server_name = EXCLUDED.server_name`,
            [s.id || null, name, s.created_at || null]
          );
        }
      }
      // admins (merge, no passwords)
      if (Array.isArray(payload.admins)) {
        for (const a of payload.admins) {
          const { display_name, username, role, avatar_url } = a;
          if (!username) continue;
          await client.query(
            `INSERT INTO admins (display_name, username, password_hash, role, avatar_url)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, avatar_url = EXCLUDED.avatar_url`,
            [display_name || username, username, '$2b$10$PLACEHOLDERPLACEHOLDERPLACEHOLDERuIvqJwQoak', role || 'VIEWER', avatar_url || null]
          );
        }
      }
      // settings
      if (Array.isArray(payload.app_settings)) {
        for (const s of payload.app_settings) {
          const key = s.settings_key;
          const raw = s.data || {};
          await client.query(
            `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
             VALUES ($1,$2,$3, now())
             ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [key, raw, req.user && req.user.id ? req.user.id : null]
          );
          try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', null, maskSecrets(key, raw)]); } catch (_) {}
        }
      }
      // permissions
      if (Array.isArray(payload.viewer_server_permissions)) {
        for (const p of payload.viewer_server_permissions) {
          await client.query(
            `INSERT INTO viewer_server_permissions (editor_id, server_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [p.editor_id, p.server_id]
          );
        }
      }
      if (Array.isArray(payload.server_admin_permissions)) {
        for (const p of payload.server_admin_permissions) {
          await client.query(
            `INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [p.admin_id, p.server_id]
          );
        }
      }
      await client.query('COMMIT');
      return res.json({ msg: 'Database restored (merge)',
        counts: {
          servers: payload.servers ? payload.servers.length : 0,
          admins: payload.admins ? payload.admins.length : 0,
          viewer_perms: payload.viewer_server_permissions ? payload.viewer_server_permissions.length : 0,
          server_admin_perms: payload.server_admin_permissions ? payload.server_admin_permissions.length : 0,
          settings: payload.app_settings ? payload.app_settings.length : 0,
        }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('restore db failed:', err);
      return res.status(500).json({ msg: 'Failed to restore db' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('restore db outer failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// Config restore: add size limit and checksum support
router.post('/restore/config', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
  const parseBody = () => {
    try {
      if (req.file && req.file.buffer) return JSON.parse(req.file.buffer.toString('utf8'));
      return req.body && typeof req.body === 'object' ? req.body : null;
    } catch (e) { return null; }
  };
  try {
    if (req.file && req.file.size > 1024 * 1024) return res.status(413).json({ msg: 'File too large' });
    // optional checksum header
    try {
      if (req.file) {
        const provided = (req.headers['x-checksum-sha256'] || '').toString().trim().toLowerCase();
        if (provided) {
          const crypto = require('crypto');
          const actual = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
          if (provided !== actual) return res.status(400).json({ msg: 'Checksum mismatch' });
        }
      }
    } catch (_) {}
  } catch (e) { return res.status(400).json({ msg: 'Invalid upload' }); }
  const data = parseBody();
  if (!data || data.type !== 'config-backup-v1') return res.status(400).json({ msg: 'Invalid config backup format' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Array.isArray(data.app_settings)) {
      for (const s of data.app_settings) {
        const key = s.settings_key;
        const raw = s.data || {};
        await client.query(
          `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
           VALUES ($1,$2,$3, now())
           ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, raw, req.user && req.user.id ? req.user.id : null]
        );
        try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', null, maskSecrets(key, raw)]); } catch (_) {}
      }
    }
    if (Array.isArray(data.admins)) {
      for (const a of data.admins) {
        const { display_name, username, role, avatar_url } = a;
        if (!username) continue;
        await client.query(
          `INSERT INTO admins (display_name, username, password_hash, role, avatar_url)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, avatar_url = EXCLUDED.avatar_url`,
          [display_name || username, username, '$2b$10$PLACEHOLDERPLACEHOLDERPLACEHOLDERuIvqJwQoak', role || 'VIEWER', avatar_url || null]
        );
      }
    }
    await client.query('COMMIT');
    return res.json({ msg: 'Config restored (merge)', admins: data.admins ? data.admins.length : 0, settings: data.app_settings ? data.app_settings.length : 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('restore config failed:', err);
    return res.status(500).json({ msg: 'Failed to restore config' });
  } finally {
    client.release();
  }
});

// DB status/summary (admin only)
router.get('/db/status', authenticateToken, isAdmin, async (req, res) => {
  try {
    const dbInfo = {
      host: process.env.DB_HOST,
      database: process.env.DB_DATABASE,
    };
    // counts
    const [admins, servers] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM admins'),
      pool.query('SELECT COUNT(*)::int AS c FROM servers')
    ]);
    // last backup time: from our explicit BACKUP entries
    let lastBackup = null;
    try {
      const r = await pool.query("SELECT MAX(created_at) AS ts FROM settings_audit WHERE settings_key = 'backup' AND action = 'BACKUP'");
      lastBackup = r.rows && r.rows[0] && r.rows[0].ts ? r.rows[0].ts : null;
    } catch (_) {}
    // table count: roughly count from information_schema
    let tables = null;
    try {
      const r2 = await pool.query("SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'");
      tables = r2.rows && r2.rows[0] ? r2.rows[0].c : null;
    } catch (_) {}
    // pg version
    let version = null;
    try {
      const vr = await pool.query('SHOW server_version');
      version = vr.rows && vr.rows[0] ? Object.values(vr.rows[0])[0] : null;
    } catch (_) {
      try { const vr2 = await pool.query('SELECT version() as v'); version = vr2.rows && vr2.rows[0] ? vr2.rows[0].v : null; } catch (__) {}
    }
    // db size
    let dbSize = null;
    try {
      const sr = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes');
      dbSize = sr.rows && sr.rows[0] ? { pretty: sr.rows[0].size, bytes: Number(sr.rows[0].bytes) } : null;
    } catch (_) {}
    // largest tables (top 5)
    let largestTables = [];
    try {
      const tr = await pool.query("SELECT relname AS table, pg_total_relation_size(relid) AS bytes, pg_size_pretty(pg_total_relation_size(relid)) AS pretty FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 5");
      largestTables = (tr.rows || []).map(r => ({ table: r.table, bytes: Number(r.bytes), pretty: r.pretty }));
    } catch (_) {}
    return res.json({ ...dbInfo, version, dbSize, tables, counts: { admins: admins.rows[0].c, servers: servers.rows[0].c }, lastBackup, largestTables });
  } catch (err) {
    console.error('db status failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// Explicitly record a backup event (no payload) and return timestamp
router.post('/backup/record', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action) VALUES ($1,$2,$3) RETURNING created_at', [req.user && req.user.id ? req.user.id : null, 'backup', 'BACKUP']);
    const created_at = rows && rows[0] ? rows[0].created_at : new Date().toISOString();
    return res.json({ msg: 'Backup recorded', created_at });
  } catch (err) {
    console.error('backup record failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});
module.exports = router;
