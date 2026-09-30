// Login throttling and account lockout.
//
// Purpose: make online password guessing impractical. Two independent layers:
//
//  1. PER-IP throttle  — an in-memory sliding window, so one host cannot spray
//     the login endpoint regardless of which usernames it targets.
//  2. PER-ACCOUNT lockout — persisted in Postgres, so a lockout survives a
//     service restart and is shared across every source IP. This is what stops
//     a slow, distributed guessing attack that stays under the per-IP limit.
//
// Both layers fail OPEN on error: a database or logic problem must never be the
// reason a legitimate administrator cannot sign in.

const pool = require('../db');

// ── Tunables ───────────────────────────────────────────────────────────────
const IP_MAX_ATTEMPTS   = 10;   // per window, per IP
const IP_WINDOW_MS      = 15 * 60 * 1000;
const ACCOUNT_MAX_FAILS = 8;    // consecutive failures before lockout
const ACCOUNT_LOCK_MS   = 15 * 60 * 1000;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000; // failures older than this do not count
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;  // evict stale IP buckets

// ── Per-IP sliding window (in-memory) ──────────────────────────────────────
const _ipBuckets = new Map(); // ip -> { count, resetAt }

// Proxy-aware client IP. Trust X-Forwarded-For only when the app sits behind a
// proxy that sets it (it does, via nginx); otherwise req.ip is the peer.
function clientIp(req) {
  try {
    const xff = req.headers && req.headers['x-forwarded-for'];
    if (xff) {
      const first = String(xff).split(',')[0].trim();
      if (first) return first;
    }
    return (req.ip || (req.connection && req.connection.remoteAddress) || 'unknown').toString();
  } catch (_) {
    return 'unknown';
  }
}

function ipBlocked(ip) {
  try {
    const now = Date.now();
    const b = _ipBuckets.get(ip);
    if (!b) return null;
    if (b.resetAt <= now) { _ipBuckets.delete(ip); return null; }
    // Allow exactly IP_MAX_ATTEMPTS requests through in the window; refuse the
    // next one. The Nth failure is recorded and still answered normally, so an
    // attacker gets IP_MAX_ATTEMPTS guesses, not IP_MAX_ATTEMPTS-1.
    if (b.count >= IP_MAX_ATTEMPTS) {
      return { retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
    }
    return null;
  } catch (_) {
    return null; // fail open
  }
}

function ipRecordFailure(ip) {
  try {
    const now = Date.now();
    const b = _ipBuckets.get(ip);
    if (!b || b.resetAt <= now) {
      _ipBuckets.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    } else {
      b.count += 1;
    }
  } catch (_) {}
}

function ipClear(ip) {
  try { _ipBuckets.delete(ip); } catch (_) {}
}

// Periodic sweep so the map cannot grow without bound.
try {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of _ipBuckets) {
      if (b.resetAt <= now) _ipBuckets.delete(ip);
    }
  }, SWEEP_INTERVAL_MS);
  if (t && typeof t.unref === 'function') t.unref(); // never hold the process open
} catch (_) {}

