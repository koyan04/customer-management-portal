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

// Helper: Convert expire_date ISO timestamp to correct local YYYY-MM-DD date string.
// When PostgreSQL stores a DATE column, node-pg returns it as a JS Date at midnight LOCAL time,
// which JSON.stringify converts to UTC ISO (e.g. midnight MMT = 17:30Z previous day).
// On restore, inserting that ISO string into a DATE column would lose a day in positive-offset timezones.
// This function detects ISO timestamps and converts them to the correct local date.
function fixExpireDate(val) {
  if (!val) return val;
  const s = String(val).trim();
  // Already a plain date (YYYY-MM-DD) — no conversion needed
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO timestamp — convert to local date using app timezone
  if (s.includes('T')) {
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return val;
      // Try to use the app's configured timezone
      let tz = 'UTC';
      try {
        const settingsCache = require('../lib/settingsCache');
        const cached = settingsCache.getGeneralCached();
        if (cached && cached.timezone) tz = cached.timezone;
      } catch (_) {}
      // Format as YYYY-MM-DD in the target timezone
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      return parts; // en-CA locale gives YYYY-MM-DD format
    } catch (_) {
      return val;
    }
  }
  return val;
}

// Key server config helpers (for including in main backups)
const KEYSERVER_CONFIG_PATH = path.join(__dirname, '..', 'data', 'keyserver.json');
function loadKeyserverConfig() {
  try {
    if (fs.existsSync(KEYSERVER_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(KEYSERVER_CONFIG_PATH, 'utf-8'));
    }
  } catch (_) {}
  return null;
}
function saveKeyserverConfig(config) {
  try {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(KEYSERVER_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) { console.warn('Failed to save keyserver config:', e && e.message ? e.message : e); }
}

const uploadsPath = path.join(__dirname, '..', 'public', 'uploads');
const logosPath = path.join(__dirname, '..', 'public', 'logos'); // Persistent logo storage
try { if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true }); } catch(e) { console.warn('mkdir uploads failed', e && e.message ? e.message : e); }
try { if (!fs.existsSync(logosPath)) fs.mkdirSync(logosPath, { recursive: true }); } catch(e) { console.warn('mkdir logos failed', e && e.message ? e.message : e); }
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
    // Prefer cached general settings preloaded at startup; fall back to DB on cache miss
    let data;
    try {
      const settingsCache = require('../lib/settingsCache');
      const cached = settingsCache.getGeneralCached();
      if (cached && Object.keys(cached).length) data = cached;
    } catch (_) { /* ignore cache errors */ }
    if (!data) {
      const { rows } = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
      data = rows && rows[0] ? rows[0].data : {};
    }
    return res.json({ key, data: maskSecrets(key, data) });
  } catch (err) {
    console.error('public settings read failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// --- ADMIN: Get all editors/admins (admin only)
router.get('/accounts', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Get admins with their session status
    // Use DISTINCT ON to ensure only one row per admin even if multiple sessions exist
    const result = await pool.query(`
      SELECT DISTINCT ON (a.id)
        a.id, 
        a.display_name, 
        a.username, 
        a.role, 
        a.avatar_url, 
        a.created_at,
        a.last_seen,
        CASE WHEN s.last_activity IS NOT NULL AND s.last_activity > NOW() - INTERVAL '60 minutes' THEN true ELSE false END as is_online,
        s.last_activity
      FROM admins a
      LEFT JOIN active_sessions s ON a.id = s.admin_id
      ORDER BY a.id, s.last_activity DESC NULLS LAST
    `);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    res.json(rows);
  } catch (err) { 
    console.error(err); 
    res.status(500).send('Server Error'); 
  }
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
    
    // Log to control_panel_audit
    const adminId = req.user && req.user.id;
    const newAccount = rows[0];
    try {
      await pool.query(
        'INSERT INTO control_panel_audit (admin_id, action, payload) VALUES ($1, $2, $3)',
        [adminId, 'CREATE_ACCOUNT', { 
          target_id: newAccount.id, 
          username: newAccount.username, 
          display_name: newAccount.display_name,
          role: newAccount.role 
        }]
      );
    } catch (auditErr) {
      console.error('Failed to log account creation to audit:', auditErr);
    }
    
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
    // Fetch old avatar_url before update so we can delete the old file
    let oldAvatarUrl = null;
    if (req.file || clearRequested) {
      try { const r = await pool.query('SELECT avatar_url FROM admins WHERE id = $1', [id]); oldAvatarUrl = (r.rows[0] && r.rows[0].avatar_url) || null; } catch (_) {}
    }
    try {
      const { rows } = await pool.query(q, params);
      // Delete old avatar file if it was in /uploads/
      if (oldAvatarUrl && oldAvatarUrl.startsWith('/uploads/')) {
        try {
          const oldFile = path.join(uploadsPath, path.basename(oldAvatarUrl));
          if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
        } catch (_) {}
      }
      
      // Log to control_panel_audit
      const adminId = req.user && req.user.id;
      const updatedAccount = rows[0];
      const changes = {};
      if (display_name !== null) changes.display_name = display_name;
      if (role !== null) changes.role = role;
      if (username !== null) changes.username = username;
      if (avatar_url !== null) changes.avatar_url = avatar_url;
      if (clearRequested) changes.avatar_cleared = true;
      
      try {
        await pool.query(
          'INSERT INTO control_panel_audit (admin_id, action, payload) VALUES ($1, $2, $3)',
          [adminId, 'UPDATE_ACCOUNT', {
            target_id: updatedAccount.id,
            username: updatedAccount.username,
            changes: changes
          }]
        );
      } catch (auditErr) {
        console.error('Failed to log account update to audit:', auditErr);
      }
      
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
    
    // Get account info before deleting for audit log
    const accountInfo = await pool.query('SELECT id, username, display_name, role FROM admins WHERE id = $1', [id]);
    const account = accountInfo.rows && accountInfo.rows[0] ? accountInfo.rows[0] : null;
    
    await pool.query('DELETE FROM admins WHERE id = $1', [id]);
    
    // Log to control_panel_audit
    if (account) {
      const adminId = req.user && req.user.id;
      try {
        await pool.query(
          'INSERT INTO control_panel_audit (admin_id, action, payload) VALUES ($1, $2, $3)',
          [adminId, 'DELETE_ACCOUNT', {
            target_id: account.id,
            username: account.username,
            display_name: account.display_name,
            role: account.role
          }]
        );
      } catch (auditErr) {
        console.error('Failed to log account deletion to audit:', auditErr);
      }
    }
    
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

// --- ADMIN: get control panel audit logs for an account (admin only)
router.get('/accounts/:id/activity-logs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    
    console.log('[activity-logs] Fetching logs for admin id:', id);
    
    // Fetch account operations from control_panel_audit
    const controlPanelResult = await pool.query(
      `SELECT 
         cpa.id, 
         cpa.admin_id, 
         cpa.action, 
         cpa.payload, 
         cpa.created_at,
         'control_panel' as source,
         a.username as target_username,
         a.display_name as target_display_name
       FROM control_panel_audit cpa
       LEFT JOIN admins a ON (cpa.payload->>'target_id')::int = a.id
       WHERE ((cpa.payload->>'target_id')::int = $1 OR cpa.admin_id = $2)
         AND cpa.action NOT IN ('cert_status', 'CERT_CHECK', 'cert_check')
       ORDER BY cpa.created_at DESC 
       LIMIT $3`,
      [id, id, limit]
    );
    
    console.log('[activity-logs] control_panel_audit rows:', controlPanelResult.rows.length);
    
    // Fetch user operations from settings_audit with user and server details
    const settingsResult = await pool.query(
      `SELECT 
         sa.id,
         sa.admin_id,
         sa.action,
         sa.settings_key,
         sa.before_data,
         sa.after_data,
         sa.created_at,
         'settings' as source,
         COALESCE(
           (sa.after_data->>'account_name'),
           (sa.before_data->>'account_name')
         ) as user_name,
         COALESCE(
           (sa.after_data->>'server_id')::int,
           (sa.before_data->>'server_id')::int
         ) as server_id,
         s.server_name
       FROM settings_audit sa
       LEFT JOIN servers s ON COALESCE(
           (sa.after_data->>'server_id')::int,
           (sa.before_data->>'server_id')::int
         ) = s.id
       WHERE sa.admin_id = $1 AND sa.settings_key = 'users'
       ORDER BY sa.created_at DESC 
       LIMIT $2`,
      [id, limit]
    );
    
    console.log('[activity-logs] settings_audit rows:', settingsResult.rows.length);
    
    // Fetch server key operations from server_keys_audit
    let serverKeysResult = { rows: [] };
    try {
      serverKeysResult = await pool.query(
        `SELECT 
           ska.id,
           ska.admin_id,
           ska.action,
           ska.key_username,
           ska.key_description,
           ska.created_at,
           'server_keys' as source,
           s.server_name
         FROM server_keys_audit ska
         LEFT JOIN servers s ON ska.server_id = s.id
         WHERE ska.admin_id = $1
         ORDER BY ska.created_at DESC 
         LIMIT $2`,
        [id, limit]
      );
      console.log('[activity-logs] server_keys_audit rows:', serverKeysResult.rows.length);
    } catch (err) {
      console.warn('[activity-logs] server_keys_audit query failed (table may not exist):', err.message);
    }
    
    // Transform the results into a consistent format
    const allLogs = [
      ...controlPanelResult.rows.map(row => ({
        id: row.id,
        action: row.action,
        object: row.target_display_name || row.target_username || 'Account',
        server: null,
        created_at: row.created_at,
        source: row.source
      })),
      ...settingsResult.rows.map(row => ({
        id: row.id,
        action: row.action,
        object: row.user_name || 'User',
        server: row.server_name || null,
        created_at: row.created_at,
        source: row.source
      })),
      ...serverKeysResult.rows.map(row => ({
        id: row.id,
        action: row.action,
        object: row.key_username || row.key_description || 'Server Key',
        server: row.server_name || null,
        created_at: row.created_at,
        source: row.source
      }))
    ]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
    
    console.log('[activity-logs] Total combined logs:', allLogs.length);
    
    res.json(allLogs);
  } catch (err) {
    console.error('get activity logs failed:', err && err.message ? err.message : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// Clear activity logs for an account
router.delete('/accounts/:id/activity-logs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('[clear-activity-logs] Clearing logs for admin id:', id);
    
    // Delete from control_panel_audit
    const controlPanelResult = await pool.query(
      `DELETE FROM control_panel_audit 
       WHERE (payload->>'target_id')::int = $1 OR admin_id = $2`,
      [id, id]
    );
    
    // Delete from settings_audit
    const settingsResult = await pool.query(
      `DELETE FROM settings_audit WHERE admin_id = $1 AND settings_key = 'users'`,
      [id]
    );
    
    // Delete from server_keys_audit
    let serverKeysResult = { rowCount: 0 };
    try {
      serverKeysResult = await pool.query(
        `DELETE FROM server_keys_audit WHERE admin_id = $1`,
        [id]
      );
    } catch (err) {
      console.warn('[clear-activity-logs] server_keys_audit delete failed (table may not exist):', err.message);
    }
    
    console.log('[clear-activity-logs] Deleted', controlPanelResult.rowCount, 'control_panel_audit rows');
    console.log('[clear-activity-logs] Deleted', settingsResult.rowCount, 'settings_audit rows');
    console.log('[clear-activity-logs] Deleted', serverKeysResult.rowCount, 'server_keys_audit rows');
    
    res.json({ 
      msg: 'Activity logs cleared successfully',
      deleted: {
        control_panel: controlPanelResult.rowCount,
        settings: settingsResult.rowCount,
        server_keys: serverKeysResult.rowCount
      }
    });
  } catch (err) {
    console.error('clear activity logs failed:', err && err.message ? err.message : err);
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
  }
  else if (key === 'telegram') {
    // NOTE: Telegram botToken masking removed per request — return raw token
    // (leave other telegram fields untouched)
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

// --- Helpers for safe settings merges on restore/update paths
function isMaskedSecret(v) {
  return typeof v === 'string' && v.replace(/\*/g, '*') === '********';
}

function shallowMerge(objA, objB) {
  return Object.assign({}, objA || {}, objB || {});
}

function safeMergeSettings(key, current, incoming) {
  const cur = current && typeof current === 'object' ? current : {};
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  // For most keys, a shallow merge preserves existing fields not present in backup
  let merged = shallowMerge(cur, inc);
  if (key === 'telegram') {
    // Don't overwrite secrets with masked placeholders or omitted fields
    if (typeof inc.botToken === 'undefined' || isMaskedSecret(inc.botToken)) {
      if (typeof cur.botToken !== 'undefined') merged.botToken = cur.botToken;
      else delete merged.botToken;
    }
    // normalize boolean defaults handled by validateSettings elsewhere
  } else if (key === 'database') {
    if (typeof inc.password === 'undefined' || isMaskedSecret(inc.password)) {
      if (typeof cur.password !== 'undefined') merged.password = cur.password;
      else delete merged.password;
    }
  } else if (key === 'remoteServer') {
    for (const secretField of ['password','privateKey','passphrase']) {
      if (typeof inc[secretField] === 'undefined' || isMaskedSecret(inc[secretField])) {
        if (typeof cur[secretField] !== 'undefined') merged[secretField] = cur[secretField];
        else delete merged[secretField];
      }
    }
  }
  return merged;
}

async function warnIfKeyDrop(client, key, beforeObj, afterObj) {
  try {
    if (!beforeObj || typeof beforeObj !== 'object') return;
    const beforeCount = Object.keys(beforeObj).length;
    const afterCount = afterObj && typeof afterObj === 'object' ? Object.keys(afterObj).length : 0;
    if (beforeCount >= 2 && afterCount < beforeCount / 2) {
      await client.query(
        'INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)',
        [null, key, 'WARNING_KEY_DROP', { _meta: { beforeCount } }, { _meta: { afterCount } }]
      );
    }
  } catch (e) {
    // best-effort; do not fail restores
    try { console.warn('warnIfKeyDrop failed:', e && e.message ? e.message : e); } catch(_) {}
  }
}

// Financial reports: monthly/yearly summaries using historical prices from settings_audit
// Now uses snapshots when available for completed months
router.get('/financial', authenticateToken, async (req, res) => {
  try {
    // DEBUG: log the authenticated user to help trace permission issues during testing
    try { console.debug('[DEBUG GET /api/admin/financial] req.user=', req.user); } catch (e) {}
    // Allow global ADMINs full access. SERVER_ADMINs may view financials scoped to their assigned servers.
    // Support userId query param for ADMIN to view as another user
    const role = req.user && req.user.role;
    const targetUserId = req.query.userId ? Number(req.query.userId) : null;
    
    try { console.log('[DEBUG GET /api/admin/financial] branch check, role=', role, 'userId=', req.user && req.user.id, 'targetUserId=', targetUserId); } catch (e) {}
    let queryParams = [];
    let serverIdsFilter = null;
    
    // If ADMIN is viewing as another user, apply that user's permissions
    if (role === 'ADMIN' && targetUserId) {
      // Fetch target user's role
      const userRes = await pool.query('SELECT role FROM admins WHERE id = $1', [targetUserId]);
      const targetRole = userRes.rows && userRes.rows[0] ? userRes.rows[0].role : null;
      
      console.log('[DEBUG] Target user role:', targetRole, 'for userId:', targetUserId);
      
      if (targetRole === 'SERVER_ADMIN') {
        // Apply SERVER_ADMIN filtering for target user
        const r = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [targetUserId]);
        const sids = (r.rows || []).map(x => Number(x.server_id)).filter(x => !Number.isNaN(x));
        console.log('[DEBUG] SERVER_ADMIN server IDs for target user:', sids);
        if (sids.length > 0) {
          serverIdsFilter = sids;
          queryParams = [sids];
        }
      }
      // If target is ADMIN or other role, show all data (no filter)
    } else if (role && role !== 'ADMIN') {
      // only SERVER_ADMIN should reach here; others are forbidden
      if (role !== 'SERVER_ADMIN') {
        try { console.log('[DEBUG GET /api/admin/financial] deny non-server-admin role=', role, 'userId=', req.user && req.user.id); } catch (e) {}
        return res.status(403).json({ msg: 'Forbidden' });
      }
      // fetch assigned server ids
      const r = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [req.user.id]);
      const sids = (r.rows || []).map(x => Number(x.server_id)).filter(x => !Number.isNaN(x));
      console.log('[DEBUG] SERVER_ADMIN sids for current user', req.user && req.user.id, '=', sids);
      if (!sids.length) {
        try { console.log('[DEBUG GET /api/admin/financial] SERVER_ADMIN has no assigned servers, denying access userId=', req.user && req.user.id); } catch (e) {}
        return res.status(403).json({ msg: 'Forbidden' });
      }
      serverIdsFilter = sids;
      queryParams = [sids];
    }
    
    console.log('[DEBUG] Final queryParams before SQL:', queryParams, 'serverIdsFilter:', serverIdsFilter);

    // Fetch current currency setting with error handling
    let currentCurrency = 'USD';
    try {
      const currencyQuery = await pool.query(`SELECT data FROM app_settings WHERE settings_key = 'general'`);
      currentCurrency = (currencyQuery.rows && currencyQuery.rows[0] && currencyQuery.rows[0].data && currencyQuery.rows[0].data.currency) || 'USD';
      console.log('[DEBUG] Current currency:', currentCurrency);
    } catch (currErr) {
      console.warn('[WARN] Failed to fetch currency setting, using USD:', currErr.message);
    }

    // Fetch snapshots for last 12 months
    // ADMIN: fetch global snapshots (server_id IS NULL)
    // SERVER_ADMIN: fetch snapshots for their assigned servers (server_id IN (...))
    let snapshotsQuery;
    let snapshotsParams = [];
    
    if (serverIdsFilter && serverIdsFilter.length > 0) {
      // SERVER_ADMIN viewing: get snapshots for their assigned servers
      snapshotsQuery = `
        SELECT month_start, month_end, mini_count, basic_count, unlimited_count,
               price_mini_cents, price_basic_cents, price_unlimited_cents, revenue_cents,
               server_id, TRUE as is_snapshot
        FROM monthly_financial_snapshots
        WHERE month_start >= date_trunc('month', CURRENT_DATE) - interval '11 months'
          AND month_start < date_trunc('month', CURRENT_DATE)
          AND server_id = ANY($1::int[])
        ORDER BY month_start ASC
      `;
      snapshotsParams = [serverIdsFilter];
    } else {
      // ADMIN viewing: get global snapshots (server_id IS NULL)
      snapshotsQuery = `
        SELECT month_start, month_end, mini_count, basic_count, unlimited_count,
               price_mini_cents, price_basic_cents, price_unlimited_cents, revenue_cents,
               server_id, TRUE as is_snapshot
        FROM monthly_financial_snapshots
        WHERE month_start >= date_trunc('month', CURRENT_DATE) - interval '11 months'
          AND month_start < date_trunc('month', CURRENT_DATE)
          AND server_id IS NULL
        ORDER BY month_start ASC
      `;
    }
    
    const { rows: snapshotRows } = await pool.query(snapshotsQuery, snapshotsParams);
    console.log('[DEBUG] Snapshot query found', snapshotRows.length, 'rows. serverIdsFilter:', serverIdsFilter);
    if (snapshotRows.length > 0) {
      console.log('[DEBUG] First snapshot row:', JSON.stringify(snapshotRows[0]));
    }
    
    // Create map of months with snapshots
    const snapshotsMap = new Map();
    for (const row of snapshotRows) {
      const monthLabel = `${row.month_start.getFullYear()}-${String(row.month_start.getMonth() + 1).padStart(2, '0')}`;
      snapshotsMap.set(monthLabel, row);
    }

    // For months without snapshots or SERVER_ADMIN filtering, calculate on-the-fly
    // Single SQL to aggregate counts per month and per service_type for the last 12 months,
    // plus fetch the most-recent `settings_audit.after_data` per month (LATERAL) so we can derive prices.
    // Build filtered users subquery first - use WHERE clause in CTE without table alias
    const filteredUsersClause = queryParams.length > 0 ? `
      WITH filtered_users AS (
        SELECT * FROM users WHERE server_id = ANY($1::int[])
      )
    ` : '';
    
    const userTableName = queryParams.length > 0 ? 'filtered_users' : 'users';
    
    console.log('[DEBUG] Using table:', userTableName, 'with CTE:', !!filteredUsersClause, 'snapshots:', snapshotsMap.size);
    
    const q = `
      ${filteredUsersClause}
      ${filteredUsersClause ? ',' : 'WITH'} months AS (
        SELECT generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') AS month_start
      ),
      user_counts AS (
        SELECT m.month_start,
               COALESCE(u.service_type, '') AS service_type,
               COUNT(u.*)::int AS cnt
        FROM months m
        LEFT JOIN ${userTableName} u
          ON u.created_at <= (m.month_start + interval '1 month' - interval '1 ms')
          AND (u.expire_date IS NULL OR u.expire_date >= m.month_start)
          AND u.enabled = TRUE
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
    
    console.log('[DEBUG] Executing SQL with params:', queryParams);

  const { rows } = await pool.query(q, queryParams);
  
    console.log('[DEBUG] Query returned', rows.length, 'rows, snapshots:', snapshotsMap.size);

    // Helper to normalize service type
    const normalizeService = (svc) => {
      const v = (svc || '').toString().toLowerCase();
      if (v === 'x-ray' || v === 'xray' || v === 'outline') return 'Mini';
      if (v === 'mini') return 'Mini';
      if (v === 'basic') return 'Basic';
      if (v === 'unlimited') return 'Unlimited';
      return svc || '';
    };

    // Organize rows by month, prioritizing snapshots
    const monthsMap = new Map();
    for (const r of rows) {
      const monthStart = r.month_start ? new Date(r.month_start) : null;
      const label = monthStart ? `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}` : null;
      
      // Check if we have a snapshot for this month (already filtered by server_id in query)
      if (snapshotsMap.has(label)) {
        // Use snapshot data
        const snapshot = snapshotsMap.get(label);
        if (!monthsMap.has(label)) {
          monthsMap.set(label, {
            month: label,
            start: new Date(snapshot.month_start).toISOString(),
            end: new Date(snapshot.month_end).toISOString(),
            counts: {
              Mini: Number(snapshot.mini_count || 0),
              Basic: Number(snapshot.basic_count || 0),
              Unlimited: Number(snapshot.unlimited_count || 0)
            },
            prices: {
              price_mini_cents: Number(snapshot.price_mini_cents || 0),
              price_basic_cents: Number(snapshot.price_basic_cents || 0),
              price_unlimited_cents: Number(snapshot.price_unlimited_cents || 0)
            },
            revenue_cents: Number(snapshot.revenue_cents || 0),
            is_snapshot: true
          });
        }
      } else {
        // Calculate on-the-fly
        if (!monthsMap.has(label)) {
          monthsMap.set(label, {
            month: label,
            start: monthStart ? monthStart.toISOString() : null,
            end: monthStart ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999).toISOString() : null,
            counts: { Mini: 0, Basic: 0, Unlimited: 0 },
            prices: { price_mini_cents: 0, price_basic_cents: 0, price_unlimited_cents: 0 },
            revenue_cents: 0,
            is_snapshot: false,
            rawAudit: r.audit_after,
            currentApp: r.current_app
          });
        }
        const entry = monthsMap.get(label);
        if (!entry.is_snapshot) {
          const svcNorm = normalizeService(r.service_type);
          const cnt = Number(r.cnt || 0);
          if (svcNorm === 'Mini' || svcNorm === 'Basic' || svcNorm === 'Unlimited') {
            entry.counts[svcNorm] += cnt;
          }
          if (r.audit_after && !entry.rawAudit) entry.rawAudit = r.audit_after;
          if (r.current_app && !entry.currentApp) entry.currentApp = r.current_app;
        }
      }
    }

    // Finalize prices and revenue for calculated months
    for (const [k, v] of monthsMap.entries()) {
      if (!v.is_snapshot) {
        const d = v.rawAudit || v.currentApp || {};
        const safeNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
        v.prices.price_mini_cents = safeNum((d && d.price_mini_cents) || (d && d.price_backup_decimal && d.price_backup_decimal.price_mini ? Math.round(Number(d.price_backup_decimal.price_mini) * 100) : 0));
        v.prices.price_basic_cents = safeNum((d && d.price_basic_cents) || (d && d.price_backup_decimal && d.price_backup_decimal.price_basic ? Math.round(Number(d.price_backup_decimal.price_basic) * 100) : 0));
        v.prices.price_unlimited_cents = safeNum((d && d.price_unlimited_cents) || (d && d.price_backup_decimal && d.price_backup_decimal.price_unlimited ? Math.round(Number(d.price_backup_decimal.price_unlimited) * 100) : 0));
        v.revenue_cents = (v.counts.Mini * v.prices.price_mini_cents) + (v.counts.Basic * v.prices.price_basic_cents) + (v.counts.Unlimited * v.prices.price_unlimited_cents);
        delete v.rawAudit;
        delete v.currentApp;
      }
    }

    const results = Array.from(monthsMap.values());
    console.log('[DEBUG] Sending', results.length, 'months to frontend, snapshots used:', results.filter(m => m.is_snapshot).length);
    console.log('[DEBUG] First month sample:', JSON.stringify(results[0]));
    console.log('[DEBUG] Currency:', currentCurrency);
    // compute year totals for current year
    const now = new Date();
    const thisYear = now.getFullYear();
    const yearMonths = results.filter(r => Number(r.month.slice(0,4)) === thisYear);
    const yearTotals = { counts: { Mini: 0, Basic: 0, Unlimited: 0 }, revenue_cents: 0 };
    for (const m of yearMonths) {
      yearTotals.counts.Mini += Number(m.counts?.Mini || 0);
      yearTotals.counts.Basic += Number(m.counts?.Basic || 0);
      yearTotals.counts.Unlimited += Number(m.counts?.Unlimited || 0);
      // Convert to Number to avoid string concatenation
      yearTotals.revenue_cents += Number(m.revenue_cents || 0);
    }

    return res.json({ months: results, year: thisYear, yearTotals, currency: currentCurrency });
  } catch (err) {
    console.error('GET /financial failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// Generate monthly financial snapshot
// POST /api/admin/financial/snapshot?month=YYYY-MM&userId=X (month optional, defaults to previous month)
router.post('/financial/snapshot', authenticateToken, async (req, res) => {
  try {
    const role = req.user && req.user.role;
    const targetUserId = req.query.userId ? Number(req.query.userId) : null;
    
    if (role !== 'ADMIN' && role !== 'SERVER_ADMIN') {
      return res.status(403).json({ msg: 'Only ADMINs and SERVER_ADMINs can generate financial snapshots' });
    }

    // Parse target month from query param or default to previous month
    const monthParam = req.query.month; // Expected format: YYYY-MM
    let targetMonth;
    
    if (monthParam) {
      const parsed = new Date(monthParam + '-01');
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ msg: 'Invalid month format. Use YYYY-MM' });
      }
      targetMonth = parsed;
    } else {
      // Default to previous month
      const now = new Date();
      targetMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    }

    // Don't allow snapshots for future months
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (targetMonth >= currentMonth) {
      return res.status(400).json({ msg: 'Cannot create snapshot for current or future months' });
    }

    const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    
    // Determine server filtering
    let serverIdsFilter = null;
    
    // If ADMIN is viewing as another user, apply that user's permissions
    if (role === 'ADMIN' && targetUserId) {
      const userRes = await pool.query('SELECT role FROM admins WHERE id = $1', [targetUserId]);
      const targetRole = userRes.rows && userRes.rows[0] ? userRes.rows[0].role : null;
      
      if (targetRole === 'SERVER_ADMIN') {
        // Create snapshot for target SERVER_ADMIN's servers
        const r = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [targetUserId]);
        serverIdsFilter = (r.rows || []).map(x => Number(x.server_id)).filter(x => !Number.isNaN(x));
        console.log('[DEBUG POST /financial/snapshot] ADMIN creating snapshot for SERVER_ADMIN', targetUserId, 'serverIdsFilter:', serverIdsFilter);
        if (!serverIdsFilter.length) {
          return res.status(403).json({ msg: 'Target user has no servers assigned' });
        }
      }
      // If target is ADMIN, create global snapshot (serverIdsFilter stays null)
    } else if (role === 'SERVER_ADMIN') {
      // SERVER_ADMIN creating their own snapshot
      const r = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [req.user.id]);
      serverIdsFilter = (r.rows || []).map(x => Number(x.server_id)).filter(x => !Number.isNaN(x));
      console.log('[DEBUG POST /financial/snapshot] SERVER_ADMIN user', req.user.id, 'has serverIdsFilter:', serverIdsFilter);
      if (!serverIdsFilter.length) {
        return res.status(403).json({ msg: 'No servers assigned to create snapshots' });
      }
    }
    console.log('[DEBUG POST /financial/snapshot] Creating snapshot for month:', targetMonth, 'with serverIdsFilter:', serverIdsFilter);
    
    // Helper to normalize service type
    const normalizeService = (svc) => {
      const v = (svc || '').toString().toLowerCase();
      if (v === 'x-ray' || v === 'xray' || v === 'outline') return 'Mini';
      if (v === 'mini') return 'Mini';
      if (v === 'basic') return 'Basic';
      if (v === 'unlimited') return 'Unlimited';
      return null;
    };

    // Count active users at end of month by service type (filtered by servers if SERVER_ADMIN)
    let countQuery, countParams;
    if (serverIdsFilter) {
      countQuery = `
        SELECT service_type, COUNT(*)::int AS cnt
        FROM users
        WHERE created_at <= $1
          AND (expire_date IS NULL OR expire_date >= $2)
          AND enabled = TRUE
          AND server_id = ANY($3::int[])
        GROUP BY service_type
      `;
      countParams = [monthEnd, monthStart, serverIdsFilter];
    } else {
      countQuery = `
        SELECT service_type, COUNT(*)::int AS cnt
        FROM users
        WHERE created_at <= $1
          AND (expire_date IS NULL OR expire_date >= $2)
          AND enabled = TRUE
        GROUP BY service_type
      `;
      countParams = [monthEnd, monthStart];
    }
    const countResult = await pool.query(countQuery, countParams);
    
    const counts = { Mini: 0, Basic: 0, Unlimited: 0 };
    for (const row of countResult.rows) {
      const svcNorm = normalizeService(row.service_type);
      if (svcNorm) {
        counts[svcNorm] += Number(row.cnt || 0);
      }
    }

    // Get prices at end of month from settings_audit
    const pricesQuery = `
      SELECT after_data
      FROM settings_audit
      WHERE settings_key = 'general'
        AND created_at <= $1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const pricesResult = await pool.query(pricesQuery, [monthEnd]);
    
    let prices = { price_mini_cents: 0, price_basic_cents: 0, price_unlimited_cents: 0 };
    
    if (pricesResult.rows.length > 0) {
      const data = pricesResult.rows[0].after_data || {};
      const safeNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
      prices.price_mini_cents = safeNum(data.price_mini_cents || (data.price_backup_decimal?.price_mini ? Math.round(Number(data.price_backup_decimal.price_mini) * 100) : 0));
      prices.price_basic_cents = safeNum(data.price_basic_cents || (data.price_backup_decimal?.price_basic ? Math.round(Number(data.price_backup_decimal.price_basic) * 100) : 0));
      prices.price_unlimited_cents = safeNum(data.price_unlimited_cents || (data.price_backup_decimal?.price_unlimited ? Math.round(Number(data.price_backup_decimal.price_unlimited) * 100) : 0));
    }

    // If no audit found, fall back to current settings
    if (prices.price_mini_cents === 0 && prices.price_basic_cents === 0 && prices.price_unlimited_cents === 0) {
      const currentPricesResult = await pool.query('SELECT data FROM app_settings WHERE settings_key = \'general\'');
      if (currentPricesResult.rows.length > 0) {
        const data = currentPricesResult.rows[0].data || {};
        const safeNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
        prices.price_mini_cents = safeNum(data.price_mini_cents || (data.price_backup_decimal?.price_mini ? Math.round(Number(data.price_backup_decimal.price_mini) * 100) : 0));
        prices.price_basic_cents = safeNum(data.price_basic_cents || (data.price_backup_decimal?.price_basic ? Math.round(Number(data.price_backup_decimal.price_basic) * 100) : 0));
        prices.price_unlimited_cents = safeNum(data.price_unlimited_cents || (data.price_backup_decimal?.price_unlimited ? Math.round(Number(data.price_backup_decimal.price_unlimited) * 100) : 0));
      }
    }

    // Calculate revenue
    const revenue_cents = (counts.Mini * prices.price_mini_cents) + 
                         (counts.Basic * prices.price_basic_cents) + 
                         (counts.Unlimited * prices.price_unlimited_cents);

    // For SERVER_ADMIN: use first assigned server as marker
    // For ADMIN: server_id stays NULL (global snapshot)
    const server_id_marker = serverIdsFilter && serverIdsFilter.length > 0 ? serverIdsFilter[0] : null;

    // Check if snapshot already exists (snapshots are permanent — never overwrite)
    let existingCheck;
    if (server_id_marker) {
      existingCheck = await pool.query(
        'SELECT * FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id = $2',
        [monthStart, server_id_marker]
      );
    } else {
      existingCheck = await pool.query(
        'SELECT * FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id IS NULL',
        [monthStart]
      );
    }

    if (existingCheck.rows.length > 0) {
      // Snapshot already exists — return it unchanged (snapshots are permanent records)
      console.log('Financial snapshot already exists for', targetMonth, '— returning existing (immutable).');
      return res.status(409).json({ msg: 'Snapshot already exists for this month', snapshot: existingCheck.rows[0], already_exists: true });
    }

    // Insert new snapshot
    let snapshot;
    const insertQuery = `
      INSERT INTO monthly_financial_snapshots (
        month_start, month_end, mini_count, basic_count, unlimited_count,
        price_mini_cents, price_basic_cents, price_unlimited_cents,
        revenue_cents, created_by, server_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const result = await pool.query(insertQuery, [
      monthStart, monthEnd, counts.Mini, counts.Basic, counts.Unlimited,
      prices.price_mini_cents, prices.price_basic_cents, prices.price_unlimited_cents,
      revenue_cents, req.user.id, server_id_marker
    ]);
    snapshot = result.rows[0];

    console.log('Financial snapshot created:', snapshot.month_start, 'server_id:', server_id_marker || 'GLOBAL');
    return res.json({ msg: 'Snapshot created successfully', snapshot });
  } catch (err) {
    console.error('POST /financial/snapshot failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// Delete a monthly financial snapshot (ADMIN and SERVER_ADMIN only)
// DELETE /api/admin/financial/snapshot/:month (month format: YYYY-MM)
router.delete('/financial/snapshot/:month', authenticateToken, async (req, res) => {
  try {
    const role = req.user && req.user.role;
    if (role !== 'ADMIN' && role !== 'SERVER_ADMIN') {
      return res.status(403).json({ msg: 'Only ADMINs and SERVER_ADMIN can delete financial snapshots' });
    }

    const monthParam = req.params.month;
    const monthStart = new Date(monthParam + '-01');
    
    if (isNaN(monthStart.getTime())) {
      return res.status(400).json({ msg: 'Invalid month format. Use YYYY-MM' });
    }

    // Determine server filtering for SERVER_ADMIN
    let serverIdsFilter = null;
    if (role === 'SERVER_ADMIN') {
      const r = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [req.user.id]);
      serverIdsFilter = (r.rows || []).map(x => Number(x.server_id)).filter(x => !Number.isNaN(x));
      if (!serverIdsFilter.length) {
        return res.status(403).json({ msg: 'No servers assigned' });
      }
    }

    let result;
    if (serverIdsFilter) {
      // SERVER_ADMIN: delete snapshot for their first assigned server (marker)
      result = await pool.query(
        'DELETE FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id = $2 RETURNING id',
        [monthStart, serverIdsFilter[0]]
      );
    } else {
      // ADMIN: delete global snapshot (server_id IS NULL)
      result = await pool.query(
        'DELETE FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id IS NULL RETURNING id',
        [monthStart]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ msg: 'Snapshot not found' });
    }

    return res.json({ msg: 'Snapshot deleted successfully' });
  } catch (err) {
    console.error('DELETE /financial/snapshot failed:', err);
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

  // For 'general' and 'telegram', merge with existing data to preserve non-validated or secret fields
  // (e.g. botToken is masked on reads; omitting it from an update should keep the existing secret)
  const toStore = (key === 'general' || key === 'telegram') ? { ...(before || {}), ...cleaned } : cleaned;

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

    // Extra: if telegram bot enabled flag changed, write a compact audit row into telegram_login_notify_audit
    if (key === 'telegram') {
      try {
        const readEnabled = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          if (typeof obj.enabled !== 'undefined') return !!obj.enabled;
          if (typeof obj.botEnabled !== 'undefined') return !!obj.botEnabled;
          if (typeof obj.enabled_bot !== 'undefined') return !!obj.enabled_bot;
          return null;
        };
        const was = readEnabled(before);
        const now = readEnabled(after);
        if (was !== null && now !== null && was !== now) {
          const status = now ? 'bot_enabled' : 'bot_disabled';
          const payload = { before_enabled: !!was, after_enabled: !!now };
          await pool.query(
            'INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [null, req.user && req.user.id ? req.user.id : null, req.user && req.user.role ? req.user.role : null, req.user && req.user.username ? req.user.username : null, null, null, status, payload]
          );
        }
      } catch (e) {
        console.warn('Failed to write bot toggle audit:', e && e.message ? e.message : e);
      }
    }

    // If general settings were updated, refresh cache
    if (key === 'general') {
      try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
      // detect unexpected key drops and record a warning audit (best-effort)
      try { await warnIfKeyDrop(pool, 'general', before || {}, after || {}); } catch (_) {}
    }
    return res.json({ key, data: maskSecrets(key, after) });
  } catch (err) {
    console.error('PUT settings failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// Apply-now endpoint for Telegram bot: reload settings and re-apply without waiting for the timer
router.post('/settings/telegram/apply-now', authenticateToken, isAdmin, async (req, res) => {
  try {
    const bot = require('../telegram_bot');
    if (bot && typeof bot.applySettingsNow === 'function') {
      const info = await bot.applySettingsNow();
      return res.json({ ok: true, info });
    }
    // Fallback: if apply not available, try starting bot (which reloads settings) without erroring if already running
    if (bot && typeof bot.startTelegramBot === 'function') {
      try { await bot.startTelegramBot(); } catch (_) {}
      return res.json({ ok: true, info: { started: true } });
    }
    return res.status(500).json({ ok: false, msg: 'Bot module not available' });
  } catch (err) {
    console.error('apply-now failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, msg: 'Server Error' });
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
  const baseName = 'logo'; // Use consistent naming for easy persistence
  const outName1x = `${baseName}-70x70${ext}`;
  const outName2x = `${baseName}-140x140${ext}`;
    const outPath1x = path.join(logosPath, outName1x); // Store in logos directory
    const outPath2x = path.join(logosPath, outName2x);
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
    const logoUrl = `/logos/${outName1x}`; // Update URL to use logos path
    const logoUrl2x = fs.existsSync(outPath2x) ? `/logos/${outName2x}` : undefined;
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

    // Delete old logo/favicon files if they were differently-named (non-standard names)
    for (const oldKey of ['logo_url', 'logo_url_2x']) {
      const oldUrl = current[oldKey];
      if (oldUrl && oldUrl.startsWith('/logos/') && !['logo-70x70.png','logo-140x140.png'].includes(path.basename(oldUrl))) {
        try { const p = path.join(logosPath, path.basename(oldUrl)); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
      }
    }

  const origin = req.protocol + '://' + req.get('host');
  const absolute = logoUrl.startsWith('http') ? logoUrl : (origin + logoUrl);
  const absolute2x = logoUrl2x ? (logoUrl2x.startsWith('http') ? logoUrl2x : (origin + logoUrl2x)) : undefined;
  // refresh cache so public endpoint reflects new logo immediately
  try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
  return res.json({ ok: true, logo_url: logoUrl, logo_url_2x: logoUrl2x, url: absolute, url2x: absolute2x });
  } catch (err) {
    console.error('Upload general logo failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// ADMIN: Upload and set General favicon (stores URL under app_settings.general.favicon_url)
// Accept common favicon image types; generate a 32x32 PNG for broad compatibility
router.post('/settings/general/favicon', authenticateToken, isAdmin, upload.single('favicon'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });
    const allowed = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'image/jpeg', 'image/webp'];
    if (req.file.mimetype && !allowed.includes(req.file.mimetype)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ msg: 'Unsupported file type' });
    }

    // Read existing general to capture previous favicon for cleanup
    const { rows } = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    const current = rows && rows[0] ? (rows[0].data || {}) : {};

    const inputPath = req.file.path;
    const baseName = 'favicon'; // Use consistent naming
    const outName32 = `${baseName}-32x32.png`;
    const outName180 = `${baseName}-180x180.png`;
    const outPath32 = path.join(logosPath, outName32); // Store in logos directory
    const outPath180 = path.join(logosPath, outName180);
    try {
      // Generate 180x180 (Apple touch icon) first for quality, then 32x32
      await sharp(inputPath)
        .resize(180, 180, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toFile(outPath180);
      await sharp(inputPath)
        .resize(32, 32, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toFile(outPath32);
      try { fs.unlinkSync(inputPath); } catch (_) {}
    } catch (e) {
      console.error('sharp resize (favicon multi-size) failed:', e && e.message ? e.message : e);
      // fallback: move original as 32x32 name (no resize) if 32x32 missing
      try { if (!fs.existsSync(outPath32)) fs.renameSync(inputPath, outPath32); } catch (_) {}
    }

    const faviconUrl = `/logos/${outName32}`; // Update URL to use logos path
    const touchUrl = fs.existsSync(outPath180) ? `/logos/${outName180}` : undefined;
    const next = { ...current, favicon_url: faviconUrl };
    if (touchUrl) next.apple_touch_icon_url = touchUrl; else delete next.apple_touch_icon_url;
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
        [req.user && req.user.id ? req.user.id : null, 'general', 'UPDATE_FAVICON', maskSecrets('general', current), maskSecrets('general', next)]
      );
    } catch (_) {}

    // Delete old favicon files if they were differently-named (non-standard names)
    for (const oldKey of ['favicon_url', 'apple_touch_icon_url']) {
      const oldUrl = current[oldKey];
      if (oldUrl && oldUrl.startsWith('/logos/') && !['favicon-32x32.png','favicon-180x180.png'].includes(path.basename(oldUrl))) {
        try { const p = path.join(logosPath, path.basename(oldUrl)); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
      }
    }

    const origin = req.protocol + '://' + req.get('host');
    const absolute = faviconUrl.startsWith('http') ? faviconUrl : (origin + faviconUrl);
    const absoluteTouch = touchUrl ? (touchUrl.startsWith('http') ? touchUrl : (origin + touchUrl)) : undefined;
    // refresh cache so public endpoint reflects new favicon immediately
    try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
    return res.json({ ok: true, favicon_url: faviconUrl, apple_touch_icon_url: touchUrl, url: absolute, url_touch: absoluteTouch });
  } catch (err) {
    console.error('Upload general favicon failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// ADMIN: Clear General favicon (delete file and remove from app_settings)
router.delete('/settings/general/favicon', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    const current = rows && rows[0] ? (rows[0].data || {}) : {};
    const oldUrl = current && current.favicon_url;
    const oldTouch = current && current.apple_touch_icon_url;
    const next = { ...current };
    delete next.favicon_url;
    delete next.apple_touch_icon_url;
    await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      ['general', next, req.user && req.user.id ? req.user.id : null]
    );
    try {
      if (oldUrl && typeof oldUrl === 'string' && oldUrl.startsWith('/uploads/')) {
        const p = path.join(uploadsPath, path.basename(oldUrl));
        if (fs.existsSync(p) && path.dirname(p) === uploadsPath) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
      }
      if (oldTouch && typeof oldTouch === 'string' && oldTouch.startsWith('/uploads/')) {
        const p2 = path.join(uploadsPath, path.basename(oldTouch));
        if (fs.existsSync(p2) && path.dirname(p2) === uploadsPath) {
          try { fs.unlinkSync(p2); } catch (_) {}
        }
      }
    } catch (_) {}
    try {
      await pool.query(
        'INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)',
        [req.user && req.user.id ? req.user.id : null, 'general', 'CLEAR_FAVICON', maskSecrets('general', current), maskSecrets('general', next)]
      );
    } catch (_) {}
    try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
    return res.json({ ok: true });
  } catch (err) {
    console.error('Clear general favicon failed:', err && err.stack ? err.stack : err);
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
    // refresh cache so public endpoint reflects cleared logo immediately
    try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
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

// POST reveal telegram token (admin only, requires password confirmation)
router.post('/settings/telegram/reveal', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') return res.status(400).json({ msg: 'password is required' });
    // fetch current admin password hash
    const adminId = req.user && req.user.id ? req.user.id : null;
    const pwRes = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [adminId]);
    if (!pwRes.rows || pwRes.rows.length === 0) return res.status(404).json({ msg: 'Admin account not found' });
    const hash = pwRes.rows[0].password_hash;
    const match = await bcrypt.compare(password, hash);
    if (!match) return res.status(403).json({ msg: 'Password incorrect' });

    // fetch telegram settings and return raw token only for this request
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram'");
    const data = r.rows && r.rows[0] ? r.rows[0].data : {};

    // record an auditable reveal action (don't store the token in audit)
    try {
      await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [adminId, 'telegram', 'REVEAL', null, null]);
    } catch (auditErr) {
      console.warn('Failed to write reveal audit:', auditErr && auditErr.message ? auditErr.message : auditErr);
    }

    return res.json({ ok: true, botToken: data && data.botToken ? data.botToken : null });
  } catch (err) {
    console.error('POST /settings/telegram/reveal failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
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
      if (req.file) {
        if (req.file.buffer) return JSON.parse(req.file.buffer.toString('utf8'));
        if (req.file.path) {
          try {
            const content = fs.readFileSync(req.file.path);
            return JSON.parse(content.toString('utf8'));
          } catch (e) {
            // fallthrough to body
          }
        }
      }
      return req.body && typeof req.body === 'object' ? req.body : null;
    } catch (e) { return null; }
  };
  const data = parseBody();
  // cleanup uploaded temp file if multer saved it to disk
  try { if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} } } catch(_) {}
  if (!data || data.type !== 'config-backup-v1') return res.status(400).json({ msg: 'Invalid config backup format' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // restore app_settings (masked values are just for view; rely on provided data if secrets present)
    if (Array.isArray(data.app_settings)) {
      for (const s of data.app_settings) {
        const key = s.settings_key;
        const incoming = s.data || {};
        const curRes = await client.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
        const current = curRes.rows && curRes.rows[0] ? (curRes.rows[0].data || {}) : {};
        const toStore = safeMergeSettings(key, current, incoming);
        await client.query(
          `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
           VALUES ($1,$2,$3, now())
           ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, toStore, req.user && req.user.id ? req.user.id : null]
        );
        // audit
        try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', maskSecrets(key, current), maskSecrets(key, toStore)]); } catch (_) {}
        // key-drop warning (best-effort)
        try { await warnIfKeyDrop(client, key, current, toStore); } catch (_) {}
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
  // refresh general settings cache after restore
  try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
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
    const servers = await pool.query('SELECT id, server_name, ip_address, domain_name, owner, service_type, api_key, display_pos, created_at FROM servers ORDER BY id');
    // permissions tables: prefer new name, fallback to legacy
    let viewerPerms = [];
    try { const r = await pool.query('SELECT editor_id, server_id FROM viewer_server_permissions'); viewerPerms = r.rows || []; }
    catch (e) { try { const r2 = await pool.query('SELECT editor_id, server_id FROM editor_server_permissions'); viewerPerms = r2.rows || []; } catch (_) {} }
    const serverAdmins = await pool.query('SELECT admin_id, server_id FROM server_admin_permissions');
    const settings = await pool.query('SELECT settings_key, data, updated_at FROM app_settings ORDER BY settings_key');
    const serverKeys = await pool.query('SELECT id, server_id, username, description, original_key, generated_key, created_at FROM server_keys ORDER BY id');
    const users = await pool.query('SELECT id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, enabled, created_at FROM users ORDER BY id');
    let domainsRows = [];
    try { const dr = await pool.query('SELECT id, domain, server, service, unlimited, created_at, updated_at FROM domains ORDER BY id'); domainsRows = dr.rows || []; } catch (_) {}
    const keyserverConfig = loadKeyserverConfig();
    const payload = {
      type: 'db-backup-v1',
      createdAt: new Date().toISOString(),
      admins: admins.rows || [],
      servers: servers.rows || [],
      server_keys: serverKeys.rows || [],
      users: (users.rows || []).map(u => ({
        ...u,
        expire_date: u.expire_date ? fixExpireDate(u.expire_date instanceof Date ? u.expire_date.toISOString() : String(u.expire_date)) : null
      })),
      viewer_server_permissions: viewerPerms,
      server_admin_permissions: serverAdmins.rows || [],
      app_settings: (settings.rows || []).map(r => ({ settings_key: r.settings_key, data: maskSecrets(r.settings_key, r.data), updated_at: r.updated_at })),
      domains: domainsRows,
      keyserver_config: keyserverConfig || null,
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

// GET unified snapshot compatible with Telegram bot backup (cmp-backup-*.json)
// Shape: { created_at, app_settings: [...], servers: [...], users: [...] }
router.get('/backup/snapshot', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Optional: record a backup audit if ?record=1
    try {
      if (String(req.query.record || '') === '1') {
        await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, 'backup', 'BACKUP', null, null]);
      }
    } catch (_) {}
    const [settingsRes, serversRes, serverKeysRes, usersRes, domainsRes, snapshotsRes] = await Promise.all([
      pool.query('SELECT * FROM app_settings'),
      pool.query('SELECT id, server_name, ip_address, domain_name, owner, service_type, api_key, display_pos, created_at FROM servers'),
      pool.query('SELECT id, server_id, username, description, original_key, generated_key, created_at FROM server_keys'),
      pool.query('SELECT id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, enabled, created_at FROM users'),
      pool.query('SELECT id, domain, server, service, unlimited, created_at, updated_at FROM domains').catch(() => ({ rows: [] })),
      pool.query('SELECT id, month_start::text as month_start, month_end::text as month_end, server_id, mini_count, basic_count, unlimited_count, price_mini_cents, price_basic_cents, price_unlimited_cents, revenue_cents, created_at, created_by, notes FROM monthly_financial_snapshots ORDER BY month_start ASC').catch(() => ({ rows: [] }))
    ]);
    const keyserverConfig = loadKeyserverConfig();
    const payload = {
      created_at: new Date().toISOString(),
      app_settings: settingsRes.rows || [],
      servers: serversRes.rows || [],
      server_keys: serverKeysRes.rows || [],
      users: (usersRes.rows || []).map(u => ({
        ...u,
        expire_date: u.expire_date ? fixExpireDate(u.expire_date instanceof Date ? u.expire_date.toISOString() : String(u.expire_date)) : null
      })),
      domains: domainsRes.rows || [],
      financial_snapshots: snapshotsRes.rows || [],
      keyserver_config: keyserverConfig || null
    };
    const json = JSON.stringify(payload, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${tsName('cmp-backup', 'json')}"`);
    return res.send(json);
  } catch (err) {
    console.error('backup snapshot failed:', err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// POST restore snapshot compatible with Telegram bot backup (cmp-backup-*.json)
// Merge-only, safe subset. Accepts multipart upload (file) or raw JSON body.
router.post('/restore/snapshot', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
  const tmpUploadPath = req.file && req.file.path ? req.file.path : null;
  try {
    // Parse JSON from uploaded file or body
    let data = null;
    try {
      if (req.file) {
        try {
          if (req.file.buffer) data = JSON.parse(req.file.buffer.toString('utf8'));
          else if (req.file.path) data = JSON.parse(fs.readFileSync(req.file.path).toString('utf8'));
        } catch (e) {
          return res.status(400).json({ msg: 'Invalid JSON' });
        }
      } else if (req.body && typeof req.body === 'object') {
        data = req.body;
      }
    } catch (e) {
      return res.status(400).json({ msg: 'Invalid JSON' });
    }

    if (!data || (!Array.isArray(data.app_settings) && !Array.isArray(data.servers) && !Array.isArray(data.server_keys) && !Array.isArray(data.users) && !Array.isArray(data.admins))) {
      return res.status(400).json({ msg: 'Invalid snapshot format' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
    
    // OVERWRITE MODE: Delete existing data first, then insert fresh data
    // Delete in correct order to respect foreign key constraints
    console.log('Snapshot restore: clearing existing data (overwrite mode)...');
    
    // Delete users first (depends on servers via server_id)
    if (Array.isArray(data.users) && data.users.length > 0) {
      await client.query('DELETE FROM users');
      console.log('Deleted all users');
    }
    
    // Delete server_keys (depends on servers via server_id)
    if (Array.isArray(data.server_keys) && data.server_keys.length > 0) {
      await client.query('DELETE FROM server_keys');
      console.log('Deleted all server_keys');
    }
    
    // Delete viewer/editor permissions
    try {
      await client.query('DELETE FROM viewer_server_permissions');
      console.log('Deleted all viewer_server_permissions');
    } catch (e) {
      // Table might not exist or be named differently
      try {
        await client.query('DELETE FROM editor_server_permissions');
      } catch (_) {}
    }
    
    // Delete server admin permissions
    try {
      await client.query('DELETE FROM server_admin_permissions');
      console.log('Deleted all server_admin_permissions');
    } catch (_) {}
    
    // Delete servers
    if (Array.isArray(data.servers) && data.servers.length > 0) {
      await client.query('DELETE FROM servers');
      console.log('Deleted all servers');
    }
    
    console.log('Starting data insertion...');
    
    // app_settings: Still use merge for safety (critical system settings)
    if (Array.isArray(data.app_settings)) {
      for (const s of data.app_settings) {
        const key = s.settings_key || s.key || s.settingsKey;
        if (!key) continue;
        const incoming = s.data || {};
        const curRes = await client.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
        const current = curRes.rows && curRes.rows[0] ? (curRes.rows[0].data || {}) : {};
        const toStore = safeMergeSettings(key, current, incoming);
        await client.query(
          `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
           VALUES ($1,$2,$3, now())
           ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, toStore, req.user && req.user.id ? req.user.id : null]
        );
        try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', maskSecrets(key, current), maskSecrets(key, toStore)]); } catch (_) {}
        try { await warnIfKeyDrop(client, key, current, toStore); } catch (_) {}
      }
    }
    
    // servers: Direct insert (tables cleared above)
    if (Array.isArray(data.servers)) {
      for (const s of data.servers) {
        const name = s.server_name || s.name;
        if (!name) continue;
        await client.query(
          `INSERT INTO servers (id, server_name, ip_address, domain_name, owner, service_type, api_key, display_pos, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, now()))`,
          [s.id || null, name, s.ip_address || null, s.domain_name || null, s.owner || null, s.service_type || null, s.api_key || null, s.display_pos || null, s.created_at || null]
        );
      }
    }
    
    // server_keys: Direct insert
    if (Array.isArray(data.server_keys)) {
      for (const k of data.server_keys) {
        if (!k.server_id) continue;
        await client.query(
          `INSERT INTO server_keys (id, server_id, username, description, original_key, generated_key, created_at)
           VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()))`,
          [k.id || null, k.server_id, k.username || null, k.description || null, k.original_key || null, k.generated_key || null, k.created_at || null]
        );
      }
    }
    
    // users: Direct insert (no conflict handling needed since table is cleared)
    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (!u.server_id || !u.account_name) continue;
        await client.query(
          `INSERT INTO users (id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, enabled, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, now()))`,
          [u.id || null, u.server_id, u.account_name, u.service_type || null, u.contact || null, fixExpireDate(u.expire_date) || null, u.total_devices || null, u.data_limit_gb || null, u.remark || null, u.display_pos || null, typeof u.enabled === 'boolean' ? u.enabled : true, u.created_at || null]
        );
      }
    }
    
    // admins: Merge avatar data only (preserve passwords and other security data)
    // Only restore avatar_url and avatar_data for existing admins matching by username
    if (Array.isArray(data.admins)) {
      for (const a of data.admins) {
        if (!a.username) continue;
        try {
          await client.query(
            `UPDATE admins SET avatar_url = $1, avatar_data = $2 WHERE username = $3`,
            [a.avatar_url || null, a.avatar_data || null, a.username]
          );
        } catch (e) {
          console.warn(`Could not restore avatar for admin ${a.username}:`, e.message);
        }
      }
    }
    
    // domains: Overwrite existing domains with backup data
    if (Array.isArray(data.domains) && data.domains.length > 0) {
      try {
        await client.query('DELETE FROM domains');
        console.log('Deleted all domains');
        for (const d of data.domains) {
          if (!d.domain) continue;
          await client.query(
            `INSERT INTO domains (id, domain, server, service, unlimited, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), COALESCE($7, now()))`,
            [d.id || null, d.domain, d.server || '', d.service || 'Basic', typeof d.unlimited === 'boolean' ? d.unlimited : false, d.created_at || null, d.updated_at || null]
          );
        }
      } catch (e) {
        console.warn('Could not restore domains:', e.message);
      }
    }

    // keyserver config: Restore from backup if present
    if (data.keyserver_config && typeof data.keyserver_config === 'object') {
      try {
        saveKeyserverConfig(data.keyserver_config);
        console.log('Restored keyserver config');
      } catch (e) {
        console.warn('Could not restore keyserver config:', e.message);
      }
    }

    // financial_snapshots: DELETE existing for each month/server in backup, then INSERT.
    // Uses SAVEPOINT per row so one failure never aborts the whole transaction.
    // Dates in backup may be 'YYYY-MM-DD' (new) or full ISO timestamp (old) — handle both.
    const parseDateToFirstOfMonth = (raw) => {
      if (!raw) return null;
      const s = String(raw);
      // Already plain date string YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        // Ensure it is the first of the month (column CHECK constraint requires this)
        return s.slice(0, 7) + '-01';
      }
      // Full ISO timestamp like '2025-09-30T17:30:00.000Z' — timezone shifted.
      // Extract year-month from the UTC string and reconstruct first-of-month.
      // But the stored date was originally first-of-month in local time (+6:30),
      // so UTC shows the previous day. Add 7 hours to recover local date reliably.
      const d = new Date(new Date(s).getTime() + 7 * 60 * 60 * 1000);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${year}-${month}-01`;
    };
    let snapshotCount = 0;
    if (Array.isArray(data.financial_snapshots)) {
      for (const s of data.financial_snapshots) {
        if (!s.month_start) continue;
        const monthStartVal = parseDateToFirstOfMonth(s.month_start);
        if (!monthStartVal) continue;
        const monthEndVal = (() => {
          if (!s.month_end) return null;
          const raw = String(s.month_end);
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
          // ISO timestamp for month_end — last day of month; just extract date portion + 7h shift
          const d = new Date(new Date(raw).getTime() + 7 * 60 * 60 * 1000);
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        })();
        const serverId = s.server_id != null && s.server_id !== '' ? Number(s.server_id) : null;
        try {
          await client.query(`SAVEPOINT snap_restore`);
          // Delete existing so backup data always wins
          if (serverId != null) {
            await client.query(
              'DELETE FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id = $2',
              [monthStartVal, serverId]
            );
          } else {
            await client.query(
              'DELETE FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id IS NULL',
              [monthStartVal]
            );
          }
          // Plain INSERT — no conflict possible after DELETE
          await client.query(
            `INSERT INTO monthly_financial_snapshots
               (month_start, month_end, server_id, mini_count, basic_count, unlimited_count,
                price_mini_cents, price_basic_cents, price_unlimited_cents, revenue_cents, created_at, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,NOW()),$12)`,
            [
              monthStartVal, monthEndVal,
              serverId,
              Number(s.mini_count || 0), Number(s.basic_count || 0), Number(s.unlimited_count || 0),
              Number(s.price_mini_cents || 0), Number(s.price_basic_cents || 0), Number(s.price_unlimited_cents || 0),
              Number(s.revenue_cents || 0),
              s.created_at || null,
              s.notes || null
            ]
          );
          await client.query(`RELEASE SAVEPOINT snap_restore`);
          snapshotCount++;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT snap_restore`).catch(() => {});
          console.warn('Could not restore financial snapshot for', monthStartVal, ':', e.message);
        }
      }
      console.log(`Restored ${snapshotCount} financial snapshots (backup data overwrote target)`);
    }
    
    await client.query('COMMIT');
    // refresh general settings cache after snapshot restore
    try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
    return res.json({ msg: 'Snapshot restored (overwrite)', counts: {
      settings: Array.isArray(data.app_settings) ? data.app_settings.length : 0,
      servers: Array.isArray(data.servers) ? data.servers.length : 0,
      server_keys: Array.isArray(data.server_keys) ? data.server_keys.length : 0,
      users: Array.isArray(data.users) ? data.users.length : 0,
      admins_avatars_restored: Array.isArray(data.admins) ? data.admins.length : 0,
      domains: Array.isArray(data.domains) ? data.domains.length : 0,
      financial_snapshots: snapshotCount,
      keyserver_config: data.keyserver_config ? true : false,
    }});
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('restore snapshot failed:', err && err.stack ? err.stack : err);
      return res.status(500).json({ msg: 'Failed to restore snapshot' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('restore snapshot outer failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  } finally {
    // best-effort cleanup of uploaded file on disk
    if (tmpUploadPath) {
      try { if (fs.existsSync(tmpUploadPath)) fs.unlinkSync(tmpUploadPath); } catch (e) { console.warn('Failed to unlink uploaded snapshot temp file:', tmpUploadPath, e && e.message ? e.message : e); }
    }
  }
});

// POST restore DB (.db) — merge only, safe subset
router.post('/restore/db', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
  const tmpUploadPath = req.file && req.file.path ? req.file.path : null;
  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });
    if (req.file.size > 5 * 1024 * 1024) return res.status(413).json({ msg: 'File too large' });
    let payload;
    let buf = null;
    try {
        if (req.file.buffer) buf = req.file.buffer;
        else if (req.file.path) buf = fs.readFileSync(req.file.path);
        else return res.status(400).json({ msg: 'No file data' });
        payload = JSON.parse(buf.toString('utf8'));
    } catch (e) { return res.status(400).json({ msg: 'Invalid .db file (must be JSON)' }); }
    if (!payload || payload.type !== 'db-backup-v1') return res.status(400).json({ msg: 'Unsupported .db format' });
    // optional checksum verification if client provided x-checksum-sha256 header (hex)
    try {
      const provided = (req.headers['x-checksum-sha256'] || '').toString().trim().toLowerCase();
      if (provided) {
        const crypto = require('crypto');
        const actual = crypto.createHash('sha256').update(buf).digest('hex');
        if (provided !== actual) return res.status(400).json({ msg: 'Checksum mismatch' });
      }
    } catch (_) {}
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // OVERWRITE MODE: Delete existing data first
      console.log('DB restore: clearing existing data (overwrite mode)...');
      
      // Delete users first (foreign key dependency)
      if (Array.isArray(payload.users) && payload.users.length > 0) {
        await client.query('DELETE FROM users');
        console.log('Deleted all users');
      }
      
      // Delete server_keys
      if (Array.isArray(payload.server_keys) && payload.server_keys.length > 0) {
        await client.query('DELETE FROM server_keys');
        console.log('Deleted all server_keys');
      }
      
      // Delete permissions
      if (Array.isArray(payload.viewer_server_permissions)) {
        try {
          await client.query('DELETE FROM viewer_server_permissions');
        } catch (e) {
          try { await client.query('DELETE FROM editor_server_permissions'); } catch (_) {}
        }
      }
      if (Array.isArray(payload.server_admin_permissions)) {
        try {
          await client.query('DELETE FROM server_admin_permissions');
        } catch (_) {}
      }
      
      // Delete servers
      if (Array.isArray(payload.servers) && payload.servers.length > 0) {
        await client.query('DELETE FROM servers');
        console.log('Deleted all servers');
      }
      
      console.log('Starting data insertion...');
      
      // servers: Direct insert (no conflicts after delete)
      if (Array.isArray(payload.servers)) {
        for (const s of payload.servers) {
          const name = s.server_name || s.name;
          if (!name) continue;
          await client.query(
            `INSERT INTO servers (id, server_name, ip_address, domain_name, owner, service_type, api_key, display_pos, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()))`,
            [s.id || null, name, s.ip_address || null, s.domain_name || null, s.owner || null, s.service_type || null, s.api_key || null, s.display_pos || null, s.created_at || null]
          );
        }
      }
      
      // server_keys: Direct insert
      if (Array.isArray(payload.server_keys)) {
        for (const k of payload.server_keys) {
          if (!k.server_id) continue;
          await client.query(
            `INSERT INTO server_keys (id, server_id, username, description, original_key, generated_key, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))`,
            [k.id || null, k.server_id, k.username || null, k.description || null, k.original_key || null, k.generated_key || null, k.created_at || null]
          );
        }
      }
      // users: Direct insert
      if (Array.isArray(payload.users)) {
        for (const u of payload.users) {
          if (!u.server_id || !u.account_name) continue;
          await client.query(
            `INSERT INTO users (id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, enabled, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now()))`,
            [u.id || null, u.server_id, u.account_name, u.service_type || null, u.contact || null, fixExpireDate(u.expire_date) || null, u.total_devices || null, u.data_limit_gb || null, u.remark || null, u.display_pos || null, typeof u.enabled === 'boolean' ? u.enabled : true, u.created_at || null]
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
          const incoming = s.data || {};
          const curRes = await client.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
          const current = curRes.rows && curRes.rows[0] ? (curRes.rows[0].data || {}) : {};
          const toStore = safeMergeSettings(key, current, incoming);
          await client.query(
            `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
             VALUES ($1,$2,$3, now())
             ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [key, toStore, req.user && req.user.id ? req.user.id : null]
          );
          try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', maskSecrets(key, current), maskSecrets(key, toStore)]); } catch (_) {}
          try { await warnIfKeyDrop(client, key, current, toStore); } catch (_) {}
        }
      }
      // permissions: Direct insert
      if (Array.isArray(payload.viewer_server_permissions)) {
        for (const p of payload.viewer_server_permissions) {
          await client.query(
            `INSERT INTO viewer_server_permissions (editor_id, server_id) VALUES ($1,$2)`,
            [p.editor_id, p.server_id]
          );
        }
      }
      if (Array.isArray(payload.server_admin_permissions)) {
        for (const p of payload.server_admin_permissions) {
          await client.query(
            `INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ($1,$2)`,
            [p.admin_id, p.server_id]
          );
        }
      }
      // domains: Overwrite existing domains with backup data
      if (Array.isArray(payload.domains) && payload.domains.length > 0) {
        try {
          await client.query('DELETE FROM domains');
          console.log('Deleted all domains');
          for (const d of payload.domains) {
            if (!d.domain) continue;
            await client.query(
              `INSERT INTO domains (id, domain, server, service, unlimited, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), COALESCE($7, now()))`,
              [d.id || null, d.domain, d.server || '', d.service || 'Basic', typeof d.unlimited === 'boolean' ? d.unlimited : false, d.created_at || null, d.updated_at || null]
            );
          }
        } catch (e) {
          console.warn('Could not restore domains:', e.message);
        }
      }
      // keyserver config: Restore from backup if present
      if (payload.keyserver_config && typeof payload.keyserver_config === 'object') {
        try {
          saveKeyserverConfig(payload.keyserver_config);
          console.log('Restored keyserver config');
        } catch (e) {
          console.warn('Could not restore keyserver config:', e.message);
        }
      }
      await client.query('COMMIT');
      // refresh general settings cache after DB restore
      try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
      return res.json({ msg: 'Database restored (overwrite)',
        counts: {
          servers: payload.servers ? payload.servers.length : 0,
          server_keys: payload.server_keys ? payload.server_keys.length : 0,
          users: payload.users ? payload.users.length : 0,
          admins: payload.admins ? payload.admins.length : 0,
          viewer_perms: payload.viewer_server_permissions ? payload.viewer_server_permissions.length : 0,
          server_admin_perms: payload.server_admin_permissions ? payload.server_admin_permissions.length : 0,
          settings: payload.app_settings ? payload.app_settings.length : 0,
          domains: payload.domains ? payload.domains.length : 0,
          keyserver_config: payload.keyserver_config ? true : false,
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
  const tmpUploadPath = req.file && req.file.path ? req.file.path : null;
  const parseBody = () => {
    try {
      if (req.file) {
        if (req.file.buffer) return JSON.parse(req.file.buffer.toString('utf8'));
        if (req.file.path) {
          try { const content = fs.readFileSync(req.file.path); return JSON.parse(content.toString('utf8')); } catch (e) { }
        }
      }
      return req.body && typeof req.body === 'object' ? req.body : null;
    } catch (e) { return null; }
  };
  try {
    if (req.file && req.file.size > 1024 * 1024) return res.status(413).json({ msg: 'File too large' });
    // optional checksum header (best-effort)
    try {
      if (req.file) {
        let bufForChecksum = null;
        if (req.file.buffer) bufForChecksum = req.file.buffer;
        else if (req.file.path) bufForChecksum = fs.readFileSync(req.file.path);
        const provided = (req.headers['x-checksum-sha256'] || '').toString().trim().toLowerCase();
        if (provided && bufForChecksum) {
          const crypto = require('crypto');
          const actual = crypto.createHash('sha256').update(bufForChecksum).digest('hex');
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
        const incoming = s.data || {};
        const curRes = await client.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
        const current = curRes.rows && curRes.rows[0] ? (curRes.rows[0].data || {}) : {};
        const toStore = safeMergeSettings(key, current, incoming);
        await client.query(
          `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
           VALUES ($1,$2,$3, now())
           ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, toStore, req.user && req.user.id ? req.user.id : null]
        );
        try { await client.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user && req.user.id ? req.user.id : null, key, 'UPDATE', maskSecrets(key, current), maskSecrets(key, toStore)]); } catch (_) {}
        try { await warnIfKeyDrop(client, key, current, toStore); } catch (_) {}
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
  // refresh general settings cache after restore (alt route)
  try { const settingsCache = require('../lib/settingsCache'); await settingsCache.loadGeneral(); } catch (_) {}
  return res.json({ msg: 'Config restored (merge)', admins: data.admins ? data.admins.length : 0, settings: data.app_settings ? data.app_settings.length : 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('restore config failed:', err);
    return res.status(500).json({ msg: 'Failed to restore config' });
  } finally {
    client.release();
  }
});

// ADMIN: Raw general settings and recent audit entries (admin only)
router.get('/settings/general/raw', authenticateToken, isAdmin, async (req, res) => {
  try {
    const cur = await pool.query("SELECT data, updated_at, updated_by FROM app_settings WHERE settings_key = 'general'");
    const audit = await pool.query("SELECT id, admin_id, action, created_at, after_data FROM settings_audit WHERE settings_key = 'general' ORDER BY created_at DESC LIMIT 5");
    return res.json({
      current: cur.rows && cur.rows[0] ? cur.rows[0] : null,
      recentAudit: audit.rows || []
    });
  } catch (err) {
    console.error('GET /settings/general/raw failed:', err && err.message ? err.message : err);
    return res.status(500).json({ msg: 'Server Error' });
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
// =============================
// Control Panel & System Ops (ADMIN only)
// =============================
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const fsp = require('fs').promises;

// Ensure control_panel_audit table exists (best-effort, lazy) without failing requests if migration not yet applied.
async function ensureControlAuditTable() {
  try {
    const r = await pool.query("SELECT to_regclass('public.control_panel_audit') AS reg");
    const exists = r.rows && r.rows[0] && r.rows[0].reg;
    if (!exists) {
      await pool.query("CREATE TABLE IF NOT EXISTS control_panel_audit (id serial primary key, admin_id int, action text, payload jsonb, created_at timestamptz default now())");
    }
  } catch (e) {
    // swallow
  }
}

async function writeControlAudit(adminId, action, payload) {
  try {
    await ensureControlAuditTable();
    await pool.query('INSERT INTO control_panel_audit (admin_id, action, payload) VALUES ($1,$2,$3)', [adminId || null, action, payload || null]);
  } catch (e) {
    console.warn('control audit write failed:', e && e.message ? e.message : e);
  }
}

// GET system status
// Removed /control/system/status endpoint per request (session/status UI removed)

// POST system restart (graceful)
// Removed /control/system/restart endpoint per request

// Certificate helpers
function readCertInfo(domain) {
  try {
    const live = `/etc/letsencrypt/live/${domain}`;
    const certPath = path.join(live, 'cert.pem');
    if (!fs.existsSync(certPath)) return null;
    const pem = fs.readFileSync(certPath, 'utf8');
    // Parse dates using openssl x509 if available
    let notBefore = null, notAfter = null, issuer = null;
    try {
      const nb = require('child_process').execSync(`openssl x509 -in '${certPath}' -noout -startdate`).toString().trim();
      const na = require('child_process').execSync(`openssl x509 -in '${certPath}' -noout -enddate`).toString().trim();
      const iss = require('child_process').execSync(`openssl x509 -in '${certPath}' -noout -issuer`).toString().trim();
      notBefore = nb.replace('notBefore=', '');
      notAfter = na.replace('notAfter=', '');
      issuer = iss.replace('issuer=', '');
    } catch(_) {}
    let daysRemaining = null;
    try {
      if (notAfter) {
        const exp = new Date(notAfter);
        daysRemaining = Math.floor((exp.getTime() - Date.now()) / (24*60*60*1000));
      }
    } catch(_) {}
    return { certPath, issuer, notBefore, notAfter, daysRemaining };
  } catch (e) { return null; }
}

router.get('/control/cert/status', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Pull domain from stored config first, fallback to env
    let domain = null;
    try {
      const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
      const data = r.rows && r.rows[0] ? (r.rows[0].data || {}) : {};
      if (data && typeof data.domain === 'string' && data.domain.trim()) domain = data.domain.trim();
    } catch (_) {}
    if (!domain) domain = process.env.DOMAIN_NAME || null;
    if (!domain) return res.json({ ok: true, domain: null, status: null });
    const info = readCertInfo(domain);
    await writeControlAudit(req.user && req.user.id, 'cert_status', { domain, found: !!info });
    return res.json({ ok: true, domain, cert: info });
  } catch (e) { return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'cert status failed' }); }
});

function runCmd(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

router.post('/control/cert/issue', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Prefer body > stored app_settings > env
    const body = req.body || {};
    let domain = typeof body.domain === 'string' && body.domain.trim() ? body.domain.trim() : null;
    let email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
    let apiToken = typeof body.api_token === 'string' && body.api_token.trim() ? body.api_token.trim() : null;
    if (!domain || !email || !apiToken) {
      try {
        const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
        const data = r.rows && r.rows[0] ? (r.rows[0].data || {}) : {};
        if (!domain && data.domain) domain = data.domain;
        if (!email && data.email) email = data.email;
        if (!apiToken && (data.api_token || data.cloudflare_api_token)) apiToken = data.api_token || data.cloudflare_api_token;
      } catch (_) {}
    }
    if (!domain) domain = process.env.DOMAIN_NAME;
    if (!email) email = process.env.LETSENCRYPT_EMAIL;
    if (!apiToken) apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!domain || !email || !apiToken) return res.status(400).json({ ok: false, msg: 'domain, email, and api_token are required (in body or stored config or env)' });
    const credsFile = '/root/.cloudflare.ini';
    // ensure credentials file exists with secure perms
    try {
      await fsp.writeFile(credsFile, `dns_cloudflare_api_token = ${apiToken}\n`, { encoding: 'utf8' });
      try { await fsp.chmod(credsFile, 0o600); } catch(_) {}
    } catch (e) {
      console.warn('Failed to write Cloudflare credentials file:', e && e.message ? e.message : e);
    }
    await writeControlAudit(req.user && req.user.id, 'cert_issue', { domain });
    const cmd = `certbot certonly --dns-cloudflare --dns-cloudflare-credentials ${credsFile} -d ${domain} -m ${email} --agree-tos --non-interactive --preferred-challenges dns`;
    try {
      const { stdout, stderr } = await runCmd(cmd, process.cwd());
      return res.json({ ok: true, stdout: stdout.slice(0,8000), stderr: stderr.slice(0,8000) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.err && e.err.message ? e.err.message : 'issue failed', stderr: e.stderr && e.stderr.slice ? e.stderr.slice(0,8000) : null });
    }
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'cert issue failed' }); }
});

router.post('/control/cert/renew', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Attempt to ensure credentials file exists from stored config before renew
    try {
      const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
      const data = r.rows && r.rows[0] ? (r.rows[0].data || {}) : {};
      const tok = data.api_token || data.cloudflare_api_token || process.env.CLOUDFLARE_API_TOKEN || null;
      if (tok) {
        try { await fsp.writeFile('/root/.cloudflare.ini', `dns_cloudflare_api_token = ${tok}\n`, { encoding: 'utf8' }); try { await fsp.chmod('/root/.cloudflare.ini', 0o600); } catch(_) {} } catch(_) {}
      }
    } catch (_) {}
    let domain = null;
    try {
      const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
      domain = r.rows && r.rows[0] && r.rows[0].data && r.rows[0].data.domain ? r.rows[0].data.domain : null;
    } catch (_) {}
    if (!domain) domain = process.env.DOMAIN_NAME || null;
    await writeControlAudit(req.user && req.user.id, 'cert_renew', { domain });
    try {
      const { stdout, stderr } = await runCmd('certbot renew --quiet', process.cwd());
      return res.json({ ok: true, stdout: stdout.slice(0,4000), stderr: stderr.slice(0,4000) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.err && e.err.message ? e.err.message : 'renew failed', stderr: e.stderr && e.stderr.slice ? e.stderr.slice(0,4000) : null });
    }
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'cert renew failed' }); }
});

// --- Service Port configuration ---
// GET configured service port and current runtime port
// Removed /control/system/port endpoint per request

// PUT update configured service port (applies on next restart)
// Removed PUT /control/system/port endpoint per request

// GET/PUT certificate configuration (domain, email, api_token)
router.get('/control/cert/config', authenticateToken, isAdmin, async (req, res) => {
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
    const data = r.rows && r.rows[0] ? (r.rows[0].data || {}) : {};
    const out = {
      domain: data.domain || process.env.DOMAIN_NAME || '',
      email: data.email || process.env.LETSENCRYPT_EMAIL || '',
      api_token: data.api_token ? '********' : (process.env.CLOUDFLARE_API_TOKEN ? '********' : '')
    };
    return res.json({ ok: true, config: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'cert config read failed' });
  }
});

router.put('/control/cert/config', authenticateToken, isAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const api_token_raw = typeof body.api_token === 'string' ? body.api_token.trim() : '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
      const current = cur.rows && cur.rows[0] ? (cur.rows[0].data || {}) : {};
      const next = { ...current };
      if (domain) next.domain = domain;
      if (email) next.email = email;
      if (api_token_raw && api_token_raw !== '********') next.api_token = api_token_raw;
      await client.query(
        `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
         VALUES ($1,$2,$3, now())
         ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        ['cert', next, req.user && req.user.id ? req.user.id : null]
      );
      await client.query('COMMIT');
      // Best-effort: write credentials file if api_token present
      try {
        const tok = next.api_token || null;
        if (tok) { await fsp.writeFile('/root/.cloudflare.ini', `dns_cloudflare_api_token = ${tok}\n`, { encoding: 'utf8' }); try { await fsp.chmod('/root/.cloudflare.ini', 0o600); } catch(_) {} }
      } catch (_) {}
      await writeControlAudit(req.user && req.user.id, 'cert_config_update', { domain: next.domain || null, email: next.email || null, has_token: !!next.api_token });
      return res.json({ ok: true });
    } catch (tx) {
      try { await client.query('ROLLBACK'); } catch(_) {}
      throw tx;
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'cert config update failed' });
  }
});

// POST /control/cert/install — SSE: save config + issue cert (certbot) + configure nginx
router.post('/control/cert/install', authenticateToken, isAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (type, text) => {
    try { res.write(`data: ${JSON.stringify({ type, text })}\n\n`); if (res.flush) res.flush(); } catch (_) {}
  };
  const finish = (code) => {
    try { res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`); res.end(); } catch (_) {}
  };

  try {
    const body = req.body || {};
    let domain = typeof body.domain === 'string' ? body.domain.trim() : '';
    let email = typeof body.email === 'string' ? body.email.trim() : '';
    let apiToken = typeof body.api_token === 'string' ? body.api_token.trim() : '';

    // Load stored config for any missing fields
    try {
      const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
      const data = r.rows && r.rows[0] ? (r.rows[0].data || {}) : {};
      if (!domain && data.domain) domain = data.domain;
      if (!email && data.email) email = data.email;
      if ((!apiToken || apiToken === '********') && (data.api_token || data.cloudflare_api_token)) apiToken = data.api_token || data.cloudflare_api_token;
    } catch (_) {}

    if (!domain) { send('error', 'ERROR: Domain is required'); finish(1); return; }
    if (!email) { send('error', 'ERROR: Email is required'); finish(1); return; }

    // ── Step 1: Save config ────────────────────────────────────────────────
    send('info', '→ Saving certificate configuration...');
    try {
      const cur = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'cert'");
      const current = cur.rows && cur.rows[0] ? (cur.rows[0].data || {}) : {};
      const next = { ...current };
      next.domain = domain;
      next.email = email;
      if (apiToken && apiToken !== '********') next.api_token = apiToken;
      await pool.query(
        `INSERT INTO app_settings (settings_key, data, updated_by, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (settings_key) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        ['cert', next, req.user && req.user.id ? req.user.id : null]
      );
      if (next.api_token) {
        try {
          await fsp.writeFile('/root/.cloudflare.ini', `dns_cloudflare_api_token = ${next.api_token}\n`, { encoding: 'utf8' });
          await fsp.chmod('/root/.cloudflare.ini', 0o600);
        } catch (e) { send('warn', `  Warning: could not write Cloudflare credentials: ${e.message}`); }
      }
      send('info', '  ✓ Configuration saved');
    } catch (e) { send('error', `  ERROR saving config: ${e.message}`); finish(1); return; }

    // ── Step 2: Issue certificate ──────────────────────────────────────────
    send('info', `→ Requesting Let's Encrypt certificate for ${domain}...`);
    const credsFile = '/root/.cloudflare.ini';
    const existingCert = readCertInfo(domain);
    if (existingCert && existingCert.daysRemaining > 30) {
      send('info', `  ✓ Valid certificate already present (${existingCert.daysRemaining} days remaining)`);
    } else {
      let certOk = false;
      try {
        // DNS-01 via Cloudflare
        const cmd = `certbot certonly --dns-cloudflare --dns-cloudflare-credentials ${credsFile} -d ${domain} -m ${email} --agree-tos --non-interactive --preferred-challenges dns`;
        const { stdout, stderr } = await runCmd(cmd, process.cwd());
        stdout.split('\n').filter(Boolean).forEach(l => send('info', `  ${l}`));
        stderr.split('\n').filter(Boolean).forEach(l => send('info', `  ${l}`));
        certOk = true;
        send('info', '  ✓ Certificate issued (DNS-01)');
      } catch (e) {
        send('warn', `  DNS-01 failed: ${e.err && e.err.message ? e.err.message : 'unknown'}`);
        if (e.stderr) e.stderr.split('\n').filter(Boolean).slice(0, 8).forEach(l => send('warn', `    ${l}`));
        send('warn', '  Trying HTTP-01 standalone fallback...');
        try {
          const cmd2 = `certbot certonly --standalone -d ${domain} -m ${email} --preferred-challenges http --agree-tos --non-interactive`;
          const { stdout: so } = await runCmd(cmd2, process.cwd());
          so.split('\n').filter(Boolean).forEach(l => send('info', `  ${l}`));
          certOk = true;
          send('info', '  ✓ Certificate issued (HTTP-01)');
        } catch (e2) {
          send('warn', `  HTTP-01 also failed: ${e2.err && e2.err.message ? e2.err.message : e2.message || 'unknown'}`);
          if (e2.stderr) e2.stderr.split('\n').filter(Boolean).slice(0, 8).forEach(l => send('warn', `    ${l}`));
          send('warn', '  Proceeding without certificate — configure manually if needed');
        }
      }
      if (!certOk) send('warn', '  Certificate not issued; nginx will be configured for HTTP only');
    }

    // ── Step 3: Configure nginx ────────────────────────────────────────────
    send('info', '→ Configuring nginx...');
    let nginxAvail = false;
    try { await runCmd('which nginx', process.cwd()); nginxAvail = true; } catch (_) {}
    if (!nginxAvail) {
      send('warn', '  nginx not found — skipping nginx configuration');
      await writeControlAudit(req.user && req.user.id, 'cert_install', { domain, nginxSkipped: true });
      send('info', ''); send('info', `=== Installation complete for ${domain} ===`);
      finish(0); return;
    }

    const backendPort = process.env.PORT || 3000;
    const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
    let certExists = false;
    try { await fsp.access(certPath); certExists = true; } catch (_) {}

    const nginxConf = certExists
      ? `upstream cmp_backend {\n    server 127.0.0.1:${backendPort};\n    keepalive 32;\n}\n\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${domain};\n    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }\n    location / { return 301 https://$host$request_uri; }\n}\n\nserver {\n    listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    server_name ${domain};\n    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    ssl_prefer_server_ciphers on;\n    location / {\n        proxy_pass http://cmp_backend;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`
      : `upstream cmp_backend {\n    server 127.0.0.1:${backendPort};\n    keepalive 32;\n}\n\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${domain};\n    location / {\n        proxy_pass http://cmp_backend;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`;

    const confPath = `/etc/nginx/sites-available/cmp-${domain}.conf`;
    try {
      await fsp.mkdir('/var/www/letsencrypt', { recursive: true });
      await fsp.writeFile(confPath, nginxConf, 'utf8');
      send('info', `  ✓ nginx config written to ${confPath}`);
      try { await fsp.mkdir('/etc/nginx/sites-enabled', { recursive: true }); } catch (_) {}
      await runCmd(`ln -sf ${confPath} /etc/nginx/sites-enabled/cmp-${domain}.conf`, process.cwd());
      const { stderr: testErr } = await runCmd('nginx -t', process.cwd());
      send('info', `  nginx test: ${testErr || 'ok'}`);
      await runCmd('systemctl restart nginx', process.cwd());
      send('info', '  ✓ nginx restarted');
    } catch (e) {
      send('error', `  nginx configuration error: ${e.err && e.err.message ? e.err.message : (e.message || 'unknown')}`);
      if (e.stderr) e.stderr.split('\n').filter(Boolean).slice(0, 6).forEach(l => send('error', `    ${l}`));
    }

    await writeControlAudit(req.user && req.user.id, 'cert_install', { domain, certExists });
    send('info', '');
    send('info', `=== Installation complete for ${domain} ===`);
    finish(0);
  } catch (e) {
    send('error', `Unexpected error: ${e.message}`);
    finish(1);
  }
});

// Update check
router.get('/control/update/check', authenticateToken, isAdmin, async (req, res) => {
  try {
    const adminId = req.user && req.user.id;
    const repoDir = path.resolve(__dirname, '..', '..');
    let localSha = null, remoteSha = null, branch = null;
    try { localSha = require('child_process').execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim(); } catch(_) {}
    try { branch = require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir }).toString().trim(); } catch(_) {}
    try { require('child_process').execSync('git fetch --quiet', { cwd: repoDir }); } catch(_) {}
    try { remoteSha = require('child_process').execSync(`git rev-parse origin/${branch}`, { cwd: repoDir }).toString().trim(); } catch(_) {}
    const behind = localSha && remoteSha && localSha !== remoteSha;
    // Fetch current origin URL
    let originUrl = null;
    try { originUrl = require('child_process').execSync('git remote get-url origin', { cwd: repoDir }).toString().trim(); } catch(_) {}
    await writeControlAudit(adminId, 'update_check', { branch, localSha, remoteSha, behind, originUrl });
    return res.json({ ok: true, branch, localSha, remoteSha, behind, originUrl });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'update check failed' }); }
});

// Apply update (git pull + optional rebuild). Simple optimistic flow; production script handles rollback externally.
router.post('/control/update/apply', authenticateToken, isAdmin, async (req, res) => {
  try {
    const adminId = req.user && req.user.id;
    const repoDir = path.resolve(__dirname, '..', '..');
    await writeControlAudit(adminId, 'update_apply_start', {});
    let output = '';
    const run = async (cmd) => { const r = await runCmd(cmd, repoDir); output += `\n$ ${cmd}\n${r.stdout}\n${r.stderr}`; };
    try { await run('git fetch --quiet'); } catch(_) {}
    await run('git pull --ff-only');
    // Rebuild frontend if package-lock changed or forced
    try {
      const frontendDir = path.join(repoDir, 'frontend');
      await runCmd('npm install --no-audit --no-fund', frontendDir);
      await runCmd('npm run build', frontendDir);
      output += '\nFrontend rebuild complete';
    } catch (e) {
      await writeControlAudit(adminId, 'update_apply_failed', { error: e && e.err && e.err.message ? e.err.message : (e && e.message ? e.message : 'unknown') });
      return res.status(500).json({ ok: false, error: e && e.err && e.err.message ? e.err.message : e.message || 'build failed', output: output.slice(0,16000) });
    }
    await writeControlAudit(adminId, 'update_apply_success', {});
    // schedule restart to load new code
    setTimeout(() => { try { process.kill(process.pid, 'SIGTERM'); } catch(_) { process.exit(0); } }, 300);
    return res.json({ ok: true, msg: 'Update applied; restarting shortly', output: output.slice(0,16000) });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message || 'update apply failed' }); }
});

