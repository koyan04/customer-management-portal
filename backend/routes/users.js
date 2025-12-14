const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const multer = require('multer');
// Allow larger import files (25 MB) to support bigger spreadsheets; still keep in-memory buffer for simplicity.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

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
const { enqueueRefresh, refreshNow } = require('../lib/matview_refresh');

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
    const headers = ['account_name', 'service_type', 'contact', 'expire_date', 'total_devices', 'data_limit_gb', 'remark'];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const { serverId } = req.params;
    // Resolve a friendly server name for filename (fallback to id)
    let serverName = null;
    try {
      const s = await pool.query('SELECT server_name FROM servers WHERE id = $1', [serverId]);
      serverName = s && s.rows && s.rows[0] ? s.rows[0].server_name : null;
    } catch (_) {}
    const safeName = (v) => {
      const base = (v && String(v).trim()) || `server-${serverId}`;
      return base
        .replace(/[\\/:*?"<>|]/g, '-')   // Windows-illegal chars
        .replace(/\s+/g, ' ')              // collapse whitespace visually
        .slice(0, 80);
    };
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(serverName)} - template.xlsx"`);
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
    // Resolve server name for filename
    let serverName = null;
    try {
      const s = await pool.query('SELECT server_name FROM servers WHERE id = $1', [serverId]);
      serverName = s && s.rows && s.rows[0] ? s.rows[0].server_name : null;
    } catch (_) {}
    const safeName = (v) => {
      const base = (v && String(v).trim()) || `server-${serverId}`;
      return base
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 80);
    };
    // Per request: export strictly ordered by display_pos (NULLS LAST), then created_at DESC for stability.
    const { rows } = await pool.query(
      `SELECT *
       FROM users
       WHERE server_id = $1
       ORDER BY (display_pos IS NULL), display_pos ASC, created_at DESC`,
      [serverId]
    );
    // Map rows to plain JS objects and normalize date fields to ISO strings
    // Omit id and server_id in export; these are managed by the system
    // Helper: format a JS Date or date-like value into YYYY-MM-DD without timezone shifts
    const fmtYMDLocal = (val) => {
      if (!val) return '';
      // If the driver already returned a string like 'YYYY-MM-DD', keep it
      const s = typeof val === 'string' ? val.trim() : null;
      if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = val instanceof Date ? val : new Date(val);
      if (Number.isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const data = (rows || []).map(r => ({
      account_name: r.account_name,
      service_type: r.service_type,
      contact: r.contact,
      expire_date: fmtYMDLocal(r.expire_date),
      total_devices: r.total_devices,
      data_limit_gb: r.data_limit_gb,
      remark: r.remark || ''
    }));
        // Build worksheet using explicit AOA so we can force date cells to be stored as plain strings.
        const headers = ['account_name','service_type','contact','expire_date','total_devices','data_limit_gb','remark'];
        const aoa = [headers];
        for (const row of data) {
          aoa.push([
            row.account_name,
            row.service_type,
            row.contact,
            typeof row.expire_date === 'string' ? row.expire_date : '', // keep as literal string YYYY-MM-DD
            row.total_devices,
            row.data_limit_gb,
            row.remark
          ]);
        }
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        // Ensure expire_date column cells are explicitly typed as strings so Excel won't reinterpret timezone
        for (let r = 1; r < aoa.length; r++) { // skip header row
          const cellRef = XLSX.utils.encode_cell({ c: 3, r }); // 0-based col index 3 = expire_date
          if (ws[cellRef]) {
            ws[cellRef].t = 's';
          }
        }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(serverName)} - users.xlsx"`);
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
  const allowed = new Set(['id', 'server_id', 'account_name', 'service_type', 'contact', 'expire_date', 'total_devices', 'data_limit_gb', 'remark']);
    // Require specific minimal set
    const requiredCols = ['account_name'];
    for (const c of requiredCols) { if (!header.includes(c)) return res.status(400).json({ msg: `Missing required column: ${c}` }); }
    // Reject unknown columns for strictness
    for (const c of header) { if (c && !allowed.has(c)) return res.status(400).json({ msg: `Unknown column: ${c}` }); }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  try { console.log('[IMPORT] rows count:', rows.length); } catch (_) {}
    const results = { inserted: 0, updated: 0, errors: [] };
    // Helpers to coerce various incoming date shapes to a date-only 'YYYY-MM-DD' string
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
    const ymdFromDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const toYMD = (val) => {
      if (!val && val !== 0) return null;
      // Excel serial number
      if (typeof val === 'number' && isFinite(val)) {
        try {
          // Prefer SheetJS SSF parser to avoid timezone shifts and handle 1900/1904 epochs
          const wbProps = (wb && wb.Workbook && wb.Workbook.WBProps) || {};
          const use1904 = !!wbProps.date1904;
          if (XLSX && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
            const parsed = XLSX.SSF.parse_date_code(val, { date1904: use1904 });
            if (parsed && parsed.y && parsed.m && parsed.d) {
              return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
            }
          }
        } catch (_) { /* fall through to fallback */ }
        // Fallback: convert serial to epoch days (assumes 1900-based epoch) and format in local time
        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
        return ymdFromDate(d);
      }
      // Date object (from xlsx with cellDates: true)
      if (val instanceof Date && !isNaN(val.getTime())) {
        return ymdFromDate(val);
      }
      // String formats we commonly see: 'YYYY-MM-DD' or 'DD/MM/YYYY'
      const s = String(val).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (ddmmyyyy) {
        const d = Number(ddmmyyyy[1]);
        const m = Number(ddmmyyyy[2]);
        const y = Number(ddmmyyyy[3]);
        if (y && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
      }
      // Fallback: try Date parsing then format as local date-only
      const d = new Date(s);
      if (!isNaN(d.getTime())) return ymdFromDate(d);
      return null;
    };
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
            const contact = String(row.contact || '').trim();
            const expire_date = toYMD(row.expire_date);
            const total_devices = row.total_devices ? Number(row.total_devices) : null;
            const data_limit_gb = row.data_limit_gb ? Number(row.data_limit_gb) : null;
            const remark = typeof row.remark === 'string' ? row.remark : (row.remark == null ? '' : String(row.remark));
            if (!account_name) throw new Error('account_name is required');
            if (row.expire_date && !expire_date) throw new Error('expire_date is not a valid date');
            if (row.total_devices && !Number.isFinite(Number(row.total_devices))) throw new Error('total_devices must be a number');
            if (row.data_limit_gb && !Number.isFinite(Number(row.data_limit_gb))) throw new Error('data_limit_gb must be a number');
            importedNames.add(account_name);
            // upsert by account_name within server
            const existing = await client.query('SELECT id FROM users WHERE server_id = $1 AND account_name = $2 LIMIT 1', [serverId, account_name]);
            if (existing.rows && existing.rows.length > 0) {
              const up = await client.query(
                'UPDATE users SET service_type=$1, contact=$2, expire_date=$3, total_devices=$4, data_limit_gb=$5, remark=$6 WHERE id=$7 RETURNING id',
                [service_type, contact, expire_date, total_devices, data_limit_gb, remark, existing.rows[0].id]
              );
              if (up.rows.length) results.updated++;
            } else {
              // compute next display_pos for the server and insert
              // Use a simple MAX(...) query to compute next display_pos. `FOR UPDATE` is invalid with aggregate
              // functions (Postgres error). We rely on the surrounding transaction to provide sufficient safety
              // for typical import workloads; if stronger concurrency guarantees are needed consider using
              // an explicit row lock or advisory locks.
              const pos = await client.query('SELECT COALESCE(MAX(display_pos),0) + 1 AS next_pos FROM users WHERE server_id = $1', [serverId]);
              const nextPos = pos && pos.rows && pos.rows[0] ? pos.rows[0].next_pos : 1;
              const ins = await client.query(
                'INSERT INTO users (account_name, service_type, contact, expire_date, total_devices, data_limit_gb, server_id, remark, display_pos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
                [account_name, service_type, contact, expire_date, total_devices, data_limit_gb, serverId, remark, nextPos]
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
          // Enqueue a background refresh of the materialized view so by-status reads see the import changes quickly.
          try {
            enqueueRefresh();
          } catch (mvErr) {
            console.warn('Enqueue matview refresh failed after overwrite import:', mvErr && mvErr.message ? mvErr.message : mvErr);
          }
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
          const contact = String(row.contact || '').trim();
          const expire_date = toYMD(row.expire_date);
          const total_devices = row.total_devices ? Number(row.total_devices) : null;
          const data_limit_gb = row.data_limit_gb ? Number(row.data_limit_gb) : null;
          const remark = typeof row.remark === 'string' ? row.remark : (row.remark == null ? '' : String(row.remark));
          if (!account_name) throw new Error('account_name is required');
          if (row.expire_date && !expire_date) throw new Error('expire_date is not a valid date');
          if (row.total_devices && !Number.isFinite(Number(row.total_devices))) throw new Error('total_devices must be a number');
          if (row.data_limit_gb && !Number.isFinite(Number(row.data_limit_gb))) throw new Error('data_limit_gb must be a number');
          const existing = await pool.query('SELECT id FROM users WHERE server_id = $1 AND account_name = $2 LIMIT 1', [serverId, account_name]);
          if (existing.rows && existing.rows.length > 0) {
            const up = await pool.query(
              'UPDATE users SET service_type=$1, contact=$2, expire_date=$3, total_devices=$4, data_limit_gb=$5, remark=$6 WHERE id=$7 RETURNING id',
              [service_type, contact, expire_date, total_devices, data_limit_gb, remark, existing.rows[0].id]
            );
            if (up.rows.length) results.updated++;
          } else {
            // compute next display_pos for the server and insert
            const pos = await pool.query('SELECT COALESCE(MAX(display_pos),0) + 1 AS next_pos FROM users WHERE server_id = $1', [serverId]);
            const nextPos = pos && pos.rows && pos.rows[0] ? pos.rows[0].next_pos : 1;
            const ins = await pool.query(
              'INSERT INTO users (account_name, service_type, contact, expire_date, total_devices, data_limit_gb, server_id, remark, display_pos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
              [account_name, service_type, contact, expire_date, total_devices, data_limit_gb, serverId, remark, nextPos]
            );
            if (ins.rows.length) results.inserted++;
          }
        } catch (e) {
          results.errors.push({ rowNumber: excelRow, error: e.message || String(e) });
        }
        excelRow++;
      }
    }
    // After a successful merge-mode import, enqueue a background matview refresh to reflect changes.
    try {
      enqueueRefresh();
    } catch (mvErr) {
      console.warn('Enqueue matview refresh failed after merge import:', mvErr && mvErr.message ? mvErr.message : mvErr);
    }
    try { await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, 'users', 'IMPORT_XLSX', null, { mode, inserted: results.inserted, updated: results.updated, errors: results.errors.length }]); } catch (_) {}
    // Log the final import results for easier debugging in dev environments
    try {
      console.log('[IMPORT] results summary:', JSON.stringify({ mode, inserted: results.inserted, updated: results.updated, errors: results.errors.length }));
      if (results.errors && results.errors.length) console.log('[IMPORT] errors:', JSON.stringify(results.errors.slice(0, 10)));
    } catch (le) { /* ignore logging failures */ }
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
      account_name, service_type, contact, expire_date,
      total_devices, data_limit_gb, server_id, remark, // Added remark
    } = req.body;

    // compute next display_pos for the server (append to end)
    const posRes = await pool.query('SELECT COALESCE(MAX(display_pos),0) + 1 AS next_pos FROM users WHERE server_id = $1', [server_id]);
    const nextPos = posRes && posRes.rows && posRes.rows[0] ? posRes.rows[0].next_pos : 1;
    const newUser = await pool.query(
      'INSERT INTO users (account_name, service_type, contact, expire_date, total_devices, data_limit_gb, server_id, remark, display_pos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [account_name, service_type, contact, expire_date, total_devices, data_limit_gb, server_id, remark, nextPos]
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
      account_name, service_type, contact, expire_date,
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
      'UPDATE users SET account_name = $1, service_type = $2, contact = $3, expire_date = $4, total_devices = $5, data_limit_gb = $6, remark = $7, display_pos = COALESCE($8, display_pos) WHERE id = $9 RETURNING *',
      [account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, clientPos, userId]
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

// PATCH toggle enabled flag for a user (ADMIN or SERVER_ADMIN for the target user's server)
// Body: { enabled: boolean }
router.patch('/:userId/enabled', authenticateToken, attachUserServerId, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ msg: 'enabled must be a boolean' });
    }

    // fetch existing row for audit
    let beforeRow = null;
    try {
      const b = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (b && b.rows && b.rows.length) beforeRow = b.rows[0];
    } catch (_) {}

    const updated = await pool.query('UPDATE users SET enabled = $1 WHERE id = $2 RETURNING *', [enabled, userId]);
    const afterRow = updated && updated.rows && updated.rows[0] ? updated.rows[0] : null;

    // write audit entry (non-fatal)
    try {
      await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [req.user?.id || null, 'users', 'TOGGLE_ENABLED', JSON.stringify(beforeRow || null), JSON.stringify(afterRow || null)]);
    } catch (_) {}

    // If using materialized views for status, enqueue refresh to reflect enabled state changes quickly
    try { enqueueRefresh(); } catch (_) {}

    return res.json(afterRow);
  } catch (err) {
    console.error('Toggle enabled failed:', err && err.message ? err.message : err);
    return res.status(500).json({ msg: 'Server Error' });
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

    // Use end-of-day cutoff: cutoff = (expire_date::date + interval '1 day') at 00:00
    // expired: cutoff <= now(); soon: now() < cutoff <= now()+24h; active: cutoff > now()+24h
    let where = '';
    const values = [];
    if (status === 'expired') {
      where = '(u.expire_date::date + interval \u00271 day\u0027) <= now()';
    } else if (status === 'soon') {
      where = '(u.expire_date::date + interval \u00271 day\u0027) > now() AND (u.expire_date::date + interval \u00271 day\u0027) <= now() + interval \u00271 day\u0027';
    } else if (status === 'active') {
      where = '(u.expire_date::date + interval \u00271 day\u0027) > now() + interval \u00271 day\u0027';
    } else {
      return res.status(400).json({ msg: 'Invalid status' });
    }

    // Helper: run a query with a few retries on transient errors
    const runWithRetries = async (sqlText, params = [], attempts = 3) => {
      let lastErr = null;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          if (attempt > 1) console.warn(`[DB RETRY] attempt ${attempt} for query`);
          const r = await pool.query(sqlText, params);
          return r;
        } catch (e) {
          lastErr = e;
          // check for common transient error codes
          const transient = e && (e.code === '40001' || e.code === '40P01' || e.code === '55P03' || e.code === '57P01');
          if (!transient) break;
          const waitMs = 50 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, waitMs));
        }
      }
      throw lastErr;
    };

  // Determine permitted server IDs if not admin
    let serverFilter = '';
    let ids = null;
    if (user.role !== 'ADMIN') {
      try {
        const viewer = await runWithRetries('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [user.id]);
        const adminPerms = await runWithRetries('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [user.id]);
        const set = new Set();
        for (const r of viewer.rows || []) set.add(r.server_id);
        for (const r of adminPerms.rows || []) set.add(r.server_id);
        ids = Array.from(set);
        if (!ids.length) return res.json([]);
        serverFilter = ` AND u.server_id = ANY($${values.length + 1}::int[])`;
        values.push(ids);
      } catch (permErr) {
        console.error('Permission lookup failed in by-status route:', permErr && permErr.stack ? permErr.stack : permErr);
        return res.status(500).json({ msg: 'Server Error' });
      }
    }

    // Feature flag: allow toggling usage of the materialized view for by-status queries.
    const useMatview = (() => {
      const v = String(process.env.USE_USER_STATUS_MATVIEW || '').trim().toLowerCase();
      return v === '1' || v === 'true' || v === 'yes' || v === 'on';
    })();

    // If enabled and we have a materialized view available, prefer reading from it for faster by-status queries.
    if (useMatview) {
      try {
        const mvCheck = await pool.query("SELECT to_regclass('public.user_status_matview') AS name");
        if (mvCheck && mvCheck.rows && mvCheck.rows[0] && mvCheck.rows[0].name) {
          // Build a safe query against the matview. If the user is not admin, restrict by accessible server ids.
          let mvSql = 'SELECT mv.* FROM user_status_matview mv JOIN users u ON u.id = mv.id WHERE mv.status = $1 AND u.enabled = TRUE';
          const mvValues = [status];
          if (user.role !== 'ADMIN') {
            mvSql += ` AND mv.server_id = ANY($2::int[])`;
            mvValues.push(ids);
          }
          mvSql += ' ORDER BY mv.expire_date ASC';
          try {
            const mvRes = await runWithRetries(mvSql, mvValues);
            return res.json(mvRes.rows || []);
          } catch (mvReadErr) {
            // If reading the materialized view fails for some reason, fall through to the live query below.
            console.warn('Reading from user_status_matview failed, falling back to live query:', mvReadErr && mvReadErr.message ? mvReadErr.message : mvReadErr);
          }
        }
      } catch (mvErr) {
        // if check failed, log and continue to live query
        console.warn('Materialized view existence check failed:', mvErr && mvErr.message ? mvErr.message : mvErr);
      }
    }

    const sql = `
      SELECT u.*, s.server_name, s.ip_address, s.domain_name
      FROM users u
      JOIN servers s ON s.id = u.server_id
      WHERE ${where} AND u.enabled = TRUE${serverFilter}
      ORDER BY u.expire_date ASC
    `;

    try {
      const result = await runWithRetries(sql, values);
      return res.json(result.rows || []);
    } catch (qErr) {
      console.error('Primary by-status query failed:', qErr && qErr.stack ? qErr.stack : qErr);
      // Fallback: aggregate per-server user lists and filter in JS.
      try {
        // fetch accessible servers
        let serversRows = [];
        if (user.role === 'ADMIN') {
          const sres = await runWithRetries('SELECT id, server_name, ip_address, domain_name FROM servers', []);
          serversRows = sres.rows || [];
        } else {
          const sres = await runWithRetries('SELECT id, server_name, ip_address, domain_name FROM servers WHERE id = ANY($1::int[])', [ids || []]);
          serversRows = sres.rows || [];
        }
        const results = [];
        for (const s of serversRows) {
          try {
            const ur = await runWithRetries('SELECT * FROM users WHERE server_id = $1 AND enabled = TRUE', [s.id]);
            const users = ur.rows || [];
            for (const u of users) results.push({ ...u, server_name: s.server_name, ip_address: s.ip_address, domain_name: s.domain_name });
          } catch (e) {
            console.warn('Failed to fetch users for server', s.id, e && e.message ? e.message : e);
          }
        }
        const now2 = new Date();
        const soonCutoff2 = new Date(now2.getTime() + 24 * 60 * 60 * 1000);
        const parseCutoff = (val) => {
          if (!val) return null;
          try {
            const s = String(val);
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m) { const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]); return new Date(y, mo - 1, d + 1, 0, 0, 0, 0); }
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
          } catch (_) {}
          return null;
        };
        const filtered = results.filter(u => {
          const cutoff = parseCutoff(u && u.expire_date);
          if (!cutoff) return false;
          if (status === 'expired') return cutoff.getTime() <= now2.getTime();
          if (status === 'soon') return cutoff.getTime() > now2.getTime() && cutoff.getTime() <= soonCutoff2.getTime();
          if (status === 'active') return cutoff.getTime() > soonCutoff2.getTime();
          return false;
        }).sort((a, b) => new Date(a.expire_date) - new Date(b.expire_date));
        return res.json(filtered);
      } catch (fbErr) {
        console.error('Fallback aggregation for by-status also failed:', fbErr && fbErr.stack ? fbErr.stack : fbErr);
        return res.status(500).json({ msg: 'Server Error' });
      }
    }
  } catch (err) {
    console.error('USERS ROUTE ERROR GET /api/users/by-status/:status :', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// SEARCH users across accessible servers by partial account_name (case-insensitive)
// GET /api/users/search?q=term
// Returns at most 100 matches ordered by account_name ASC
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || String(q).trim().length < 2) {
      return res.status(400).json({ msg: 'Query must be at least 2 characters' });
    }
    const term = String(q).trim();
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    const fuzzy = (() => { const v = String(req.query.fuzzy || '').toLowerCase(); return v === '1' || v === 'true' || v === 'yes'; })();
    // Determine accessible server IDs for non-admin
    let serverFilterSql = '';
    let serverFilterParams = [];
    if (user.role !== 'ADMIN') {
      try {
        const viewer = await pool.query('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [user.id]);
        const adminPerms = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [user.id]);
        const set = new Set();
        for (const r of viewer.rows || []) set.add(r.server_id);
        for (const r of adminPerms.rows || []) set.add(r.server_id);
        const ids = Array.from(set);
        if (!ids.length) return res.json([]);
        serverFilterSql = ' AND u.server_id = ANY($2::int[])';
        serverFilterParams.push(ids);
      } catch (e) {
        console.error('search permission lookup failed:', e && e.message ? e.message : e);
        return res.status(500).json({ msg: 'Server Error' });
      }
    }
    // Use ILIKE for case-insensitive match; escape % and _ minimally
    const likeTerm = '%' + term.replace(/[%_]/g, s => '\\' + s) + '%';
    const params = user.role === 'ADMIN' ? [likeTerm] : [likeTerm, ...serverFilterParams];
    // If fuzzy requested, attempt pg_trgm similarity; fallback on basic search when extension not available.
    const computeStatus = (exp, enabled) => {
      if (enabled === false) return 'disabled';
      if (!exp) return 'active';
      try {
        const dt = new Date(exp);
        if (Number.isNaN(dt.getTime())) return 'active';
        const now = new Date();
        const cutoff = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
        if (cutoff.getTime() <= now.getTime()) return 'expired';
        const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        if (cutoff.getTime() <= soonCutoff.getTime()) return 'soon';
        return 'active';
      } catch (_) { return 'active'; }
    };
    if (fuzzy) {
      try {
        const fuzzyParams = user.role === 'ADMIN' ? [term, likeTerm] : [term, likeTerm, ...serverFilterParams];
        const fuzzyFilterServer = user.role === 'ADMIN' ? '' : ' AND u.server_id = ANY($3::int[])';
        const fuzzySql = `
          SELECT u.id, u.account_name, u.service_type, u.contact, u.expire_date, u.total_devices, u.data_limit_gb, u.server_id, u.remark, u.display_pos, u.enabled, s.server_name,
            similarity(u.account_name, $1) AS sim
          FROM users u
          JOIN servers s ON s.id = u.server_id
          WHERE (u.account_name ILIKE $2 OR similarity(u.account_name, $1) > 0.2)${fuzzyFilterServer}
          ORDER BY sim DESC, u.account_name ASC
          LIMIT 100
        `;
        const fuzzyRes = await pool.query(fuzzySql, fuzzyParams);
        return res.json((fuzzyRes.rows || []).map(r => ({ ...r, status: computeStatus(r.expire_date, r.enabled) })));
      } catch (e) {
        console.warn('Fuzzy search failed (falling back to basic):', e && e.message ? e.message : e);
        // Fallback fuzzy approach: broaden pattern by inserting wildcards between characters (j%o%h%n for "john")
        const broadenPattern = '%' + term.split('').map(ch => ch.replace(/[%_]/, '')).join('%') + '%';
        // Additional heuristic: prefix pattern (first 3 chars) to catch names like "johanna" when searching "john"
        const prefixPattern = term.slice(0, 3) + '%';
        // Build params dynamically so we can reference positions easily
        const broadenParams = user.role === 'ADMIN'
          ? [broadenPattern, likeTerm, prefixPattern]
          : [broadenPattern, likeTerm, prefixPattern, ...serverFilterParams];
        // server filter index depends on role; if not admin it will be the last param
        const broadenFilterServer = user.role === 'ADMIN' ? '' : ` AND u.server_id = ANY($${broadenParams.length}::int[])`;
        try {
          const broadenSql = `
            SELECT u.id, u.account_name, u.service_type, u.contact, u.expire_date, u.total_devices, u.data_limit_gb, u.server_id, u.remark, u.display_pos, u.enabled, s.server_name
            FROM users u
            JOIN servers s ON s.id = u.server_id
            WHERE (u.account_name ILIKE $1 OR u.account_name ILIKE $2 OR u.account_name ILIKE $3)${broadenFilterServer}
            ORDER BY u.account_name ASC
            LIMIT 100
          `;
          const brRes = await pool.query(broadenSql, broadenParams);
          try { console.log('Fuzzy broaden debug', { term, broadenPattern, prefixPattern, names: (brRes.rows||[]).map(r=>r.account_name) }); } catch(_) {}
          return res.json((brRes.rows || []).map(r => ({ ...r, status: computeStatus(r.expire_date, r.enabled) })));
        } catch (e2) {
          console.warn('Broaden fuzzy fallback also failed, continuing to basic search:', e2 && e2.message ? e2.message : e2);
        }
      }
    }
    const sqlBasic = `
      SELECT u.id, u.account_name, u.service_type, u.contact, u.expire_date, u.total_devices, u.data_limit_gb, u.server_id, u.remark, u.display_pos, u.enabled, s.server_name
      FROM users u
      JOIN servers s ON s.id = u.server_id
      WHERE LOWER(u.account_name) ILIKE LOWER($1)${serverFilterSql}
      ORDER BY u.account_name ASC
      LIMIT 100
    `;
    const { rows } = await pool.query(sqlBasic, params);
    return res.json((rows || []).map(r => ({ ...r, status: computeStatus(r.expire_date, r.enabled) })));
  } catch (err) {
    console.error('USERS ROUTE ERROR GET /api/users/search :', err && err.stack ? err.stack : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
});

