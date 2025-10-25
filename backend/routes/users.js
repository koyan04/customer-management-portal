const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Simple in-memory rate limiter: max N events per window per user
const rateBuckets = new Map(); // key -> { count, ts }
function rateLimit(key, maxPerMinute = 5) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, ts: now };
  // reset window if older than 60s
  if (now - bucket.ts > 60 * 1000) {
    bucket.count = 0;
    bucket.ts = now;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= maxPerMinute;
}
const pool = require('../db');
const { authenticateToken, isAdmin, isServerAdminOrGlobal } = require('../middleware/authMiddleware');

// Middleware: attach server_id of the target user (from :userId) to req.params.serverId
const attachUserServerId = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!userId || Number.isNaN(Number(userId))) return res.status(400).json({ msg: 'Invalid user id' });
    const { rows } = await pool.query('SELECT server_id FROM users WHERE id = $1', [userId]);
    if (!rows || rows.length === 0) return res.status(404).json({ msg: 'User not found' });
    req.params.serverId = rows[0].server_id;
    return next();
  } catch (err) {
    console.error('attachUserServerId error', err && err.message ? err.message : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
};

// GET all users for a specific server
router.get('/server/:serverId', authenticateToken, async (req, res) => {
  try {
    const { serverId } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    // Admins can view any server
    if (user.role === 'ADMIN') {
      // compute an effective position that falls back to created_at ordering when display_pos is NULL
      const sql = `
        SELECT * FROM (
          SELECT u.*, COALESCE(u.display_pos, ROW_NUMBER() OVER (PARTITION BY u.server_id ORDER BY u.created_at ASC)) AS effective_pos
          FROM users u
          WHERE u.server_id = $1
        ) t
        ORDER BY t.effective_pos ASC, t.created_at DESC
      `;
      const { rows } = await pool.query(sql, [serverId]);
      return res.json(rows);
    }
    // Viewers/Server-Admins: ensure they have permission for this server
    // First check server_admin_permissions (server admins can view users too)
    const serverAdminCheck = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [user.id, serverId]);
    if (serverAdminCheck.rows && serverAdminCheck.rows.length > 0) {
      const sql = `
        SELECT * FROM (
          SELECT u.*, COALESCE(u.display_pos, ROW_NUMBER() OVER (PARTITION BY u.server_id ORDER BY u.created_at ASC)) AS effective_pos
          FROM users u
          WHERE u.server_id = $1
        ) t
        ORDER BY t.effective_pos ASC, t.created_at DESC
      `;
      const { rows } = await pool.query(sql, [serverId]);
      return res.json(rows);
    }
    const perm = await pool.query('SELECT 1 FROM viewer_server_permissions WHERE editor_id = $1 AND server_id = $2', [user.id, serverId]);
    if (!perm.rows || perm.rows.length === 0) return res.status(403).json({ msg: 'Forbidden' });
    const sql = `
      SELECT * FROM (
        SELECT u.*, COALESCE(u.display_pos, ROW_NUMBER() OVER (PARTITION BY u.server_id ORDER BY u.created_at ASC)) AS effective_pos
        FROM users u
        WHERE u.server_id = $1
      ) t
      ORDER BY t.effective_pos ASC, t.created_at DESC
    `;
    const { rows } = await pool.query(sql, [serverId]);
    return res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Shared handlers for template/export/import to avoid duplication and allow multiple route aliases
async function handleTemplateXlsx(req, res) {
  try {
    // Omit id and server_id: system will handle these automatically
    const headers = ['account_name', 'service_type', 'account_type', 'expire_date', 'total_devices', 'data_limit_gb', 'remark'];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="server-${req.params.serverId}-template.xlsx"`);
    try { await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, 'users', 'DOWNLOAD_TEMPLATE_XLSX', null, null]); } catch (_) {}
    return res.send(buf);
  } catch (err) {
    console.error('TEMPLATE XLSX failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Template failed' });
  }
}

// DOWNLOAD template (xlsx) for import
router.get('/server/:serverId/template\\.xlsx', authenticateToken, isServerAdminOrGlobal('serverId'), handleTemplateXlsx);
// Also provide extension-less alias to avoid proxy/extension issues
router.get('/server/:serverId/template', authenticateToken, isServerAdminOrGlobal('serverId'), handleTemplateXlsx);

// DOWNLOAD template (csv)

// EXPORT users for a server as .xlsx (ADMIN or SERVER_ADMIN for the server)
async function handleExportXlsx(req, res) {
  try {
    // rate limit
    const key = `export:${req.user?.id || 'anon'}`;
    if (!rateLimit(key, 10)) return res.status(429).json({ msg: 'Too many export requests. Please try again later.' });
    const { serverId } = req.params;
    const { rows } = await pool.query('SELECT * FROM users WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
    // Map rows to plain JS objects and normalize date fields to ISO strings
    // Omit id and server_id in export; these are managed by the system
    const data = (rows || []).map(r => ({
      account_name: r.account_name,
      service_type: r.service_type,
      account_type: r.account_type,
      expire_date: r.expire_date ? new Date(r.expire_date).toISOString().slice(0, 10) : '',
      total_devices: r.total_devices,
      data_limit_gb: r.data_limit_gb,
      remark: r.remark || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="server-${serverId}-users.xlsx"`);
    try { await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, 'users', 'EXPORT_XLSX', null, { count: data.length }]); } catch (_) {}
    return res.send(buf);
  } catch (err) {
    console.error('EXPORT XLSX failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Export failed' });
  }
}