// ── Per-account lockout (Postgres, restart-proof) ──────────────────────────
async function ensureLockTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_lockouts (
        username text PRIMARY KEY,
        failed_count integer NOT NULL DEFAULT 0,
        first_fail_at timestamp with time zone,
        last_fail_at timestamp with time zone,
        locked_until timestamp with time zone
      )
    `);
    return true;
  } catch (e) {
    console.warn('[authGuard] could not ensure login_lockouts table:', e && e.message);
    return false;
  }
}

// Returns { locked: true, retryAfterSec } when the account is locked out.
async function accountLockInfo(username) {
  if (!username) return null;
  try {
    const r = await pool.query(
      'SELECT locked_until FROM login_lockouts WHERE username = $1', [String(username)]
    );
    if (!r.rows || !r.rows.length) return null;
    const until = r.rows[0].locked_until ? new Date(r.rows[0].locked_until).getTime() : 0;
    if (until && until > Date.now()) {
      return { locked: true, retryAfterSec: Math.ceil((until - Date.now()) / 1000) };
    }
    return null;
  } catch (_) {
    return null; // fail open
  }
}

async function accountRecordFailure(username) {
  if (!username) return null;
  try {
    const now = new Date();
    const r = await pool.query(
      `INSERT INTO login_lockouts (username, failed_count, first_fail_at, last_fail_at)
       VALUES ($1, 1, $2, $2)
       ON CONFLICT (username) DO UPDATE SET
         failed_count = CASE
           WHEN login_lockouts.last_fail_at IS NOT NULL
            AND login_lockouts.last_fail_at < $2::timestamptz - ($3 || ' milliseconds')::interval
           THEN 1
           ELSE login_lockouts.failed_count + 1
         END,
         first_fail_at = CASE
           WHEN login_lockouts.last_fail_at IS NOT NULL
            AND login_lockouts.last_fail_at < $2::timestamptz - ($3 || ' milliseconds')::interval
           THEN $2
           ELSE COALESCE(login_lockouts.first_fail_at, $2)
         END,
         last_fail_at = $2,
         locked_until = CASE
           WHEN (CASE
             WHEN login_lockouts.last_fail_at IS NOT NULL
              AND login_lockouts.last_fail_at < $2::timestamptz - ($3 || ' milliseconds')::interval
             THEN 1
             ELSE login_lockouts.failed_count + 1
           END) >= $4
           THEN $2::timestamptz + ($5 || ' milliseconds')::interval
           ELSE NULL
         END
       RETURNING failed_count, locked_until`,
      [String(username), now, String(ACCOUNT_WINDOW_MS), ACCOUNT_MAX_FAILS, String(ACCOUNT_LOCK_MS)]
    );
    const row = (r.rows && r.rows[0]) || null;
    if (row && row.locked_until) {
      const until = new Date(row.locked_until).getTime();
      if (until > Date.now()) {
        return { locked: true, retryAfterSec: Math.ceil((until - Date.now()) / 1000), failedCount: row.failed_count };
      }
    }
    return row ? { locked: false, failedCount: row.failed_count } : null;
  } catch (e) {
    console.warn('[authGuard] accountRecordFailure failed:', e && e.message);
    return null;
  }
}

async function accountClearFailures(username) {
  if (!username) return;
  try {
    await pool.query('DELETE FROM login_lockouts WHERE username = $1', [String(username)]);
  } catch (_) {}
}

// Administrative unlock, used when an admin resets a password.
async function accountUnlock(username) {
  return accountClearFailures(username);
}

// ── Express middleware for the login route ────────────────────────────────
function loginGuard() {
  return async function loginGuardMiddleware(req, res, next) {
    try {
      const ip = clientIp(req);
      const username = (req.body && req.body.username) ? String(req.body.username) : null;

      // Layer 1: per-IP.
      const ipState = ipBlocked(ip);
      if (ipState) {
        try { res.set('Retry-After', String(ipState.retryAfterSec)); } catch (_) {}
        return res.status(429).json({
          error: 'Too many login attempts',
          msg: `Too many login attempts. Try again in ${Math.ceil(ipState.retryAfterSec / 60)} minute(s).`
        });
      }

      // Layer 2: per-account.
      const acct = await accountLockInfo(username);
      if (acct && acct.locked) {
        try { res.set('Retry-After', String(acct.retryAfterSec)); } catch (_) {}
        return res.status(429).json({
          error: 'Account temporarily locked',
          msg: `Too many failed attempts for this account. Try again in ${Math.ceil(acct.retryAfterSec / 60)} minute(s).`
        });
      }
      return next();
    } catch (_) {
      return next(); // fail open
    }
  };
}

// Call after a failed login attempt.
function noteFailure(req, username) {
  try { ipRecordFailure(clientIp(req)); } catch (_) {}
  return accountRecordFailure(username);
}

// Call after a successful login.
function noteSuccess(req, username) {
  try { ipClear(clientIp(req)); } catch (_) {}
  return accountClearFailures(username);
}

module.exports = {
  loginGuard,
  noteFailure,
  noteSuccess,
  accountUnlock,
  accountLockInfo,
  ensureLockTable,
  clientIp,
  IP_MAX_ATTEMPTS,
  IP_WINDOW_MS,
  ACCOUNT_MAX_FAILS,
  ACCOUNT_LOCK_MS,
  _resetIpBucketsForTest: () => { _ipBuckets.clear(); },
  _ipBucketCountForTest: () => _ipBuckets.size,
};
