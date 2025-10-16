const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadsPath = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true }); } catch(e) { console.warn('mkdir uploads failed', e && e.message ? e.message : e); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsPath),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

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

module.exports = router;
