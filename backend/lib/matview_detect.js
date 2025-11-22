// Dynamic detection of materialized view support for user status.
// Provides consistent logic across endpoints: servers summary, health, admin status.
// Precedence rules:
//   1. If USE_USER_STATUS_MATVIEW is an explicit disabling value (0,false,off,no) => enabled false.
//   2. If USE_USER_STATUS_MATVIEW is an explicit enabling value (1,true,on,yes) => enabled true if matview exists, else false.
//      (Logs a warning if enabled but matview missing.)
//   3. If USE_USER_STATUS_MATVIEW is unset/empty => auto-enable only if matview exists AND unique index present (concurrent refresh capable).
// The detection queries are lightweight. A simple in-memory cache reduces DB load.

const CACHE_TTL_MS = 30_000; // 30s reuse
let cache = null; // { ts, key, value }

function envRaw() {
  return String(process.env.USE_USER_STATUS_MATVIEW || '').trim().toLowerCase();
}

function parseEnvFlag() {
  const raw = envRaw();
  if (!raw) return null; // treat empty as auto-detect
  if (['0','false','off','no'].includes(raw)) return false;
  if (['1','true','on','yes'].includes(raw)) return true;
  return null; // unknown value -> auto-detect
}

async function querySupport(pool) {
  let exists = false;
  let uniqueIndex = false;
  try {
    const mv = await pool.query("SELECT to_regclass('public.user_status_matview') AS name");
    exists = !!(mv.rows && mv.rows[0] && mv.rows[0].name);
  } catch (e) {
    // existence check failed; keep exists=false
  }
  if (exists) {
    try {
      const iq = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON c.oid = i.indrelid JOIN pg_class ic ON i.indexrelid = ic.oid WHERE c.relname = 'user_status_matview' AND ic.relname = 'user_status_matview_id_unique_idx' AND i.indisunique = true) AS has_unique");
      uniqueIndex = iq.rows && iq.rows[0] ? !!iq.rows[0].has_unique : false;
    } catch (e) {
      uniqueIndex = false;
    }
  }
  const concurrentSupported = exists && uniqueIndex;
  return { exists, uniqueIndex, concurrentSupported };
}

async function detectMatviewSupport(pool) {
  const now = Date.now();
  const key = envRaw();
  const isTest = String(process.env.NODE_ENV || '').toLowerCase() === 'test';
  if (!isTest && cache && cache.key === key && (now - cache.ts) < CACHE_TTL_MS) {
    return cache.value;
  }
  const envFlag = parseEnvFlag();
  const support = await querySupport(pool);
  let enabled;
  if (envFlag === false) {
    enabled = false;
  } else if (envFlag === true) {
    enabled = support.exists; // still require existence
    if (envFlag === true && !support.exists) {
      console.warn('[matview] USE_USER_STATUS_MATVIEW explicitly enabled but matview missing. Apply migrations.');
    }
  } else {
    // auto-detect mode
    enabled = support.concurrentSupported; // only enable when concurrent refresh possible
  }
  const value = { enabled, exists: support.exists, uniqueIndex: support.uniqueIndex, concurrentSupported: support.concurrentSupported, mode: envFlag === null ? 'auto' : (envFlag ? 'forced-on' : 'forced-off') };
  if (!isTest) cache = { ts: now, key, value };
  return value;
}

module.exports = { detectMatviewSupport };