// GET/PUT update source (git origin URL)
// GET/PUT update source (git origin URL) with persistence in app_settings (settings_key='update')
router.get('/control/update/source', authenticateToken, isAdmin, async (req, res) => {
  try {
    const repoDir = path.resolve(__dirname, '..', '..');
    let originUrl = null;
    // Attempt read from git first
    try { originUrl = require('child_process').execSync('git remote get-url origin', { cwd: repoDir }).toString().trim(); } catch(_) {}
    // If git remote missing / empty, fall back to stored value
    if (!originUrl) {
      try {
        const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'update'");
        if (r.rows && r.rows[0]) {
          const data = r.rows[0].data || {};
            if (data.originUrl) originUrl = data.originUrl;
        }
      } catch(_) {}
    }
    return res.json({ ok: true, originUrl: originUrl || null });
  } catch (e) { return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'read source failed' }); }
});

router.put('/control/update/source', authenticateToken, isAdmin, async (req, res) => {
  try {
    const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
    if (!url) return res.status(400).json({ ok: false, msg: 'url is required' });
    const repoDir = path.resolve(__dirname, '..', '..');
    let gitError = null;
    try {
      await runCmd(`git remote set-url origin ${url}`, repoDir);
    } catch (e) {
      // capture git error but still allow persistence so user sees saved value
      gitError = e && e.err && e.err.message ? e.err.message : (e && e.message ? e.message : 'set-url failed');
    }
    // Persist to app_settings
    try {
      await pool.query(`INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
        VALUES ($1,$2,$3, now())
        ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        ['update', { originUrl: url }, req.user && req.user.id ? req.user.id : null]);
    } catch (dbErr) {
      return res.status(500).json({ ok: false, error: dbErr && dbErr.message ? dbErr.message : 'persist failed', gitError });
    }
    await writeControlAudit(req.user && req.user.id, 'update_source_change', { url, git_ok: !gitError });
    if (gitError) return res.status(207).json({ ok: true, gitError, persisted: true }); // 207 Multi-Status: saved but git failed
    return res.json({ ok: true, persisted: true });
  } catch (e) { return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'update source failed' }); }
});

// Lightweight status endpoint to compare git remote vs stored origin
router.get('/control/update/status', authenticateToken, isAdmin, async (req, res) => {
  try {
    const repoDir = path.resolve(__dirname, '..', '..');
    let gitOrigin = null;
    try { gitOrigin = require('child_process').execSync('git remote get-url origin', { cwd: repoDir }).toString().trim(); } catch(_) {}
    let storedOrigin = null;
    let updatedBy = null;
    let updatedAt = null;
    try {
      const r = await pool.query("SELECT data, updated_by, updated_at FROM app_settings WHERE settings_key = 'update'");
      if (r.rows && r.rows[0]) {
        const row = r.rows[0];
        if (row.data && row.data.originUrl) storedOrigin = row.data.originUrl;
        updatedBy = row.updated_by || null;
        updatedAt = row.updated_at || null;
      }
    } catch(_) {}
    return res.json({ ok: true, gitOrigin: gitOrigin || null, storedOrigin: storedOrigin || null, updatedBy, updatedAt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'status failed' });
  }
});

// ── Version check: current (VERSION file) + latest (GitHub releases API) ─────
router.get('/control/update/version', authenticateToken, isAdmin, async (req, res) => {
  const repoDir = path.resolve(__dirname, '..', '..');
  // Read current version from VERSION file
  let current = null;
  try { current = fs.readFileSync(path.join(repoDir, 'VERSION'), 'utf8').trim(); } catch (_) {}

  // Fetch latest release from GitHub
  let latest = null;
  try {
    const https = require('https');
    latest = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.github.com',
        path: '/repos/koyan04/customer-management-portal/releases/latest',
        headers: { 'User-Agent': 'cmp-backend', 'Accept': 'application/vnd.github+json' }
      };
      https.get(opts, (r) => {
        let data = '';
        r.on('data', c => { data += c; });
        r.on('end', () => {
          try { resolve(JSON.parse(data).tag_name || null); } catch (_) { resolve(null); }
        });
      }).on('error', reject);
    });
  } catch (_) {}

  // Normalize for comparison: strip leading 'v', 'cmp ver ', whitespace
  const norm = (s) => (s || '').replace(/^v/i, '').replace(/^cmp\s+ver\s+/i, '').trim();
  const isOutdated = !!(current && latest && norm(current) !== norm(latest));

  // Get last applied update time from app_settings
  let lastAppliedAt = null;
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'update_applied'");
    if (r.rows[0]) lastAppliedAt = r.rows[0].data && r.rows[0].data.appliedAt;
  } catch (_) {}

  return res.json({ ok: true, current, latest, isOutdated, lastAppliedAt, checkedAt: new Date().toISOString() });
});

// ── Streaming update via GitHub release tarball (SSE) ─────────────────────
router.post('/control/update/run', authenticateToken, isAdmin, async (req, res) => {
  const { spawn } = require('child_process');
  const https = require('https');
  const adminId = req.user && req.user.id;
  const scriptPath = path.join(__dirname, '..', 'scripts', 'update-unattended.sh');

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {}
  };

  if (!fs.existsSync(scriptPath)) {
    send({ type: 'error', text: 'Update script not found on server' });
    res.end();
    return;
  }

  // Pre-resolve the latest GitHub release tag using Node's https (reliable JSON parsing)
  // and pass it as LATEST_TAG env var so the shell script never needs to parse JSON.
  let resolvedTag = '';
  try {
    send({ type: 'log', text: '→ Resolving latest release tag...\n' });
    resolvedTag = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.github.com',
        path: '/repos/koyan04/customer-management-portal/releases/latest',
        headers: { 'User-Agent': 'cmp-updater/1.0', 'Accept': 'application/vnd.github+json' }
      };
      https.get(opts, (r) => {
        let raw = '';
        r.on('data', d => { raw += d; });
        r.on('end', () => {
          try {
            const tag = JSON.parse(raw).tag_name || '';
            if (/^v?[0-9]+\.[0-9]/.test(tag)) resolve(tag);
            else reject(new Error('Unexpected tag: ' + tag.slice(0, 80)));
          } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    send({ type: 'log', text: `  Latest release: ${resolvedTag}\n` });
  } catch (e) {
    send({ type: 'error', text: `  ERROR resolving tag: ${e.message}\n  Update aborted.` });
    send({ type: 'done', code: 1, restarting: false });
    res.end();
    return;
  }

  writeControlAudit(adminId, 'update_run_start', { tag: resolvedTag }).catch(() => {});
  send({ type: 'log', text: '=== Starting unattended update ===\n' });

  const child = spawn('bash', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, LATEST_TAG: resolvedTag }
  });

  let shouldRestart = false;
  let lineBuffer = '';

  const handleChunk = (chunk, isErr) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();
    for (const line of lines) {
      if (line === 'RESTART_SIGNAL') {
        shouldRestart = true;
        send({ type: 'restarting', text: '→ Signalling service restart...\n' });
      } else {
        send({ type: isErr ? 'err' : 'log', text: line + '\n' });
      }
    }
  };

  child.stdout.on('data', (chunk) => handleChunk(chunk, false));
  child.stderr.on('data', (chunk) => handleChunk(chunk, true));

  child.on('close', async (code) => {
    // flush remaining buffer
    if (lineBuffer.trim()) send({ type: 'log', text: lineBuffer + '\n' });

    if (code === 0) {
      // Record last applied timestamp
      try {
        await pool.query(
          `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
           VALUES ($1,$2,$3,now())
           ON CONFLICT (settings_key) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          ['update_applied', { appliedAt: new Date().toISOString() }, adminId]
        );
      } catch (_) {}
      await writeControlAudit(adminId, 'update_run_success', {}).catch(() => {});
    } else {
      await writeControlAudit(adminId, 'update_run_failed', { code }).catch(() => {});
    }

    send({ type: 'done', code, restarting: shouldRestart && code === 0 });
    res.end();

    if (shouldRestart && code === 0) {
      setTimeout(() => {
        try { process.kill(process.pid, 'SIGTERM'); } catch (_) { process.exit(0); }
      }, 1200);
    }
  });

  child.on('error', (err) => {
    send({ type: 'error', text: `Failed to start update script: ${err.message}\n` });
    res.end();
  });

  req.on('close', () => {
    try { child.kill('SIGTERM'); } catch (_) {}
  });
});

