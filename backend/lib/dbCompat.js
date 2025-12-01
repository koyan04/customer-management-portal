// Small compatibility helper to detect presence of columns and cache results.
const cache = new Map();

async function hasColumn(pool, tableName, columnName) {
  const key = `${tableName}::${columnName}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const sql = `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`;
    const r = await pool.query(sql, [String(tableName), String(columnName)]);
    const ok = !!(r.rows && r.rows.length > 0);
    cache.set(key, ok);
    return ok;
  } catch (e) {
    // On error assume column missing to avoid breaking callers
    try { cache.set(key, false); } catch (_) {}
    return false;
  }
}

module.exports = { hasColumn };
