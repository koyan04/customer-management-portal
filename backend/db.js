const { Pool } = require('pg');

// DO NOT call require('dotenv').config() here — app.js loads dotenv centrally.

// Validate required DB env vars early to give a clear error instead of a low-level SASL message.
const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = required.filter(k => typeof process.env[k] === 'undefined' || process.env[k] === '');
// When running tests, we may run global teardown in a separate process without
// environment variables loaded. In that case, export a no-op pool so teardown
// can call end() safely without throwing here.
const skipRealPool = missing.length > 0 && process.env.NODE_ENV === 'test';
if (skipRealPool) {
  const noop = async () => ({ rows: [] });
  const dummy = {
    query: noop,
    end: async () => {},
    shutdown: async () => {},
  };
  module.exports = dummy;
} else if (missing.length > 0) {
  const msg = `Missing required DB env vars: ${missing.join(', ')}.\nSet them in your PowerShell session or in a .env file (backend/.env or project root). Example:\n$env:DB_HOST='localhost'; $env:DB_PORT='5432'; $env:DB_USER='pguser'; $env:DB_PASSWORD='s3cret'; $env:DB_DATABASE='mydb'`;
  // throw early so the developer sees a helpful message instead of a SASL/pg error
  throw new Error(msg);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

// Expose a safe shutdown helper on the pool so tests and other runners can close it.
pool.shutdown = async function shutdown() {
  try {
    await pool.end();
  } catch (e) {
    // swallow — called during teardown
    console.warn('pool.shutdown error:', e && e.message ? e.message : e);
  }
};

module.exports = pool;