const express = require('express');
const router = express.Router();
const pool = require('../db'); // Imports the database connection pool
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware');

// GET all servers
// Admin: returns all servers
// Viewer: returns only servers assigned via viewer_server_permissions (editor_id)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    if (user.role === 'ADMIN') {
      const dbResult = await pool.query('SELECT * FROM servers ORDER BY COALESCE(display_pos, 2147483647) ASC, created_at DESC');
      return res.json(Array.isArray(dbResult.rows) ? dbResult.rows : []);
    }
    // viewer: return only assigned servers
    const { rows } = await pool.query(
      'SELECT s.* FROM servers s JOIN viewer_server_permissions p ON p.server_id = s.id WHERE p.editor_id = $1 ORDER BY COALESCE(s.display_pos, 2147483647) ASC, s.created_at DESC',
      [user.id]
    );
    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('SERVER ROUTE ERROR GET /api/servers :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// GET dashboard aggregates: global totals and per-server summaries
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });

    // Base servers list depending on role, ordered by display_pos (then created_at)
    let serversRows = [];
    if (user.role === 'ADMIN') {
      const r = await pool.query('SELECT id, server_name, ip_address, domain_name FROM servers ORDER BY COALESCE(display_pos, 2147483647) ASC, created_at DESC');
      serversRows = r.rows || [];
    } else {
      const r = await pool.query(
        'SELECT s.id, s.server_name, s.ip_address, s.domain_name FROM servers s JOIN viewer_server_permissions p ON p.server_id = s.id WHERE p.editor_id = $1 ORDER BY COALESCE(s.display_pos, 2147483647) ASC, s.created_at DESC',
        [user.id]
      );
      serversRows = r.rows || [];
    }

    if (!serversRows.length) return res.json({ totalServers: 0, totalUsers: 0, tiers: { Mini: 0, Basic: 0, Unlimited: 0 }, status: { active: 0, soon: 0, expired: 0 }, servers: [] });

    // Compute per-server counts with one SQL query using GROUP BY
    const serverIds = serversRows.map(s => s.id);
    const now = new Date();
    const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Postgres aggregation with CASE for status and tier normalization (basic mapping done in JS after fetch to keep SQL simpler)
    const { rows: userRows } = await pool.query(
      `SELECT u.server_id, u.service_type, u.expire_date
       FROM users u
       WHERE u.server_id = ANY($1::int[]) AND u.enabled = TRUE`,
      [serverIds]
    );

    // Aggregate in JS to simplify normalization
  const perServer = new Map();
    let totalUsers = 0;
  let tiers = { Mini: 0, Basic: 0, Unlimited: 0 };
  let status = { active: 0, soon: 0, expired: 0 };
    const normalizeService = (svc) => {
      const v = (svc || '').toLowerCase();
      if (v === 'x-ray' || v === 'xray' || v === 'outline') return 'Mini';
      if (v === 'mini') return 'Mini';
      if (v === 'basic') return 'Basic';
      if (v === 'unlimited') return 'Unlimited';
      return svc || '';
    };
    // helper to parse a date-only string (YYYY-MM-DD) as local date and return the cutoff time (start of next day)
    const parseCutoff = (val) => {
      if (!val) return null;
      try {
        const s = String(val);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
          const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
          return new Date(y, mo - 1, d + 1, 0, 0, 0, 0);
        }
        // fallback: Date parse then add 1 day to get end-of-day cutoff
        const dt = new Date(s);
        if (!isNaN(dt.getTime())) return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
      } catch (_) {}
      return null;
    };
    for (const row of (userRows || [])) {
      totalUsers++;
      const sid = row.server_id;
      const svc = normalizeService(row.service_type);
  if (!perServer.has(sid)) perServer.set(sid, { count: 0, tiers: { Mini: 0, Basic: 0, Unlimited: 0 }, status: { active: 0, soon: 0, expired: 0 } });
  const bucket = perServer.get(sid);
  bucket.count++;
      if (svc === 'Mini') { tiers.Mini++; bucket.tiers.Mini++; }
      else if (svc === 'Basic') { tiers.Basic++; bucket.tiers.Basic++; }
      else if (svc === 'Unlimited') { tiers.Unlimited++; bucket.tiers.Unlimited++; }
      const cutoff = parseCutoff(row.expire_date);
      if (!cutoff) { status.active++; bucket.status.active++; continue; }
      const diff = cutoff.getTime() - now.getTime();
      if (diff <= 0) { status.expired++; bucket.status.expired++; }
      else if (diff <= 24 * 60 * 60 * 1000) { status.soon++; bucket.status.soon++; }
      else { status.active++; bucket.status.active++; }
    }

    const servers = serversRows.map(s => ({
      id: s.id,
      server_name: s.server_name,
      ip_address: s.ip_address,
      domain_name: s.domain_name,
      total_users: (perServer.get(s.id)?.count) || 0,
      tiers: perServer.get(s.id)?.tiers || { Mini: 0, Basic: 0, Unlimited: 0 },
      status: perServer.get(s.id)?.status || { active: 0, soon: 0, expired: 0 },
    }));

    // Dynamic matview support detection: combines env override + existence checks
    let useMatview = false;
    try {
      const { detectMatviewSupport } = require('../lib/matview_detect');
      const mv = await detectMatviewSupport(pool);
      useMatview = !!mv.enabled;
    } catch (e) {
      // fallback: keep legacy env-based behavior if helper fails
      const v = String(process.env.USE_USER_STATUS_MATVIEW || '').trim().toLowerCase();
      useMatview = (v === '1' || v === 'true' || v === 'yes' || v === 'on');
      console.warn('matview dynamic detection failed; using env only:', e && e.message ? e.message : e);
    }
    return res.json({
      totalServers: serversRows.length,
      totalUsers,
      tiers,
      status,
      servers,
      features: { useUserStatusMatview: useMatview }
    });
  } catch (err) {
    console.error('SERVER ROUTE ERROR GET /api/servers/summary :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// POST a new server (admin only)
router.post('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { server_name, owner, service_type, ip_address, domain_name } = req.body;
    // Assign new server to the end of the ordered list
    const newServer = await pool.query(
      'INSERT INTO servers (server_name, owner, service_type, ip_address, domain_name, display_pos) VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(display_pos), 0) + 1 FROM servers)) RETURNING *',
      [server_name, owner, service_type, ip_address, domain_name]
    );
    res.status(201).json(newServer.rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR POST /api/servers :', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// Reorder servers (admin only): accepts array of ids in desired order
router.put('/order', authenticateToken, isAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids.map(n => Number(n)).filter(n => Number.isFinite(n)) : [];
    if (!ids.length) return res.status(400).json({ msg: 'ids array required' });
    // Update display_pos using WITH ORDINALITY to assign 1..N in provided order
    const sql = `
      WITH new_order AS (
        SELECT id::int, ord::int
        FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
      )
      UPDATE servers s
      SET display_pos = n.ord
      FROM new_order n
      WHERE s.id = n.id
    `;
    try {
      await pool.query(sql, [ids]);
    } catch (dbErr) {
      // If the migration adding display_pos wasn't applied, Postgres throws undefined_column (42703)
      if (dbErr && (dbErr.code === '42703' || /display_pos/i.test(String(dbErr.message || '')))) {
        console.error('Reorder failed: display_pos missing. Apply migration 2025-11-06-add-servers-display-pos.sql');
        return res.status(500).json({ msg: 'Migration missing: add servers.display_pos (run backend/migrations/2025-11-06-add-servers-display-pos.sql)' });
      }
      // Bubble other DB errors with a generic message but JSON shape
      console.error('DB error during reorder:', dbErr && dbErr.stack ? dbErr.stack : dbErr);
      return res.status(500).json({ msg: 'Database error while saving order' });
    }
    return res.json({ ok: true, count: ids.length });
  } catch (err) {
    console.error('SERVER ROUTE ERROR PUT /api/servers/order :', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// UPDATE a server (global ADMIN or server-admin assigned to the server)
// Allow server-admins that have a row in server_admin_permissions to update their server.
const { isServerAdminOrGlobal } = require('../middleware/authMiddleware');

router.put('/:id', authenticateToken, isServerAdminOrGlobal('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { server_name, owner, service_type, ip_address, domain_name } = req.body;
    const updatedServer = await pool.query(
      'UPDATE servers SET server_name = $1, owner = $2, service_type = $3, ip_address = $4, domain_name = $5 WHERE id = $6 RETURNING *',
      [server_name, owner, service_type, ip_address, domain_name, id]
    );
    res.json(updatedServer.rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR PUT /api/servers/:id :', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// DELETE a server (admin only)
router.delete('/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM servers WHERE id = $1', [id]);
    res.json({ msg: 'Server deleted' });
  } catch (err) {
    console.error('SERVER ROUTE ERROR DELETE /api/servers/:id :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// GET a single server by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    if (user.role === 'ADMIN') {
      const { rows } = await pool.query('SELECT * FROM servers WHERE id = $1', [id]);
      return res.json(rows[0]);
    }
    // viewer: ensure this server is assigned to the viewer
    const { rows } = await pool.query('SELECT s.* FROM servers s JOIN viewer_server_permissions p ON p.server_id = s.id WHERE s.id = $1 AND p.editor_id = $2', [id, user.id]);
    if (!rows || rows.length === 0) return res.status(403).json({ msg: 'Forbidden' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR GET /api/servers/:id :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// --- Key management endpoints for a server ---
// GET /api/servers/:id/keys  - list keys for server (ADMIN or server admin)
router.get('/:id/keys', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
    // Explicitly deny VIEWER-only accounts from using key management endpoints
    const role = req.user && req.user.role;
    if (role === 'VIEWER') return res.status(403).json({ msg: 'Forbidden' });
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      const chk = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [uid, id]);
      if (!chk || chk.rowCount === 0) return res.status(403).json({ msg: 'Forbidden' });
    }
  const { rows } = await pool.query('SELECT id, username, description, original_key, generated_key, created_at FROM server_keys WHERE server_id = $1 ORDER BY id DESC', [id]);
    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('SERVER ROUTE ERROR GET /api/servers/:id/keys :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// GET /api/servers/:id/keys/:keyId - get a single key (includes original_key)
router.get('/:id/keys/:keyId', authenticateToken, async (req, res) => {
  try {
    const { id, keyId } = req.params;
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
    const role = req.user && req.user.role;
    if (role === 'VIEWER') return res.status(403).json({ msg: 'Forbidden' });
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      const chk = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [uid, id]);
      if (!chk || chk.rowCount === 0) return res.status(403).json({ msg: 'Forbidden' });
    }
    const { rows } = await pool.query('SELECT id, username, description, original_key, generated_key, created_at FROM server_keys WHERE id = $1 AND server_id = $2', [keyId, id]);
    if (!rows || rows.length === 0) return res.status(404).json({ msg: 'Not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR GET /api/servers/:id/keys/:keyId :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});

// POST /api/servers/:id/keys - create a new key for server
router.post('/:id/keys', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
    const role = req.user && req.user.role;
    if (role === 'VIEWER') return res.status(403).json({ msg: 'Forbidden' });
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      const chk = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [uid, id]);
      if (!chk || chk.rowCount === 0) return res.status(403).json({ msg: 'Forbidden' });
    }
    const { username, description, original_key, generated_key } = req.body || {};
    const insert = await pool.query(
      'INSERT INTO server_keys (server_id, username, description, original_key, generated_key, created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id, username, description, generated_key, created_at',
      [id, username || null, description || null, original_key || null, generated_key || null]
    );
    return res.status(201).json(insert.rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR POST /api/servers/:id/keys :', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// PUT /api/servers/:id/keys/:keyId - update an existing key (description or generated_key)
router.put('/:id/keys/:keyId', authenticateToken, async (req, res) => {
  try {
    const { id, keyId } = req.params;
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
    const role = req.user && req.user.role;
    if (role === 'VIEWER') return res.status(403).json({ msg: 'Forbidden' });
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      const chk = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [uid, id]);
      if (!chk || chk.rowCount === 0) return res.status(403).json({ msg: 'Forbidden' });
    }
    const { username, description, original_key, generated_key } = req.body || {};
    const upd = await pool.query(
      'UPDATE server_keys SET username = COALESCE($1, username), description = COALESCE($2, description), original_key = COALESCE($3, original_key), generated_key = COALESCE($4, generated_key) WHERE id = $5 AND server_id = $6 RETURNING id, username, description, generated_key, created_at',
      [username || null, description || null, original_key || null, generated_key || null, keyId, id]
    );
    if (!upd || upd.rowCount === 0) return res.status(404).json({ msg: 'Not found' });
    return res.json(upd.rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR PUT /api/servers/:id/keys/:keyId :', err && err.stack ? err.stack : err);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// DELETE /api/servers/:id/keys/:keyId - remove a key
router.delete('/:id/keys/:keyId', authenticateToken, async (req, res) => {
  try {
    const { id, keyId } = req.params;
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
    const role = req.user && req.user.role;
    if (role === 'VIEWER') return res.status(403).json({ msg: 'Forbidden' });
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (!isAdmin) {
      const chk = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [uid, id]);
      if (!chk || chk.rowCount === 0) return res.status(403).json({ msg: 'Forbidden' });
    }
    const del = await pool.query('DELETE FROM server_keys WHERE id = $1 AND server_id = $2 RETURNING id', [keyId, id]);
    if (!del || del.rowCount === 0) return res.status(404).json({ msg: 'Not found' });
    return res.json({ msg: 'Deleted' });
  } catch (err) {
    console.error('SERVER ROUTE ERROR DELETE /api/servers/:id/keys/:keyId :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
  }
});


module.exports = router;