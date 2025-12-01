const DEFAULT_LOCK_KEY = 1234567890;

function createHelpers(pool, dbCompat) {
  async function fetchServerById(id) {
    try {
      const r = await pool.query('SELECT id, server_name, ip_address, domain_name, owner FROM servers WHERE id = $1', [id]);
      return (r.rows && r.rows[0]) || null;
    } catch (e) {
      console.error('fetchServerById failed:', e && e.message ? e.message : e);
      return null;
    }
  }

  async function fetchUsersByServer(serverId) {
    try {
      const hasStatus = dbCompat && typeof dbCompat.hasColumn === 'function' ? await dbCompat.hasColumn(pool, 'users', 'status') : false;
      const cols = hasStatus ? 'id, account_name, service_type, expire_date, status' : 'id, account_name, service_type, expire_date';
      const r = await pool.query(`SELECT ${cols} FROM users WHERE server_id = $1 ORDER BY expire_date ASC`, [serverId]);
      return r.rows || [];
    } catch (e) {
      console.error('fetchUsersByServer failed:', e && e.message ? e.message : e);
      return [];
    }
  }

  async function fetchUserById(id) {
    try {
      const r = await pool.query('SELECT u.*, s.server_name FROM users u JOIN servers s ON s.id = u.server_id WHERE u.id = $1', [id]);
      return (r.rows && r.rows[0]) || null;
    } catch (e) {
      console.error('fetchUserById failed:', e && e.message ? e.message : e);
      return null;
    }
  }

  async function applyExtendExpire(userId, months, actor) {
    try {
      const m = Number(months) || 0;
      if (m <= 0) return null;
      // Capture previous expire_date for audit
      const beforeRes = await pool.query('SELECT expire_date FROM users WHERE id = $1', [userId]);
      const before = beforeRes.rows && beforeRes.rows[0] ? beforeRes.rows[0].expire_date : null;
      const sql = `UPDATE users SET expire_date = (COALESCE(expire_date, now()) + (interval '${m} month')) WHERE id = $1 RETURNING expire_date, account_name`;
      const r = await pool.query(sql, [userId]);
      const afterRow = (r.rows && r.rows[0]) || null;
      // Insert audit record if audit table exists (best-effort)
      try {
        await pool.query('INSERT INTO telegram_bot_expire_audit(user_id, months, actor, old_expire, new_expire, created_at) VALUES($1,$2,$3,$4,$5,now())', [userId, m, actor || null, before, afterRow ? afterRow.expire_date : null]);
      } catch (auditErr) {
        // Non-fatal: table may not exist in older schemas
        // Log at debug level to keep normal logs clean
        console.debug('telegram expire audit insert skipped:', auditErr && auditErr.message ? auditErr.message : auditErr);
      }
      return afterRow;
    } catch (e) {
      console.error('applyExtendExpire failed:', e && e.message ? e.message : e);
      return null;
    }
  }

  return { fetchServerById, fetchUsersByServer, fetchUserById, applyExtendExpire };
}

module.exports = { createHelpers, DEFAULT_LOCK_KEY };