// ── Admin-specific backup (full admin data + permissions + audit logs) ────────
router.get('/backup/admins', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [adminsRes, adminsAuditRes, loginAuditRes, pwResetAuditRes, ctrlAuditRes, settingsAuditRes] = await Promise.all([
      pool.query('SELECT id, display_name, username, password_hash, role, avatar_url, avatar_data, created_at, updated_at, last_seen FROM admins ORDER BY id'),
      pool.query('SELECT id, admin_id, changed_by, change_type, "old", "new", created_at, changed_fields, password_changed FROM admins_audit ORDER BY id'),
      pool.query('SELECT id, admin_id, role, ip, user_agent, geo_city, geo_country, created_at FROM login_audit ORDER BY id'),
      pool.query('SELECT id, admin_id, target_account_id, created_at, note FROM password_reset_audit ORDER BY id'),
      pool.query('SELECT id, admin_id, action, payload, created_at FROM control_panel_audit ORDER BY id'),
      pool.query('SELECT id, admin_id, settings_key, action, before_data, after_data, created_at FROM settings_audit ORDER BY id'),
    ]);
    // Also include permission tables
    let viewerPerms = [];
    try { const r = await pool.query('SELECT editor_id, server_id FROM viewer_server_permissions'); viewerPerms = r.rows || []; }
    catch (_) { try { const r2 = await pool.query('SELECT editor_id, server_id FROM editor_server_permissions'); viewerPerms = r2.rows || []; } catch (__) {} }
    let serverAdminPerms = [];
    try { const r = await pool.query('SELECT admin_id, server_id FROM server_admin_permissions'); serverAdminPerms = r.rows || []; } catch (_) {}
    let serverKeysAudit = [];
    try { const r = await pool.query('SELECT id, admin_id, server_id, key_id, action, key_username, key_description, created_at FROM server_keys_audit ORDER BY id'); serverKeysAudit = r.rows || []; } catch (_) {}

    // Embed avatar files as base64 so they survive across server migrations
    const admins = (adminsRes.rows || []).map(a => {
      const result = { ...a };
      if (a.avatar_url && a.avatar_url.startsWith('/uploads/') && !a.avatar_data) {
        try {
          const filePath = path.join(uploadsPath, path.basename(a.avatar_url));
          if (fs.existsSync(filePath)) {
            const ext = path.extname(a.avatar_url).toLowerCase().replace('.', '');
            const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : `image/${ext}`;
            result.avatar_data = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
          }
        } catch (_) { /* skip if file unreadable */ }
      }
      return result;
    });

    const payload = {
      type: 'admin-backup-v1',
      createdAt: new Date().toISOString(),
      admins,
      admins_audit: adminsAuditRes.rows || [],
      login_audit: loginAuditRes.rows || [],
      password_reset_audit: pwResetAuditRes.rows || [],
      control_panel_audit: ctrlAuditRes.rows || [],
      settings_audit: settingsAuditRes.rows || [],
      server_keys_audit: serverKeysAudit,
      viewer_server_permissions: viewerPerms,
      server_admin_permissions: serverAdminPerms,
    };
    const json = JSON.stringify(payload);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${tsName('admin-backup', 'json')}"`);
    return res.send(json);
  } catch (err) {
    console.error('admin backup failed:', err);
    return res.status(500).json({ msg: 'Failed to create admin backup' });
  }
});