router.get('/server/:serverId/export\\.xlsx', authenticateToken, isServerAdminOrGlobal('serverId'), handleExportXlsx);
// Also provide extension-less alias
router.get('/server/:serverId/export', authenticateToken, isServerAdminOrGlobal('serverId'), handleExportXlsx);

// IMPORT users from .xlsx for a server (ADMIN or SERVER_ADMIN for the server)
// Accepts a file field named 'file'. Rows with id present will try update; otherwise insert.
async function handleImportXlsx(req, res) {
  try {
    // rate limit
    const key = `import:${req.user?.id || 'anon'}`;
    if (!rateLimit(key, 10)) return res.status(429).json({ msg: 'Too many import requests. Please try again later.' });
    const { serverId } = req.params;
    // Import mode: 'merge' (default) or 'overwrite'
    const rawMode = (req.query.mode || req.headers['x-import-mode'] || '').toString().toLowerCase();
    const mode = rawMode === 'overwrite' ? 'overwrite' : 'merge';
    // Support clients that don't use the 'file' field name: allow picking first file from req.files
    if (!req.file && Array.isArray(req.files) && req.files.length) {
      req.file = req.files[0];
    }
    if (!req.file) {
      try { console.warn('[IMPORT] No file uploaded. content-type=%s', req.headers['content-type']); } catch (_) {}
      return res.status(400).json({ msg: 'No file uploaded', contentType: req.headers['content-type'] || null, hint: 'Send multipart/form-data with field name "file"' });
    }
  try { console.log('[IMPORT] mode=%s serverId=%s filename=%s size=%d contentType=%s', mode, req.params.serverId, req.file.originalname, req.file.size, req.file.mimetype); } catch (_) {}
    // parse workbook
  const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    // Strict header validation
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!matrix || !matrix.length) return res.status(400).json({ msg: 'Empty sheet' });
  const header = (matrix[0] || []).map(String);
  try { console.log('[IMPORT] header columns:', header); } catch (_) {}
  // Allow id and server_id if present (ignored), but do not require them
  const allowed = new Set(['id', 'server_id', 'account_name', 'service_type', 'account_type', 'expire_date', 'total_devices', 'data_limit_gb', 'remark']);
    // Require specific minimal set
    const requiredCols = ['account_name'];
    for (const c of requiredCols) { if (!header.includes(c)) return res.status(400).json({ msg: `Missing required column: ${c}` }); }
    // Reject unknown columns for strictness
    for (const c of header) { if (c && !allowed.has(c)) return res.status(400).json({ msg: `Unknown column: ${c}` }); }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  try { console.log('[IMPORT] rows count:', rows.length); } catch (_) {}
    const results = { inserted: 0, updated: 0, errors: [] };
    let excelRow = 2; // first data row

    if (mode === 'overwrite') {
      // Synchronize dataset: upsert all rows, then delete any existing users not in the import
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const importedNames = new Set();
        for (const row of rows) {
          try {
            const account_name = String(row.account_name || '').trim();
            const service_type = String(row.service_type || '').trim();
            const account_type = String(row.account_type || '').trim();
            let expire_date = row.expire_date ? new Date(row.expire_date) : null;
            if (row.expire_date && typeof row.expire_date === 'number') {
              // Excel serial date -> JS Date
              expire_date = new Date(Math.round((row.expire_date - 25569) * 86400 * 1000));
            }
            const total_devices = row.total_devices ? Number(row.total_devices) : null;
            const data_limit_gb = row.data_limit_gb ? Number(row.data_limit_gb) : null;
            const remark = typeof row.remark === 'string' ? row.remark : (row.remark == null ? '' : String(row.remark));
            if (!account_name) throw new Error('account_name is required');
            if (row.expire_date && isNaN(new Date(row.expire_date).getTime())) throw new Error('expire_date is not a valid date');
            if (row.total_devices && !Number.isFinite(Number(row.total_devices))) throw new Error('total_devices must be a number');
            if (row.data_limit_gb && !Number.isFinite(Number(row.data_limit_gb))) throw new Error('data_limit_gb must be a number');
            importedNames.add(account_name);
            // upsert by account_name within server
            const existing = await client.query('SELECT id FROM users WHERE server_id = $1 AND account_name = $2 LIMIT 1', [serverId, account_name]);
            if (existing.rows && existing.rows.length > 0) {
              const up = await client.query(
                'UPDATE users SET service_type=$1, account_type=$2, expire_date=$3, total_devices=$4, data_limit_gb=$5, remark=$6 WHERE id=$7 RETURNING id',
                [service_type, account_type, expire_date, total_devices, data_limit_gb, remark, existing.rows[0].id]
              );
              if (up.rows.length) results.updated++;
            } else {
              // compute next display_pos for the server and insert
              const pos = await client.query('SELECT COALESCE(MAX(display_pos),0) + 1 AS next_pos FROM users WHERE server_id = $1 FOR UPDATE', [serverId]);
              const nextPos = pos && pos.rows && pos.rows[0] ? pos.rows[0].next_pos : 1;
              const ins = await client.query(
                'INSERT INTO users (account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, server_id, remark, display_pos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
                [account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, serverId, remark, nextPos]
              );
              if (ins.rows.length) results.inserted++;
            }
          } catch (e) {
            results.errors.push({ rowNumber: excelRow, error: e.message || String(e) });
          }
          excelRow++;
        }
        if (results.errors.length > 0) {
          await client.query('ROLLBACK');
        } else {
          // delete any users for this server that were not in the import list
          const namesArr = Array.from(importedNames);
          await client.query('DELETE FROM users WHERE server_id = $1 AND NOT (account_name = ANY($2::text[]))', [serverId, namesArr]);
          await client.query('COMMIT');
        }
      } catch (txe) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        results.errors.push({ rowNumber: null, error: txe.message || String(txe) });
      } finally {
        client.release();
      }
    } else {
      // merge mode (default): upsert by account_name
      for (const row of rows) {
        try {
          const account_name = String(row.account_name || '').trim();
          const service_type = String(row.service_type || '').trim();
          const account_type = String(row.account_type || '').trim();
          let expire_date = row.expire_date ? new Date(row.expire_date) : null;
          if (row.expire_date && typeof row.expire_date === 'number') {
            expire_date = new Date(Math.round((row.expire_date - 25569) * 86400 * 1000));
          }
          const total_devices = row.total_devices ? Number(row.total_devices) : null;
          const data_limit_gb = row.data_limit_gb ? Number(row.data_limit_gb) : null;
          const remark = typeof row.remark === 'string' ? row.remark : (row.remark == null ? '' : String(row.remark));
          if (!account_name) throw new Error('account_name is required');
          if (row.expire_date && isNaN(new Date(row.expire_date).getTime())) throw new Error('expire_date is not a valid date');
          if (row.total_devices && !Number.isFinite(Number(row.total_devices))) throw new Error('total_devices must be a number');
          if (row.data_limit_gb && !Number.isFinite(Number(row.data_limit_gb))) throw new Error('data_limit_gb must be a number');
          const existing = await pool.query('SELECT id FROM users WHERE server_id = $1 AND account_name = $2 LIMIT 1', [serverId, account_name]);
          if (existing.rows && existing.rows.length > 0) {
            const up = await pool.query(
              'UPDATE users SET service_type=$1, account_type=$2, expire_date=$3, total_devices=$4, data_limit_gb=$5, remark=$6 WHERE id=$7 RETURNING id',
              [service_type, account_type, expire_date, total_devices, data_limit_gb, remark, existing.rows[0].id]
            );
            if (up.rows.length) results.updated++;
          } else {
            // compute next display_pos for the server and insert
            const pos = await pool.query('SELECT COALESCE(MAX(display_pos),0) + 1 AS next_pos FROM users WHERE server_id = $1', [serverId]);
            const nextPos = pos && pos.rows && pos.rows[0] ? pos.rows[0].next_pos : 1;
            const ins = await pool.query(
              'INSERT INTO users (account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, server_id, remark, display_pos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
              [account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, serverId, remark, nextPos]
            );
            if (ins.rows.length) results.inserted++;
          }
        } catch (e) {
          results.errors.push({ rowNumber: excelRow, error: e.message || String(e) });
        }
        excelRow++;
      }
    }
    try { await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, 'users', 'IMPORT_XLSX', null, { mode, inserted: results.inserted, updated: results.updated, errors: results.errors.length }]); } catch (_) {}
    return res.json({ ok: results.errors.length === 0, results, mode });
  } catch (err) {
    console.error('IMPORT XLSX failed:', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Import failed', error: err && err.message ? err.message : String(err) });
  }
}

