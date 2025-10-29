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
      const dbResult = await pool.query('SELECT * FROM servers ORDER BY created_at DESC');
      return res.json(Array.isArray(dbResult.rows) ? dbResult.rows : []);
    }
    // viewer: return only assigned servers
    const { rows } = await pool.query(
      'SELECT s.* FROM servers s JOIN viewer_server_permissions p ON p.server_id = s.id WHERE p.editor_id = $1 ORDER BY s.created_at DESC',
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

    // Base servers list depending on role
    let serversRows = [];
    if (user.role === 'ADMIN') {
      const r = await pool.query('SELECT id, server_name, ip_address, domain_name FROM servers ORDER BY created_at DESC');
      serversRows = r.rows || [];
    } else {
      const r = await pool.query(
        'SELECT s.id, s.server_name, s.ip_address, s.domain_name FROM servers s JOIN viewer_server_permissions p ON p.server_id = s.id WHERE p.editor_id = $1 ORDER BY s.created_at DESC',
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
       WHERE u.server_id = ANY($1::int[])`,
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
      const diff = new Date(row.expire_date) - now;
      if (diff < 0) { status.expired++; bucket.status.expired++; }
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

    return res.json({
      totalServers: serversRows.length,
      totalUsers,
      tiers,
      status,
      servers,
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
    const newServer = await pool.query(
      'INSERT INTO servers (server_name, owner, service_type, ip_address, domain_name) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [server_name, owner, service_type, ip_address, domain_name]
    );
    res.status(201).json(newServer.rows[0]);
  } catch (err) {
    console.error('SERVER ROUTE ERROR POST /api/servers :', err && err.stack ? err.stack : err);
    res.status(500).send('Server Error');
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
    res.status(500).send('Server Error');
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
    res.status(500).send('Server Error');
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
    res.status(500).send('Server Error');
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