// Admin endpoint to trigger a manual matview refresh (non-blocking enqueue)
// Note: this is intentionally admin-only.
router.post('/admin/refresh-user-status', authenticateToken, isAdmin, async (req, res) => {
  try {
    enqueueRefresh();
    return res.status(202).json({ msg: 'Refresh enqueued' });
  } catch (e) {
    console.error('Admin matview enqueue failed:', e && e.message ? e.message : e);
    return res.status(500).json({ msg: 'Failed to enqueue refresh' });
  }
});

// Transfer users between servers (ADMIN or SERVER_ADMIN with permissions)
router.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { userIds, targetServerId } = req.body;
    
    // Validate inputs
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ msg: 'userIds must be a non-empty array' });
    }
    if (!targetServerId || Number.isNaN(Number(targetServerId))) {
      return res.status(400).json({ msg: 'Invalid target server ID' });
    }

    // Verify target server exists
    const serverCheck = await pool.query('SELECT id FROM servers WHERE id = $1', [targetServerId]);
    if (!serverCheck.rows || serverCheck.rows.length === 0) {
      return res.status(404).json({ msg: 'Target server not found' });
    }

    // Authorization check: ADMIN can transfer anyone, SERVER_ADMIN can only transfer users from/to servers they manage
    if (req.user.role !== 'ADMIN') {
      // Check if user has permission for target server
      const targetPermCheck = await pool.query(
        'SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2',
        [req.user.id, targetServerId]
      );
      if (!targetPermCheck.rows || targetPermCheck.rows.length === 0) {
        return res.status(403).json({ msg: 'You do not have permission to transfer users to this server' });
      }

      // Check if user has permission for all source servers
      const sourceServersQuery = await pool.query(
        'SELECT DISTINCT server_id FROM users WHERE id = ANY($1::int[])',
        [userIds]
      );
      const sourceServerIds = sourceServersQuery.rows.map(r => r.server_id);
      
      if (sourceServerIds.length > 0) {
        const sourcePermCheck = await pool.query(
          'SELECT server_id FROM server_admin_permissions WHERE admin_id = $1 AND server_id = ANY($2::int[])',
          [req.user.id, sourceServerIds]
        );
        const allowedSourceServers = sourcePermCheck.rows.map(r => r.server_id);
        
        // Check if all source servers are in allowed list
        const unauthorizedServers = sourceServerIds.filter(sid => !allowedSourceServers.includes(sid));
        if (unauthorizedServers.length > 0) {
          return res.status(403).json({ 
            msg: 'You do not have permission to transfer users from some of the source servers',
            unauthorizedServers 
          });
        }
      }
    }

    // Get current max display_pos for target server
    const posRes = await pool.query('SELECT COALESCE(MAX(display_pos), 0) AS max_pos FROM users WHERE server_id = $1', [targetServerId]);
    let nextPos = posRes && posRes.rows && posRes.rows[0] ? (posRes.rows[0].max_pos || 0) + 1 : 1;

    // Transfer users in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const transferredUsers = [];
      for (const userId of userIds) {
        // Fetch user before transfer for audit
        const beforeResult = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (!beforeResult.rows || beforeResult.rows.length === 0) {
          console.warn(`User ${userId} not found, skipping`);
          continue;
        }
        const beforeRow = beforeResult.rows[0];

        // Update user's server_id and assign new display_pos
        const updateResult = await client.query(
          'UPDATE users SET server_id = $1, display_pos = $2 WHERE id = $3 RETURNING *',
          [targetServerId, nextPos, userId]
        );
        
        if (updateResult.rows && updateResult.rows.length > 0) {
          const afterRow = updateResult.rows[0];
          transferredUsers.push(afterRow);
          
          // Write audit entry
          try {
            await client.query(
              'INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1, $2, $3, $4, $5)',
              [req.user?.id || null, 'users', 'TRANSFER', JSON.stringify(beforeRow), JSON.stringify(afterRow)]
            );
          } catch (ae) {
            console.warn('Failed to record audit for user transfer', ae && ae.message ? ae.message : ae);
          }
          
          nextPos++;
        }
      }

      await client.query('COMMIT');
      
      return res.json({ 
        msg: `Successfully transferred ${transferredUsers.length} user(s)`,
        transferred: transferredUsers.length,
        users: transferredUsers
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('User transfer error:', err.message);
    return res.status(500).json({ msg: 'Server Error during transfer' });
  }
});

module.exports = router;
