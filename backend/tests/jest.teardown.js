/**
 * Jest global teardown to ensure DB pool and any lingering resources are closed.
 * This file is intentionally small and tolerant when running in CI or when
 * environment variables are not present (the pool will be a noop in test mode).
 */
module.exports = async () => {
  try {
    // require the pool and call shutdown if available
    const pool = require('../db');
    if (pool && typeof pool.shutdown === 'function') {
      await pool.shutdown();
    }
  } catch (e) {
    // swallow - teardown should not fail the test run
    // eslint-disable-next-line no-console
    console.warn('[jest.teardown] pool shutdown failed or not present:', e && e.message ? e.message : e);
  }
};