router.post('/server/:serverId/import\\.xlsx', authenticateToken, isServerAdminOrGlobal('serverId'), upload.any(), handleImportXlsx);
// Also provide extension-less alias (still multipart)
router.post('/server/:serverId/import', authenticateToken, isServerAdminOrGlobal('serverId'), upload.any(), handleImportXlsx);

// EXPORT users as CSV

// IMPORT users from CSV

// POST a new user to a server (ADMIN or SERVER_ADMIN for the given server)
router.post('/', authenticateToken, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const {
      account_name, service_type, account_type, expire_date,
      total_devices, data_limit_gb, server_id, remark, // Added remark
    } = req.body;

    // compute next display_pos for the server (append to end)
    const posRes = await pool.query('SELECT COALESCE(MAX(display_pos),0) + 1 AS next_pos FROM users WHERE server_id = $1', [server_id]);
    const nextPos = posRes && posRes.rows && posRes.rows[0] ? posRes.rows[0].next_pos : 1;
    const newUser = await pool.query(
      'INSERT INTO users (account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, server_id, remark, display_pos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, server_id, remark, nextPos]
    );
    res.status(201).json(newUser.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// UPDATE a user (ADMIN or SERVER_ADMIN for the target user's server)
// attachUserServerId will set req.params.serverId so isServerAdminOrGlobal can validate access
router.put('/:userId', authenticateToken, attachUserServerId, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      account_name, service_type, account_type, expire_date,
      total_devices, data_limit_gb, remark, // Added remark
    } = req.body;

    // fetch existing row for audit before changing
    let beforeRow = null;
    try {
      const b = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (b && b.rows && b.rows.length) beforeRow = b.rows[0];
    } catch (e) {
      console.warn('Failed to read beforeRow for audit', e && e.message ? e.message : e);
    }

    // accept display_pos from client to preserve ordering across updates; if not provided, keep existing
    const clientPos = req.body && (typeof req.body.display_pos === 'number' ? req.body.display_pos : null);
    const updated = await pool.query(
      'UPDATE users SET account_name = $1, service_type = $2, account_type = $3, expire_date = $4, total_devices = $5, data_limit_gb = $6, remark = $7, display_pos = COALESCE($8, display_pos) WHERE id = $9 RETURNING *',
      [account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, remark, clientPos, userId]
    );
    const afterRow = updated && updated.rows && updated.rows[0] ? updated.rows[0] : null;

    // attempt to write an audit entry (non-fatal)
    try {
      await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, 'users', 'QUICK_RENEW', JSON.stringify(beforeRow || null), JSON.stringify(afterRow || null)]);
    } catch (ae) {
      console.warn('Failed to record settings_audit for user update', ae && ae.message ? ae.message : ae);
    }

    res.json(afterRow);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// DELETE a user (ADMIN or SERVER_ADMIN for the target user's server)