// ── Admin-specific restore ────────────────────────────────────────────────────
router.post('/restore/admins', authenticateToken, isAdmin, upload.single('file'), async (req, res) => {
  const tmpUploadPath = req.file && req.file.path ? req.file.path : null;
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });
    let data;
    try {
      if (req.file.buffer) data = JSON.parse(req.file.buffer.toString('utf8'));
      else if (req.file.path) data = JSON.parse(fs.readFileSync(req.file.path).toString('utf8'));
    } catch (_) { return res.status(400).json({ msg: 'Invalid JSON' }); }
    if (!data || data.type !== 'admin-backup-v1') return res.status(400).json({ msg: 'Not a valid admin backup file (expected type admin-backup-v1)' });

    const mode = req.body.mode || 'merge'; // merge or overwrite

    await client.query('BEGIN');

    const admins = Array.isArray(data.admins) ? data.admins : [];
    const adminsAudit = Array.isArray(data.admins_audit) ? data.admins_audit : [];
    const loginAudit = Array.isArray(data.login_audit) ? data.login_audit : [];
    const pwResetAudit = Array.isArray(data.password_reset_audit) ? data.password_reset_audit : [];
    const ctrlAudit = Array.isArray(data.control_panel_audit) ? data.control_panel_audit : [];
    const settingsAudit = Array.isArray(data.settings_audit) ? data.settings_audit : [];
    const serverKeysAudit = Array.isArray(data.server_keys_audit) ? data.server_keys_audit : [];
    const viewerPerms = Array.isArray(data.viewer_server_permissions) ? data.viewer_server_permissions : [];
    const serverAdminPerms = Array.isArray(data.server_admin_permissions) ? data.server_admin_permissions : [];

    if (mode === 'overwrite') {
      // Disable the app_settings validation trigger so FK cascade SET NULL on updated_by doesn't fail
      try { await client.query('ALTER TABLE app_settings DISABLE TRIGGER trg_app_settings_enforce_general_updated_by'); } catch (_) {}
      // Nullify updated_by references before deleting admins (prevents FK cascade trigger conflict)
      try { await client.query('UPDATE app_settings SET updated_by = NULL WHERE updated_by IS NOT NULL'); } catch (_) {}
      // Clear all tables (order matters due to potential FK references)
      await client.query('DELETE FROM password_reset_audit');
      await client.query('DELETE FROM login_audit');
      await client.query('DELETE FROM admins_audit');
      try { await client.query('DELETE FROM control_panel_audit'); } catch (_) {}
      try { await client.query('DELETE FROM settings_audit'); } catch (_) {}
      try { await client.query('DELETE FROM server_keys_audit'); } catch (_) {}
      try { await client.query('DELETE FROM viewer_server_permissions'); } catch (_) { try { await client.query('DELETE FROM editor_server_permissions'); } catch (__) {} }
      try { await client.query('DELETE FROM server_admin_permissions'); } catch (_) {}
      // Disable audit trigger during bulk admin delete/insert to avoid double entries
      try { await client.query('ALTER TABLE admins DISABLE TRIGGER admins_audit_trigger'); } catch (_) {}
      // Don't delete the current admin doing the restore
      const currentAdminId = req.user && req.user.id ? req.user.id : null;
      if (currentAdminId) {
        await client.query('DELETE FROM admins WHERE id != $1', [currentAdminId]);
      } else {
        await client.query('DELETE FROM admins');
      }
    }

    // Restore admins
    let adminCount = 0;
    for (const a of admins) {
      if (!a.username) continue;
      const currentAdminId = req.user && req.user.id ? req.user.id : null;

      // Check if username already exists in DB (find by username to avoid PK conflicts)
      const existingByUsername = await client.query('SELECT id FROM admins WHERE username=$1', [a.username]);

      if (existingByUsername.rows.length > 0) {
        // Username exists — UPDATE in place (preserve existing id to keep session/FK integrity)
        const existingId = existingByUsername.rows[0].id;
        const isCurrentAdmin = currentAdminId && existingId === currentAdminId;
        // Resolve avatar: if backup has avatar_data (base64), write file and set avatar_url
        let resolvedAvatarUrl = a.avatar_url || null;
        let resolvedAvatarData = a.avatar_data || null;
        if (a.avatar_data && a.avatar_data.startsWith('data:image/')) {
          try {
            const m = a.avatar_data.match(/^data:(image\/[\w+]+);base64,(.+)$/);
            if (m) {
              const ext = m[1].replace('image/', '').replace('jpeg', 'jpg');
              const fname = `restored-${a.username}-${Date.now()}.${ext}`;
              fs.writeFileSync(path.join(uploadsPath, fname), Buffer.from(m[2], 'base64'));
              resolvedAvatarUrl = `/uploads/${fname}`;
              resolvedAvatarData = null; // file is now on disk, no need for inline data
            }
          } catch (_) { /* keep original values on error */ }
        }
        if (mode === 'merge' || isCurrentAdmin) {
          // merge or current admin: keep password_hash and role untouched
          await client.query(
            `UPDATE admins SET display_name=$1, role=$2, avatar_url=$3, avatar_data=$4, updated_at=NOW() WHERE id=$5`,
            [a.display_name || null, a.role || 'VIEWER', resolvedAvatarUrl, resolvedAvatarData, existingId]
          );
        } else {
          // overwrite non-current: update everything including password
          await client.query(
            `UPDATE admins SET display_name=$1, password_hash=$2, role=$3, avatar_url=$4, avatar_data=$5, last_seen=$6, updated_at=NOW() WHERE id=$7`,
            [a.display_name || null, a.password_hash || 'placeholder', a.role || 'VIEWER', resolvedAvatarUrl, resolvedAvatarData, a.last_seen || null, existingId]
          );
        }
      } else {
        // Username doesn't exist — try INSERT with backup's original id
        // Resolve avatar for new insert: write base64 data to disk if present
        let insertAvatarUrl = a.avatar_url || null;
        let insertAvatarData = a.avatar_data || null;
        if (a.avatar_data && a.avatar_data.startsWith('data:image/')) {
          try {
            const m = a.avatar_data.match(/^data:(image\/[\w+]+);base64,(.+)$/);
            if (m) {
              const ext = m[1].replace('image/', '').replace('jpeg', 'jpg');
              const fname = `restored-${a.username}-${Date.now()}.${ext}`;
              fs.writeFileSync(path.join(uploadsPath, fname), Buffer.from(m[2], 'base64'));
              insertAvatarUrl = `/uploads/${fname}`;
              insertAvatarData = null;
            }
          } catch (_) { /* keep original on error */ }
        }
        try {
          await client.query(
            `INSERT INTO admins (id, display_name, username, password_hash, role, avatar_url, avatar_data, created_at, updated_at, last_seen)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [a.id, a.display_name || null, a.username, a.password_hash || 'placeholder', a.role || 'VIEWER', insertAvatarUrl, insertAvatarData, a.created_at || new Date().toISOString(), a.updated_at || null, a.last_seen || null]
          );
        } catch (insertErr) {
          if (insertErr.code === '23505') {
            // PK conflict on id (different user holds that id) — insert without explicit id, let DB assign
            await client.query(
              `INSERT INTO admins (display_name, username, password_hash, role, avatar_url, avatar_data, created_at, updated_at, last_seen)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [a.display_name || null, a.username, a.password_hash || 'placeholder', a.role || 'VIEWER', insertAvatarUrl, insertAvatarData, a.created_at || new Date().toISOString(), a.updated_at || null, a.last_seen || null]
            );
          } else {
            throw insertErr;
          }
        }
      }
      adminCount++;
    }

    // Re-enable triggers after admin operations
    if (mode === 'overwrite') {
      try { await client.query('ALTER TABLE admins ENABLE TRIGGER admins_audit_trigger'); } catch (_) {}
      try { await client.query('ALTER TABLE app_settings ENABLE TRIGGER trg_app_settings_enforce_general_updated_by'); } catch (_) {}
    }

    // Restore audit logs (always insert — skip existing IDs)
    let auditCount = 0;
    for (const r of adminsAudit) {
      try {
        await client.query(
          `INSERT INTO admins_audit (id, admin_id, changed_by, change_type, "old", "new", created_at, changed_fields, password_changed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.admin_id, r.changed_by, r.change_type, r.old ? JSON.stringify(r.old) : null, r.new ? JSON.stringify(r.new) : null, r.created_at, r.changed_fields || null, r.password_changed || false]
        );
        auditCount++;
      } catch (_) { /* skip row on error */ }
    }

    let loginCount = 0;
    for (const r of loginAudit) {
      try {
        await client.query(
          `INSERT INTO login_audit (id, admin_id, role, ip, user_agent, geo_city, geo_country, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.admin_id, r.role, r.ip, r.user_agent, r.geo_city, r.geo_country, r.created_at]
        );
        loginCount++;
      } catch (_) { /* skip row on error */ }
    }

    let pwResetCount = 0;
    for (const r of pwResetAudit) {
      try {
        await client.query(
          `INSERT INTO password_reset_audit (id, admin_id, target_account_id, created_at, note)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.admin_id, r.target_account_id, r.created_at, r.note]
        );
        pwResetCount++;
      } catch (_) { /* skip row on error */ }
    }

    // Restore permissions
    let permCount = 0;
    for (const p of viewerPerms) {
      try {
        await client.query('INSERT INTO viewer_server_permissions (editor_id, server_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.editor_id, p.server_id]);
        permCount++;
      } catch (_) { try { await client.query('INSERT INTO editor_server_permissions (editor_id, server_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.editor_id, p.server_id]); permCount++; } catch (__) {} }
    }
    for (const p of serverAdminPerms) {
      try {
        await client.query('INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.admin_id, p.server_id]);
        permCount++;
      } catch (_) { /* skip */ }
    }

    // Restore control_panel_audit
    let ctrlCount = 0;
    for (const r of ctrlAudit) {
      try {
        await client.query(
          `INSERT INTO control_panel_audit (id, admin_id, action, payload, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.admin_id, r.action, r.payload ? JSON.stringify(r.payload) : null, r.created_at]
        );
        ctrlCount++;
      } catch (_) { /* skip */ }
    }

    // Restore settings_audit
    let settingsAuditCount = 0;
    for (const r of settingsAudit) {
      try {
        await client.query(
          `INSERT INTO settings_audit (id, admin_id, settings_key, action, before_data, after_data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.admin_id, r.settings_key, r.action, r.before_data ? JSON.stringify(r.before_data) : null, r.after_data ? JSON.stringify(r.after_data) : null, r.created_at]
        );
        settingsAuditCount++;
      } catch (_) { /* skip */ }
    }

    // Restore server_keys_audit
    let serverKeysAuditCount = 0;
    for (const r of serverKeysAudit) {
      try {
        await client.query(
          `INSERT INTO server_keys_audit (id, admin_id, server_id, key_id, action, key_username, key_description, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.admin_id, r.server_id, r.key_id || null, r.action, r.key_username || null, r.key_description || null, r.created_at]
        );
        serverKeysAuditCount++;
      } catch (_) { /* skip */ }
    }

    // Fix sequences so next INSERT gets a valid ID
    try { await client.query("SELECT setval('admins_id_seq', COALESCE((SELECT MAX(id) FROM admins), 1))"); } catch (_) {}
    try { await client.query("SELECT setval('admins_audit_id_seq', COALESCE((SELECT MAX(id) FROM admins_audit), 1))"); } catch (_) {}
    try { await client.query("SELECT setval('login_audit_id_seq', COALESCE((SELECT MAX(id) FROM login_audit), 1))"); } catch (_) {}
    try { await client.query("SELECT setval('password_reset_audit_id_seq', COALESCE((SELECT MAX(id) FROM password_reset_audit), 1))"); } catch (_) {}
    try { await client.query("SELECT setval('control_panel_audit_id_seq', COALESCE((SELECT MAX(id) FROM control_panel_audit), 1))"); } catch (_) {}
    try { await client.query("SELECT setval('settings_audit_id_seq', COALESCE((SELECT MAX(id) FROM settings_audit), 1))"); } catch (_) {}
    try { await client.query("SELECT setval('server_keys_audit_id_seq', COALESCE((SELECT MAX(id) FROM server_keys_audit), 1))"); } catch (_) {}

    await client.query('COMMIT');
    return res.json({ ok: true, counts: { admins: adminCount, admins_audit: auditCount, login_audit: loginCount, password_reset_audit: pwResetCount, control_panel_audit: ctrlCount, settings_audit: settingsAuditCount, server_keys_audit: serverKeysAuditCount, permissions: permCount } });
  } catch (err) {
    await client.query('ROLLBACK');
    // Re-enable triggers in case of failure
    try { await client.query('ALTER TABLE admins ENABLE TRIGGER admins_audit_trigger'); } catch (_) {}
    try { await client.query('ALTER TABLE app_settings ENABLE TRIGGER trg_app_settings_enforce_general_updated_by'); } catch (_) {}
    console.error('admin restore failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Failed to restore admin backup', detail: err && err.message ? err.message : String(err) });
  } finally {
    client.release();
    // cleanup uploaded temp file
    if (tmpUploadPath) { try { fs.unlinkSync(tmpUploadPath); } catch (_) {} }
  }
});
