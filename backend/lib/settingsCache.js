const pool = require('../db');

// In-memory cache for app settings
const cache = {
  general: null,
  loadedAt: null,
};

async function loadGeneral() {
  try {
    const { rows } = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    cache.general = rows && rows[0] ? (rows[0].data || {}) : {};
    cache.loadedAt = new Date();
    return cache.general;
  } catch (e) {
    // On error, keep previous cache; return empty object
    return cache.general || {};
  }
}

function getGeneralCached() {
  return cache.general || {};
}

async function refreshAll() {
  await loadGeneral();
  return { ok: true, loadedAt: cache.loadedAt };
}

module.exports = {
  loadGeneral,
  getGeneralCached,
  refreshAll,
};