// attachUserServerId will set req.params.serverId so isServerAdminOrGlobal can validate access
router.delete('/:userId', authenticateToken, attachUserServerId, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const { userId } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ msg: 'User deleted' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// Fetch users across accessible servers by status (soon|expired|active)
router.get('/by-status/:status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });

    const now = new Date();
    const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let where = '';
    const values = [];
    if (status === 'expired') {
      where = 'u.expire_date < $1';
      values.push(now);
    } else if (status === 'soon') {
      where = 'u.expire_date >= $1 AND u.expire_date <= $2';
      values.push(now, soonCutoff);
    } else if (status === 'active') {
      // strictly beyond the soon cutoff => active
      where = 'u.expire_date > $2';
      values.push(now, soonCutoff);
    } else {
      return res.status(400).json({ msg: 'Invalid status' });
    }

    // Determine permitted server IDs if not admin
    let serverFilter = '';
    if (user.role !== 'ADMIN') {
      const viewer = await pool.query('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [user.id]);
      const adminPerms = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [user.id]);
      const set = new Set();
      for (const r of viewer.rows || []) set.add(r.server_id);
      for (const r of adminPerms.rows || []) set.add(r.server_id);
      const ids = Array.from(set);
      if (!ids.length) return res.json([]);
      serverFilter = ` AND u.server_id = ANY($${values.length + 1}::int[])`;
      values.push(ids);
    }

    const sql = `
      SELECT u.*, s.server_name, s.ip_address, s.domain_name
      FROM users u
      JOIN servers s ON s.id = u.server_id
      WHERE ${where}${serverFilter}
      ORDER BY u.expire_date ASC
    `;
    const { rows } = await pool.query(sql, values);
    return res.json(rows || []);
  } catch (err) {
    console.error('USERS ROUTE ERROR GET /api/users/by-status/:status :', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

module.exports = router;
