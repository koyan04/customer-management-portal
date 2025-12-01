const pool = require('../db');

// Simple coalescing in-process refresher for the user_status_matview.
// Behavior:
// - enqueueRefresh() schedules a refresh in the background and returns immediately.
// - If a refresh is already running, subsequent enqueues will be coalesced into one run.
// - refreshNow() performs a refresh immediately and returns a Promise that resolves/rejects.

let isRunning = false;
let pending = false;

async function doRefresh() {
  try {
    isRunning = true;
    pending = false;
    // Try concurrent refresh first to minimize locking. If that fails (no unique index
    // or other constraint), fall back to a regular refresh.
    let succeeded = false;
    try {
      await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY user_status_matview');
      console.log('[MATVIEW] user_status_matview refreshed (CONCURRENTLY)');
      succeeded = true;
    } catch (concurrentErr) {
      console.warn('[MATVIEW] CONCURRENT refresh failed, falling back to regular REFRESH:', concurrentErr && concurrentErr.message ? concurrentErr.message : concurrentErr);
      try {
        await pool.query('REFRESH MATERIALIZED VIEW user_status_matview');
        console.log('[MATVIEW] user_status_matview refreshed (regular)');
        succeeded = true;
      } catch (regularErr) {
        console.warn('[MATVIEW] regular refresh failed:', regularErr && regularErr.message ? regularErr.message : regularErr);
        throw regularErr;
      }
    }
    // Persist last success timestamp (best-effort; do not throw if this fails)
    if (succeeded) {
      try {
        await pool.query("INSERT INTO app_settings(settings_key,data) VALUES('user_status_matview_refresh', json_build_object('last_success', now())) ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data");
      } catch (persistErr) {
        console.warn('[MATVIEW] failed to persist last_success timestamp:', persistErr && persistErr.message ? persistErr.message : persistErr);
      }
    }
  } catch (e) {
    console.warn('[MATVIEW] refresh failed:', e && e.message ? e.message : e);
    throw e;
  } finally {
    isRunning = false;
    // If an enqueue happened while we were running, run again immediately to catch up.
    if (pending) {
      setImmediate(() => {
        doRefresh().catch(err => console.warn('[MATVIEW] background refresh failed on catch-up:', err && err.message ? err.message : err));
      });
    }
  }
}

function enqueueRefresh() {
  // mark that a refresh is pending, and start one if none is running
  pending = true;
  if (!isRunning) {
    // schedule a background refresh without awaiting
    setImmediate(() => {
      doRefresh().catch(err => console.warn('[MATVIEW] background refresh failed:', err && err.message ? err.message : err));
    });
  }
}

// Expose a Promise-returning function to refresh immediately (useful for admin endpoint or tests)
function refreshNow() {
  // If a refresh is running, we enqueue another and return a promise that resolves when done.
  if (isRunning) {
    return new Promise((resolve, reject) => {
      pending = true;
      // Poll for completion (small, simple approach)
      const check = setInterval(() => {
        if (!isRunning && !pending) {
          clearInterval(check);
          resolve();
        }
      }, 100);
        if (typeof check.unref === 'function') check.unref();
      // set a reasonable timeout
      setTimeout(() => {
        clearInterval(check);
        reject(new Error('refreshNow timed out'));
      }, 30 * 1000);
        if (typeof setTimeout.unref === 'function') setTimeout.unref();
    });
  }
  return doRefresh();
}

function isMatviewRefreshRunning() { return isRunning; }
function getMatviewRefreshState() { return { isRunning, pending }; }

module.exports = { enqueueRefresh, refreshNow, isMatviewRefreshRunning, getMatviewRefreshState };
