require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');
const cron = require('node-cron');
const pool = require('./db');
const dbCompat = require('./lib/dbCompat');
const { createHelpers, DEFAULT_LOCK_KEY } = require('./lib/telegramHelpers');
const helpers = createHelpers(pool, dbCompat);
const express = require('express');
const bodyParser = require('body-parser');
const clientMetrics = require('prom-client');

// Runtime-configurable values (may be stored in app_settings.telegram)
let TELEGRAM_TOKEN = null;
let API_BASE = null;
let BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || null;
let ALLOWED_CHAT_IDS = null; // null = allow all, otherwise array of numeric chat ids
let DEFAULT_CHAT_ID = null; // optional default chat id to send messages to
let LOGIN_NOTIFICATION = false; // whether login notifications are enabled (from settings)
let BACKUP_DB_AND_CONFIG = false; // whether periodic DB+config backups should be sent to Telegram
let TELEGRAM_ENABLED = true; // global ON/OFF switch for the bot (from settings)
let NOTIFICATION_TIME_MINUTES = null; // frequency in minutes for periodic report/backups (from settings)
let NOTIFICATION_CRON = null; // optional cron expression for scheduling backups
let NOTIFICATION_TZ = null; // optional timezone for cron scheduling (IANA name)
let SETTINGS_RELOAD_SECONDS = 60; // configurable reload cadence for settings
// Admin JWT (optional) for making authenticated admin API calls if needed
let ADMIN_JWT = process.env.ADMIN_JWT || process.env.TELEGRAM_ADMIN_JWT || null;

let lastUpdateId = 0;
// Advisory lock id to coordinate a single poller across instances
const ADVISORY_LOCK_KEY = 1234567890;
let _haveAdvisoryLock = false;

// Prometheus metrics for the bot process
// Create metrics defensively so re-loading this module or running tests won't throw
function getOrCreateCounter(name, help) {
  try {
    const existing = clientMetrics.register.getSingleMetric(name);
    if (existing) return existing;
  } catch (_) {}
  try {
    return new clientMetrics.Counter({ name, help });
  } catch (e) {
    // If register already has a metric with this name but getSingleMetric failed, fallback to noop-like object
    return { inc: () => {} };
  }
}
function getOrCreateHistogram(name, help, buckets) {
  try {
    const existing = clientMetrics.register.getSingleMetric(name);
    if (existing) return existing;
  } catch (_) {}
  try {
    return new clientMetrics.Histogram({ name, help, buckets });
  } catch (e) {
    return { observe: () => {} };
  }
}
const metrics = {
  updates_total: getOrCreateCounter('cmp_telegram_updates_total', 'Total updates received from Telegram'),
  messages_sent_total: getOrCreateCounter('cmp_telegram_messages_sent_total', 'Total messages sent by the bot'),
  bot_errors_total: getOrCreateCounter('cmp_telegram_bot_errors_total', 'Total bot errors'),
  getUpdates_latency_ms: getOrCreateHistogram('cmp_telegram_getupdates_latency_ms', 'getUpdates latency in ms', [50,100,200,500,1000,2000,5000]),
};

// Pagination config
const PAGE_SIZE_SERVERS = 8; // 2 columns -> 4 rows
const PAGE_SIZE_USERS = 10;  // 2 columns -> 5 rows

function buildTwoColumnRows(items) {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    const row = [left];
    if (right) row.push(right);
    rows.push(row);
  }
  return rows;
}

// Telegram truncates very long button labels unpredictably across clients, so we
// trim them ourselves and keep a single trailing ellipsis.
const BUTTON_LABEL_MAX = 18;
function _truncateButton(label, max = BUTTON_LABEL_MAX) {
  const s = String(label == null ? '' : label).trim() || 'user';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function registerBotCommands() {
  if (!API_BASE) return;
  try {
    // Surfacing the status views as commands gives a fast, keyboard-free path
    // to the same screens the inline buttons reach.
    await axios.post(`${API_BASE}/setMyCommands`, { commands: [
      { command: 'start', description: 'Open dashboard' },
      { command: 'servers', description: 'Browse servers and their users' },
      { command: 'active', description: 'List active users' },
      { command: 'soon', description: 'Users expiring within 24h' },
      { command: 'expired', description: 'List expired users' }
    ] });
    console.log('[BOT] registered bot commands');
  } catch (e) {
    console.warn('[BOT] failed to register commands:', e && e.response ? e.response.data : e && e.message ? e.message : e);
  }
}

async function loadTelegramSettings() {
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram'");
    const cfg = (r.rows && r.rows[0] && r.rows[0].data) ? r.rows[0].data : {};
  
    // Fetch general settings for timezone fallback
    let generalTimezone = null;
    try {
      const gr = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
      const generalCfg = (gr.rows && gr.rows[0] && gr.rows[0].data) ? gr.rows[0].data : {};
      if (generalCfg.timezone && generalCfg.timezone !== 'auto') {
        generalTimezone = String(generalCfg.timezone).trim();
      }
    } catch (e) {
      console.warn('[BOT] Failed to fetch general settings timezone:', e && e.message ? e.message : e);
    }
  
  // token in DB takes precedence over env var when present; accept either 'botToken' or 'token'
  TELEGRAM_TOKEN = (cfg && (cfg.botToken || cfg.token)) ? String(cfg.botToken || cfg.token).trim() : (process.env.TELEGRAM_BOT_TOKEN || null);
    BOT_USERNAME = (cfg && cfg.bot_username) ? String(cfg.bot_username).trim() : (process.env.TELEGRAM_BOT_USERNAME || BOT_USERNAME);
    if (cfg && Array.isArray(cfg.allowed_chat_ids)) {
      ALLOWED_CHAT_IDS = cfg.allowed_chat_ids.map(x => Number(x)).filter(n => Number.isFinite(n));
    } else {
      ALLOWED_CHAT_IDS = null;
    }
    // loginNotification may be present as loginNotification or login_notification
    try {
      const ln = (cfg && (typeof cfg.loginNotification !== 'undefined')) ? cfg.loginNotification : cfg && cfg.login_notification;
      LOGIN_NOTIFICATION = !!ln;
    } catch (e) {
      LOGIN_NOTIFICATION = false;
    }
    // Default chat id: support a few common naming variants in settings
    const maybeDefault = cfg && (cfg.default_chat_id || cfg.defaultChatId || cfg.defaultChat || cfg.chat_id || cfg.chatId || cfg.defaultChatID);
    if (maybeDefault !== undefined && maybeDefault !== null && String(maybeDefault).trim() !== '') {
      const n = Number(maybeDefault);
      DEFAULT_CHAT_ID = Number.isFinite(n) ? n : String(maybeDefault).trim();
    } else {
      DEFAULT_CHAT_ID = null;
    }
    // Backup settings: support a few common key names
    try {
      const b = (cfg && (typeof cfg.login_database_backup !== 'undefined')) ? cfg.login_database_backup : cfg && (cfg.loginDatabaseBackup || cfg.backupOnLogin || cfg.backup_on_login);
      BACKUP_DB_AND_CONFIG = !!b;
    } catch (e) {
      BACKUP_DB_AND_CONFIG = false;
    }
    // global enabled flag for the bot UI/behavior: support multiple key variants
    try {
      const en = (cfg && (typeof cfg.enabled !== 'undefined')) ? cfg.enabled : cfg && (typeof cfg.botEnabled !== 'undefined' ? cfg.botEnabled : cfg && (typeof cfg.enabled_bot !== 'undefined' ? cfg.enabled_bot : null));
      TELEGRAM_ENABLED = (typeof en === 'undefined' || en === null) ? true : !!en;
    } catch (e) {
      TELEGRAM_ENABLED = true;
    }
    try {
      const nt = cfg && (cfg.notificationTime || cfg.notification_time || cfg.notification_minutes || cfg.notificationTimeMinutes || cfg.notification_time_minutes);
      NOTIFICATION_TIME_MINUTES = (nt !== undefined && nt !== null && nt !== '') ? Number(nt) : null;
    } catch (e) {
      NOTIFICATION_TIME_MINUTES = null;
    }
    try {
      const nc = cfg && (cfg.notificationCron || cfg.notification_cron || cfg.cron || cfg.crontab || cfg.schedule_cron || null);
      NOTIFICATION_CRON = (nc !== undefined && nc !== null && String(nc).trim() !== '') ? String(nc).trim() : null;
      // Support nested notification object shapes: { notification_time: { cron, timezone } } or { notification: { cron, tz } }
      const notifObj = cfg && (cfg.notification || cfg.notification_time || cfg.notificationTime || null);
      if (!NOTIFICATION_CRON && notifObj && typeof notifObj === 'object') {
        const nestedCron = notifObj.cron || notifObj.crontab || notifObj.cron_expression || notifObj.expression || notifObj.schedule;
        if (nestedCron) NOTIFICATION_CRON = String(nestedCron).trim();
        const nestedTz = notifObj.timezone || notifObj.tz || notifObj.time_zone || notifObj.tz_name || notifObj.timezone_name;
        if (nestedTz) NOTIFICATION_TZ = String(nestedTz).trim();
      }
      // Also support a separate timezone top-level key variants
      if (!NOTIFICATION_TZ) {
        const tzcand = cfg && (cfg.timezone || cfg.tz || cfg.time_zone || cfg.tz_name || cfg.notification_timezone || null);
        if (tzcand) NOTIFICATION_TZ = String(tzcand).trim();
      }
      // Fallback to general settings timezone if not set in telegram settings
      if (!NOTIFICATION_TZ && generalTimezone) {
        NOTIFICATION_TZ = generalTimezone;
        console.log('[BOT] Using timezone from general settings: %s', NOTIFICATION_TZ);
      }
    } catch (e) {
      NOTIFICATION_CRON = null;
      NOTIFICATION_TZ = null;
    }
      // Settings reload interval
      try {
        const sr = cfg && (cfg.settings_reload_seconds || cfg.reload_seconds || cfg.settingsReloadSeconds || null);
        const n = Number(sr);
        if (Number.isFinite(n) && n > 0) SETTINGS_RELOAD_SECONDS = Math.max(5, Math.min(3600, Math.round(n))); else SETTINGS_RELOAD_SECONDS = 60;
      } catch (e) {
        SETTINGS_RELOAD_SECONDS = 60;
      }
    if (TELEGRAM_TOKEN) API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  // include enabled flag in the log; keep concise to avoid noisy repeated logs
    console.log('[BOT] Loaded telegram settings; enabled=%s token=%s bot_username=%s default_chat_id=%s login_notification=%s backup=%s notify_minutes=%s notify_cron=%s notify_tz=%s reload_s=%s admin_jwt=%s', TELEGRAM_ENABLED ? 'YES' : 'NO', TELEGRAM_TOKEN ? 'YES' : 'NO', BOT_USERNAME || 'N/A', DEFAULT_CHAT_ID || 'N/A', LOGIN_NOTIFICATION ? 'YES' : 'NO', BACKUP_DB_AND_CONFIG ? 'YES' : 'NO', NOTIFICATION_TIME_MINUTES || 'N/A', NOTIFICATION_CRON || 'N/A', NOTIFICATION_TZ || 'N/A', SETTINGS_RELOAD_SECONDS, ADMIN_JWT ? 'YES' : 'NO');
  } catch (e) {
    console.warn('[BOT] Failed to load telegram settings from DB:', e && e.message ? e.message : e);
    // fallback to env
    TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
    if (TELEGRAM_TOKEN) API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  }
}

async function fetchTitle() {
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    if (r.rows && r.rows[0] && r.rows[0].data) {
      const data = r.rows[0].data;
      // Prefer common title/name keys: title, name, site_title, siteTitle, siteName, brand, header
      const candidates = [data.title, data.name, data.site_title, data.siteTitle, data.siteName, data.brand, data.header];
      for (const c of candidates) {
        if (c !== undefined && c !== null && String(c).trim() !== '') return String(c).trim();
      }
    }
  } catch (e) {
    console.warn('Failed to read app_settings.general for title:', e && e.message ? e.message : e);
  }
  // Fallback: try to read the on-disk backup file if present
  try {
    // eslint-disable-next-line global-require,import/no-dynamic-require
    const backup = require('./app_settings_general_backup.json');
    if (backup && (backup.title || backup.name)) return String(backup.title || backup.name).trim();
  } catch (e) {
    // ignore
  }
  return null;
}

// Helper function to format date/time using the configured timezone
function formatDateTimeWithTZ(date = new Date(), includeSeconds = true) {
  try {
    const tz = NOTIFICATION_TZ || undefined;
    const dateOpts = { 
      weekday: 'short',
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      timeZone: tz
    };
    const timeOpts = {
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false,
      timeZone: tz
    };
    const datePart = date.toLocaleDateString('en-US', dateOpts);
    const timePart = date.toLocaleTimeString('en-US', timeOpts);
    return `${datePart}, ${timePart}`;
  } catch (e) {
    // Fallback to ISO string if timezone formatting fails
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }
}

// Format a date (YYYY-MM-DD) string to local date in the configured timezone
function formatDateOnly(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    // Parse the date string as YYYY-MM-DD and interpret it in the local timezone
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexed
      const day = parseInt(match[3], 10);
      // Create date at noon in local timezone to avoid DST issues
      const date = new Date(year, month, day, 12, 0, 0);
      const tz = NOTIFICATION_TZ || undefined;
      return date.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });
    }
    // Fallback: try to parse as Date and format
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const tz = NOTIFICATION_TZ || undefined;
      return date.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });
    }
  } catch (e) {
    console.error('[BOT] formatDateOnly error:', e);
  }
  return String(dateStr).slice(0, 10);
}

async function fetchDashboard() {
  // Similar logic to /api/servers/summary but without auth
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    const serversRes = await pool.query('SELECT id, server_name, ip_address, domain_name FROM servers ORDER BY created_at DESC');
    const serversRows = serversRes.rows || [];
    if (!serversRows.length) return { totalServers: 0, totalUsers: 0, tiers: { Mini: 0, Basic: 0, Unlimited: 0 }, status: { active: 0, soon: 0, expired: 0 }, servers: [] };
    const serverIds = serversRows.map(s => s.id);
    const { rows: userRows } = await pool.query('SELECT u.server_id, u.service_type, u.expire_date, u.account_name FROM users u WHERE u.enabled = TRUE AND u.server_id = ANY($1::int[])', [serverIds]);
    const perServer = new Map();
    let totalUsers = 0;
    let tiers = { Mini: 0, Basic: 0, Unlimited: 0 };
    let status = { active: 0, soon: 0, expired: 0 };
    const normalizeService = (svc) => {
      const v = (svc || '').toLowerCase();
      if (v === 'x-ray' || v === 'xray' || v === 'outline') return 'Mini';
      if (v === 'mini') return 'Mini';
      if (v === 'basic') return 'Basic';
      if (v === 'unlimited') return 'Unlimited';
      return svc || '';
    };
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
    for (const row of (userRows || [])) {
      totalUsers++;
      const sid = row.server_id;
      const svc = normalizeService(row.service_type);
      if (!perServer.has(sid)) perServer.set(sid, { count: 0, tiers: { Mini: 0, Basic: 0, Unlimited: 0 }, status: { active: 0, soon: 0, expired: 0 } });
      const bucket = perServer.get(sid);
      bucket.count++;
      if (svc === 'Mini') { tiers.Mini++; bucket.tiers.Mini++; }
      else if (svc === 'Basic') { tiers.Basic++; bucket.tiers.Basic++; }
      else if (svc === 'Unlimited') { tiers.Unlimited++; bucket.tiers.Unlimited++; }
      const cutoff = parseCutoff(row.expire_date);
      if (!cutoff) { status.active++; bucket.status.active++; continue; }
      const diff = cutoff.getTime() - now.getTime();
      if (diff <= 0) { status.expired++; bucket.status.expired++; }
      else if (diff <= 24 * 60 * 60 * 1000) { status.soon++; bucket.status.soon++; }
      else { status.active++; bucket.status.active++; }
    }
    const servers = serversRows.map(s => ({ id: s.id, server_name: s.server_name, total_users: (perServer.get(s.id)?.count) || 0, tiers: perServer.get(s.id)?.tiers || { Mini: 0, Basic: 0, Unlimited: 0 }, status: perServer.get(s.id)?.status || { active: 0, soon: 0, expired: 0 } }));
    return { totalServers: serversRows.length, totalUsers, tiers, status, servers };
  } catch (e) {
    console.error('fetchDashboard failed:', e && e.message ? e.message : e);
    return null;
  }
}

async function fetchServersList() {
  try {
    const r = await pool.query('SELECT id, server_name, ip_address, domain_name FROM servers ORDER BY created_at DESC');
    return r.rows || [];
  } catch (e) {
    console.error('fetchServersList failed:', e && e.message ? e.message : e);
    return [];
  }
}

// Use helpers module for DB operations (keeps this file focused on bot logic)
const { fetchServerById, fetchUsersByServer, fetchUserById, applyExtendExpire } = helpers;

async function fetchUsersByStatus(status) {
  // status: 'expired' | 'soon' | 'active'
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    let rows = [];
    if (status === 'expired') {
      const r = await pool.query("SELECT u.*, s.server_name FROM users u JOIN servers s ON s.id = u.server_id WHERE u.enabled = TRUE AND (u.expire_date::date + interval '1 day') <= now() ORDER BY u.expire_date ASC LIMIT 200");
      rows = r.rows || [];
    } else if (status === 'soon') {
      const r = await pool.query("SELECT u.*, s.server_name FROM users u JOIN servers s ON s.id = u.server_id WHERE u.enabled = TRUE AND (u.expire_date::date + interval '1 day') > now() AND (u.expire_date::date + interval '1 day') <= now() + interval '1 day' ORDER BY u.expire_date ASC LIMIT 200");
      rows = r.rows || [];
    } else if (status === 'active') {
      const r = await pool.query("SELECT u.*, s.server_name FROM users u JOIN servers s ON s.id = u.server_id WHERE u.enabled = TRUE AND (u.expire_date::date + interval '1 day') > now() + interval '1 day' ORDER BY u.expire_date ASC LIMIT 200");
      rows = r.rows || [];
    }
    return rows;
  } catch (e) {
    console.error('fetchUsersByStatus failed:', e && e.message ? e.message : e);
    return [];
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Derive a simple status (emoji + label) from an expire_date value
function getUserStatusObj(expire_date) {
  if (!expire_date) return { emoji: '⚪', label: 'N/A' };
  let cutoff = null;
  try {
    const s = String(expire_date);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) { const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]); cutoff = new Date(y, mo - 1, d + 1, 0, 0, 0, 0); }
    else {
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) cutoff = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
    }
  } catch (_) { cutoff = null; }
  if (!cutoff) return { emoji: '⚪', label: 'N/A' };
  const now = new Date();
  const diff = cutoff.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (diff <= 0) return { emoji: '🔴', label: 'Expired' };
  if (diff <= dayMs) return { emoji: '🟡', label: 'Soon' };
  return { emoji: '🟢', label: 'Active' };
}

// Single source of truth for the user detail card. `server_user` and
// `refresh_user` both render through this so they can never drift apart.
function renderUserCard(user, sid) {
  const st = getUserStatusObj(user.expire_date);
  const lines = [];
  lines.push(`${st.emoji} <b>${escapeHtml(user.account_name)}</b>  <i>${st.label}</i>`);
  lines.push('');
  lines.push(`🏷️ Server: ${escapeHtml(user.server_name || 'N/A')}`);
  lines.push(`🧩 Service: ${escapeHtml(user.service_type || 'N/A')}`);
  lines.push(`📅 Expires: <b>${formatDateOnly(user.expire_date)}</b>`);
  if (user.contact) lines.push(`📞 Contact: ${escapeHtml(user.contact)}`);
  if (user.total_devices) lines.push(`📱 Devices: ${escapeHtml(String(user.total_devices))}`);
  if (user.data_limit_gb) lines.push(`📶 Data: ${escapeHtml(String(user.data_limit_gb))} GB`);
  if (user.remark) lines.push(`📝 Note: ${escapeHtml(user.remark)}`);
  return lines.join('\n');
}

function buildUserCardKeyboard(sid, uid) {
  return {
    inline_keyboard: [
      [ { text: '🗓️ Change Expire Date', callback_data: `change_expire:${uid}` } ],
      [ { text: '🔄 Refresh', callback_data: `refresh_user:${sid}:${uid}` } ],
      [ { text: '🔙 Back to Server', callback_data: `server:${sid}` } ],
      [ { text: '✖️ Close', callback_data: `close_view:${uid}` } ]
    ]
  };
}

// Per-chat notification preference helpers
async function getChatNotificationEnabled(chatId) {
  try {
    const r = await pool.query('SELECT login_notification FROM telegram_chat_notifications WHERE chat_id = $1', [chatId]);
    if (r && r.rows && r.rows[0]) return !!r.rows[0].login_notification;
    return null; // null indicates not set (use global)
  } catch (e) {
    console.warn('[BOT] getChatNotificationEnabled failed:', e && e.message ? e.message : e);
    return null;
  }
}

async function setChatNotificationEnabled(chatId, enabled) {
  try {
    await pool.query(
      `INSERT INTO telegram_chat_notifications (chat_id, login_notification, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (chat_id) DO UPDATE SET login_notification = EXCLUDED.login_notification, updated_at = now()`,
      [chatId, !!enabled]
    );
    return !!enabled;
  } catch (e) {
    console.warn('[BOT] setChatNotificationEnabled failed:', e && e.message ? e.message : e);
    return null;
  }
}

async function sendMessage(chatId, text, extra = {}) {
  try {
    if (!API_BASE) throw new Error('API_BASE not configured (no token)');
    const target = chatId || DEFAULT_CHAT_ID;
    if (!target) throw new Error('No chat id supplied and no default_chat_id configured');
    const payload = { chat_id: target, text, parse_mode: 'HTML', ...extra };
    const res = await axios.post(`${API_BASE}/sendMessage`, payload);
    try { metrics.messages_sent_total.inc(); } catch (_) {}
    return (res && res.data && res.data.result) || null;
  } catch (e) {
    try { metrics.bot_errors_total.inc(); } catch (_) {}
    console.error('sendMessage failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
    return null;
  }
}

// ─── View rendering primitives ───────────────────────────────────────────
// Every navigation view is rendered through these helpers so behaviour stays
// consistent: list/menu views are edited in place (no chat spam), drill-down
// details are posted as additional messages, and "close" removes them.

// Cache the last text rendered for a message so we can skip no-op edits.
// Telegram rejects an edit whose text is identical with a 400 "message is not
// modified", which would otherwise surface as a spurious error every tap.
const VIEW_CACHE_MAX = 500;
const _viewCache = new Map(); // `${chatId}:${messageId}` -> text

function _viewCacheSet(chatId, messageId, text) {
  if (!chatId || !messageId) return;
  const key = `${chatId}:${messageId}`;
  try {
    if (_viewCache.size >= VIEW_CACHE_MAX) {
      const oldest = _viewCache.keys().next().value;
      _viewCache.delete(oldest);
    }
    _viewCache.set(key, text);
  } catch (_) {}
}

function _viewCacheGet(chatId, messageId) {
  if (!chatId || !messageId) return undefined;
  try { return _viewCache.get(`${chatId}:${messageId}`); } catch (_) { return undefined; }
}

// Recognise Telegram's "message content is not modified" error.
function _isNotModifiedError(e) {
  const d = e && e.response && e.response.data;
  const msg = String((d && (d.description || d.error)) || (e && e.message) || '').toLowerCase();
  return msg.includes('not modified');
}

// Edit an existing message in place. Returns true when the edit was applied or
// was a no-op because the content already matched.
async function editMessageText(chatId, messageId, text, replyMarkup) {
  if (!API_BASE || !chatId || !messageId) return false;
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup && replyMarkup.inline_keyboard) payload.reply_markup = replyMarkup;
  else payload.reply_markup = { inline_keyboard: [] };
  try {
    await axios.post(`${API_BASE}/editMessageText`, payload);
    try { metrics.messages_sent_total.inc(); } catch (_) {}
    _viewCacheSet(chatId, messageId, text);
    return true;
  } catch (e) {
    if (_isNotModifiedError(e)) { _viewCacheSet(chatId, messageId, text); return true; }
    // Fall back to sending a fresh message so the user is never left without output.
    console.warn('[BOT] editMessageText failed, sending new message instead:', e && e.response ? e.response.data : e && e.message ? e.message : e);
    const sent = await sendMessage(chatId, text, payload.reply_markup && payload.reply_markup.inline_keyboard.length ? { reply_markup: payload.reply_markup } : {});
    if (sent) _viewCacheSet(chatId, sent.message_id, text);
    return true;
  }
}

// Core navigation renderer.
//   mode 'edit'  -> update `messageId` in place (list paging, refresh)
//   mode 'send'  -> post a new "additional" message (drill-down from the menu)
// Content identical to what is already on screen is skipped silently.
async function renderView(chatId, messageId, text, keyboard, mode = 'auto') {
  const useEdit = mode === 'edit' || (mode === 'auto' && messageId);
  if (useEdit && messageId) {
    if (_viewCacheGet(chatId, messageId) === text) return { edited: true, skipped: true };
    return { edited: await editMessageText(chatId, messageId, text, keyboard) };
  }
  const sent = await sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : {});
  if (sent) _viewCacheSet(chatId, sent.message_id, text);
  return { edited: false, messageId: sent && sent.message_id };
}

// Remove a drill-down message, returning the user to the view above it.
// Telegram refuses to delete messages older than 48h, so fall back to
// collapsing the message into a short closed stub.
async function closeView(chatId, messageId, label) {
  if (!API_BASE || !chatId || !messageId) return false;
  try {
    await axios.post(`${API_BASE}/deleteMessage`, { chat_id: chatId, message_id: messageId });
    _viewCache.delete(`${chatId}:${messageId}`);
    return true;
  } catch (e) {
    const stub = `<i>${escapeHtml(label || 'View')} — closed</i>`;
    return editMessageText(chatId, messageId, stub, null);
  }
}

// Build a pager row plus a consistent back/close row.
function buildPagerRow(page, totalPages, makeData) {
  const row = [];
  if (page > 1) row.push({ text: '⬅️ Prev', callback_data: makeData(page - 1) });
  row.push({ text: `📄 ${page}/${totalPages}`, callback_data: makeData(page) });
  if (page < totalPages) row.push({ text: 'Next ➡️', callback_data: makeData(page + 1) });
  return row;
}


// Send a file/document to a chat using multipart/form-data
async function sendDocument(chatId, filePath, caption) {
  try {
    if (!API_BASE) throw new Error('API_BASE not configured (no token)');
    const target = chatId || DEFAULT_CHAT_ID;
    if (!target) throw new Error('No chat id supplied and no default_chat_id configured');
    const form = new FormData();
    form.append('chat_id', String(target));
    if (caption) form.append('caption', caption);
    form.append('document', fs.createReadStream(filePath));
    const headers = form.getHeaders();
    await axios.post(`${API_BASE}/sendDocument`, form, { headers });
    try { metrics.messages_sent_total.inc(); } catch (_) {}
  } catch (e) {
    try { metrics.bot_errors_total.inc(); } catch (_) {}
    console.error('sendDocument failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
  }
}

async function answerCallback(queryId, text = '', showAlert = false) {
  try {
    if (!API_BASE) throw new Error('API_BASE not configured (no token)');
    // A bare ack (no text) clears the button spinner silently; text/toast is opt-in.
    const payload = { callback_query_id: queryId, show_alert: !!showAlert };
    if (text) payload.text = text;
    await axios.post(`${API_BASE}/answerCallbackQuery`, payload);
  } catch (e) {
    console.warn('answerCallback failed:', e && e.message ? e.message : e);
  }
}

async function handleStart(chatId, from, messageId = null) {
  // Respect allowed chat ids if configured
  if (ALLOWED_CHAT_IDS && !ALLOWED_CHAT_IDS.includes(Number(chatId))) {
    console.log('[BOT] Ignoring /start from chat', chatId, 'not in allowed list');
    return;
  }
  const title = await fetchTitle() || 'Customer Management Portal';
  const header = `<b>🌏 ${escapeHtml(title)}</b>`;
  const dash = await fetchDashboard();
  const statsText = dash
    ? `\n\n<b>📊 Stats</b>\n📡 Servers: <b>${dash.totalServers}</b>   👥 Users: <b>${dash.totalUsers}</b>\n🏷️ Mini ${dash.tiers.Mini} · Basic ${dash.tiers.Basic} · Unlimited ${dash.tiers.Unlimited}\n🟢 Active ${dash.status.active} · 🟡 Soon ${dash.status.soon} · 🔴 Expired ${dash.status.expired}`
    : '\n\n<i>Stats unavailable</i>';
  const notifText = LOGIN_NOTIFICATION ? `\n\n🔔 Login notifications are <b>enabled</b>` : '';

  const rows = [
    [ { text: '📡 Server List', callback_data: 'servers_page:1' } ],
    [ { text: '🟢 Active', callback_data: 'users_page:active:1' }, { text: '🟡 Expire Soon', callback_data: 'users_page:soon:1' } ],
    [ { text: '🔴 Expired Users', callback_data: 'users_page:expired:1' } ]
  ];
  // Notification toggle reflects the effective (per-chat overridden) preference.
  try {
    const chatPref = await getChatNotificationEnabled(chatId);
    const effective = (chatPref === null ? LOGIN_NOTIFICATION : chatPref);
    rows.push([ { text: effective ? '🔔 Notifications: ON' : '🔕 Notifications: OFF', callback_data: 'toggle_notifications' } ]);
  } catch (_) {}

  // Editing in place when navigated back from a sub-view keeps the menu single-instance.
  return renderView(chatId, messageId, `${header}${statsText}${notifText}`, { inline_keyboard: rows }, messageId ? 'edit' : 'send');
}

async function handleCallback(callback) {
  const data = callback.data;
  const chatId = callback.message && callback.message.chat && callback.message.chat.id;
  const qid = callback.id;
  if (!chatId) return;
  if (ALLOWED_CHAT_IDS && !ALLOWED_CHAT_IDS.includes(Number(chatId))) {
    console.log('[BOT] Ignoring callback from chat', chatId, 'not in allowed list');
    return;
  }
  if (data === 'servers') {
    // Backwards compat: redirect to first page
    return handleCallback({ data: 'servers_page:1', message: { chat: { id: chatId } }, id: qid });
  } else if (data === 'soon' || data === 'expired' || data === 'active') {
    // support paged users for statuses via users_page:<status>:<page>
    return handleCallback({ data: `users_page:${data}:1`, message: { chat: { id: chatId } }, id: qid });
    }

  // New interactive handlers for server/user drilldown and expire-date changes
  // main_back should return to main menu, reusing the same message when possible
  if (data === 'main_back') {
    const msgId = callback.message && callback.message.message_id;
    return handleStart(chatId, null, msgId);
  }

  // servers_page:<page> — list view, edited in place so navigation never floods the chat
  if (data && data.startsWith('servers_page:')) {
    await answerCallback(qid);
    const parts = data.split(':');
    const page = Math.max(1, Number(parts[1] || '1') || 1);
    const msgId = callback.message && callback.message.message_id;
    const all = await fetchServersList();
    if (!all.length) {
      return renderView(chatId, msgId, '<b>📡 Servers</b>\n\n<i>No servers configured yet.</i>',
        { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main_back' }]] }, msgId ? 'edit' : 'send');
    }
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE_SERVERS));
    const cur = Math.min(page, totalPages);
    const slice = all.slice((cur - 1) * PAGE_SIZE_SERVERS, (cur - 1) * PAGE_SIZE_SERVERS + PAGE_SIZE_SERVERS);
    // Show live user counts on each button so the list is informative at a glance.
    const dash = await fetchDashboard();
    const counts = new Map((dash && dash.servers ? dash.servers : []).map(s => [s.id, s.total_users]));
    const buttons = slice.map(s => ({ text: `📡 ${s.server_name} (${counts.get(s.id) || 0})`, callback_data: `server:${s.id}:1` }));
    const keyboardRows = buildTwoColumnRows(buttons);
    if (totalPages > 1) keyboardRows.push(buildPagerRow(cur, totalPages, p => `servers_page:${p}`));
    keyboardRows.push([ { text: '🔙 Back', callback_data: 'main_back' } ]);
    return renderView(chatId, msgId, `<b>📡 Servers</b>  <i>page ${cur}/${totalPages} · ${all.length} total</i>\nSelect a server:`,
      { inline_keyboard: keyboardRows }, msgId ? 'edit' : 'send');
  }

  if (data && data.startsWith('server:')) {
    await answerCallback(qid);
    const parts = data.split(':');
    const sid = parts[1];
    const page = Math.max(1, Number(parts[2] || '1') || 1);
    const msgId = callback.message && callback.message.message_id;
    const server = await fetchServerById(sid);
    if (!server) {
      return renderView(chatId, msgId, '<b>⚠️ Server not found</b>\n<i>It may have been removed.</i>',
        { inline_keyboard: [[{ text: '🔙 Back to Servers', callback_data: 'servers_page:1' }]] }, msgId ? 'edit' : 'send');
    }
    const users = await fetchUsersByServer(sid) || [];
    if (!users.length) {
      return renderView(chatId, msgId, `<b>📡 ${escapeHtml(server.server_name)}</b>\n\n<i>No users on this server yet.</i>`,
        { inline_keyboard: [[{ text: '🔙 Back to Servers', callback_data: 'servers_page:1' }]] }, msgId ? 'edit' : 'send');
    }
    const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE_USERS));
    const cur = Math.min(page, totalPages);
    const slice = users.slice((cur - 1) * PAGE_SIZE_USERS, (cur - 1) * PAGE_SIZE_USERS + PAGE_SIZE_USERS);
    const info = [];
    if (server.ip_address) info.push(`🌐 ${escapeHtml(server.ip_address)}`);
    if (server.domain_name) info.push(`🔗 ${escapeHtml(server.domain_name)}`);
    const header = `<b>📡 ${escapeHtml(server.server_name)}</b>\n${info.join('  ·  ')}\n👥 ${users.length} user${users.length === 1 ? '' : 's'}`;
    // Status emoji on each button means colour coding is visible before opening a card.
    const userButtons = slice.map(u => {
      const st = getUserStatusObj(u.expire_date);
      const name = String(u.account_name || 'user');
      return { text: `${st.emoji} ${_truncateButton(name)}`, callback_data: `server_user:${sid}:${u.id}` };
    });
    const keyboard = { inline_keyboard: buildTwoColumnRows(userButtons) };
    if (totalPages > 1) keyboard.reply_markup.inline_keyboard.push(buildPagerRow(cur, totalPages, p => `server:${sid}:${p}`));
    keyboard.reply_markup.inline_keyboard.push([ { text: '🔙 Back to Servers', callback_data: 'servers_page:1' } ]);
    return renderView(chatId, msgId, header, keyboard, msgId ? 'edit' : 'send');
  }

  if (data && data.startsWith('server_user:')) {
    await answerCallback(qid);
    const parts = data.split(':');
    const sid = parts[1];
    const uid = parts[2];
    const user = await fetchUserById(uid);
    if (!user) return sendMessage(chatId, '<b>⚠️ User not found</b>\n<i>This account may have been deleted.</i>');
    // Detail cards are posted as additional messages, leaving the list above intact.
    return renderView(chatId, null, renderUserCard(user, sid), buildUserCardKeyboard(sid, uid), 'send');
  }

  // refresh_user:<serverId>:<userId> — re-render the card in place
  if (data && data.startsWith('refresh_user:')) {
    await answerCallback(qid);
    const parts = data.split(':');
    const sid = parts[1];
    const uid = parts[2];
    const msgId = callback.message && callback.message.message_id;
    const user = await fetchUserById(uid);
    if (!user) {
      return renderView(chatId, msgId, '<b>⚠️ User not found</b>\n<i>This account may have been deleted.</i>',
        { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main_back' }]] }, msgId ? 'edit' : 'send');
    }
    return renderView(chatId, msgId, renderUserCard(user, sid), buildUserCardKeyboard(sid, uid), msgId ? 'edit' : 'send');
  }

  // users_page:<status>:<page> — list view, edited in place
  if (data && data.startsWith('users_page:')) {
    await answerCallback(qid);
    const parts = data.split(':');
    const status = parts[1];
    const page = Math.max(1, Number(parts[2] || '1') || 1);
    const msgId = callback.message && callback.message.message_id;
    const label = { expired: '🔴 Expired', soon: '🟡 Expiring Soon', active: '🟢 Active' }[status] || '👥 Users';
    const users = await fetchUsersByStatus(status) || [];
    if (!users.length) {
      return renderView(chatId, msgId, `<b>${label} Users</b>\n\n<i>Nothing here right now. 🎉</i>`,
        { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main_back' }]] }, msgId ? 'edit' : 'send');
    }
    const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE_USERS));
    const cur = Math.min(page, totalPages);
    const slice = users.slice((cur - 1) * PAGE_SIZE_USERS, (cur - 1) * PAGE_SIZE_USERS + PAGE_SIZE_USERS);
    // The buttons ARE the list — no duplicated name lines in the message body.
    const userButtons = slice.map(u => ({
      text: `${getUserStatusObj(u.expire_date).emoji} ${_truncateButton(u.account_name)}`,
      callback_data: `server_user:${u.server_id}:${u.id}`
    }));
    const keyboardRows = buildTwoColumnRows(userButtons);
    if (totalPages > 1) keyboardRows.push(buildPagerRow(cur, totalPages, p => `users_page:${status}:${p}`));
    keyboardRows.push([ { text: '🔙 Back', callback_data: 'main_back' } ]);
    return renderView(chatId, msgId, `<b>${label} Users</b>  <i>page ${cur}/${totalPages} · ${users.length} total</i>\nSelect a user for full details:`, { inline_keyboard: keyboardRows }, msgId ? 'edit' : 'send');
  }

  if (data && data.startsWith('change_expire:')) {
    await answerCallback(qid, 'Choose how long to extend');
    const parts = data.split(':');
    const uid = parts[1];
    const msgId = callback.message && callback.message.message_id;
    const user = await fetchUserById(uid);
    const who = user ? escapeHtml(user.account_name) : `user ${uid}`;
    const keyboard = { inline_keyboard: [
      [ { text: '1 Month', callback_data: `change_expire_choice:${uid}:1` }, { text: '2 Months', callback_data: `change_expire_choice:${uid}:2` }, { text: '6 Months', callback_data: `change_expire_choice:${uid}:6` } ],
      [ { text: '🔙 Cancel', callback_data: 'main_back' } ]
    ] };
    return renderView(chatId, msgId, `<b>🗓️ Extend ${who}</b>\nCurrent expiry: <b>${formatDateOnly(user && user.expire_date)}</b>\n\nHow long should it be extended by?`, keyboard, msgId ? 'edit' : 'send');
  }

  if (data && data.startsWith('change_expire_choice:')) {
    // Extra guard: require allowed chat id or allowed actor id to perform expiry changes
    const actorId = callback.from && callback.from.id;
    if (ALLOWED_CHAT_IDS && !ALLOWED_CHAT_IDS.includes(Number(chatId)) && !(actorId && ALLOWED_CHAT_IDS.includes(Number(actorId)))) {
      await answerCallback(qid, 'You are not authorized to perform this action', true);
      return sendMessage(chatId, '⛔ Unauthorized: you are not allowed to perform this action');
    }
    const parts = data.split(':');
    const uid = parts[1];
    const months = Number(parts[2]) || 0;
    if (!months) { await answerCallback(qid, 'Invalid selection', true); return; }
    await answerCallback(qid, 'Applying…');
    const res = await applyExtendExpire(uid, months, actorId || chatId);
    if (!res) {
      await answerCallback(qid, 'Update failed', true);
      return sendMessage(chatId, '❌ Failed to update expiry date. Please try again.');
    }
    const newDate = formatDateOnly(res.expire_date);
    const name = escapeHtml(res.account_name || 'User');
    const msgId = callback.message && callback.message.message_id;
    // Collapse the choice message into a confirmation so no dead buttons remain.
    return renderView(chatId, msgId, `✅ <b>${name}</b>\nExpiry extended to <b>${newDate}</b>`, { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_back' }]] }, msgId ? 'edit' : 'send');
  }

  // close_view:<uid> — dismiss a drill-down card (posted as an additional message)
  if (data && data.startsWith('close_view:')) {
    await answerCallback(qid);
    const parts = data.split(':');
    const msgId = callback.message && callback.message.message_id;
    let label = 'View';
    try { const u = await fetchUserById(parts[1]); if (u) label = u.account_name; } catch (_) {}
    return closeView(chatId, msgId, label);
  }

  // fallthrough: unhandled callbacks
  await answerCallback(qid, 'Action not recognised');
}

// Additional callback handler for toggling notifications
// (placed after main handler to keep the large function tidy)
async function handleToggleNotifications(callback) {
  const qid = callback.id;
  const chatId = callback.message && callback.message.chat && callback.message.chat.id;
  const msgId = callback.message && callback.message.message_id;
  if (!chatId) return;
  if (ALLOWED_CHAT_IDS && !ALLOWED_CHAT_IDS.includes(Number(chatId))) {
    await answerCallback(qid, 'You are not allowed to change settings', true);
    return;
  }
  try {
    const current = await getChatNotificationEnabled(chatId);
    const effective = (current === null ? LOGIN_NOTIFICATION : current);
    const nextVal = !effective;
    const res = await setChatNotificationEnabled(chatId, nextVal);
    if (res === null) {
      await answerCallback(qid, 'Could not save — try again', true);
      return;
    }
    // Re-render the main menu in place so the toggle label updates without
    // destroying the stats/dashboard content of this message.
    if (msgId) await handleStart(chatId, null, msgId);
    else await sendMessage(chatId, `🔔 Login notifications are now ${res ? 'ENABLED' : 'DISABLED'}`);
    await answerCallback(qid, res ? 'Notifications enabled' : 'Notifications disabled');
  } catch (e) {
    console.warn('[BOT] handleToggleNotifications failed:', e && e.message ? e.message : e);
    await answerCallback(qid, 'Something went wrong', true);
  }
}

// Wire the toggle handler into the main callback processing by intercepting known callback_data
// We wrap the original handleCallback by a small dispatcher.
const _origHandleCallback = handleCallback;
async function _dispatchCallback(callback) {
  const data = callback && callback.data;
  if (!data) return _origHandleCallback(callback);
  if (data === 'toggle_notifications') return handleToggleNotifications(callback);
  return _origHandleCallback(callback);
}
// Replace exported handling usage in pollLoop/webhook: use _dispatchCallback instead of handleCallback
handleCallback = _dispatchCallback;

// toggle_notifications handler: allow a chat to opt-out/in to login notifications
if (false) {
  // placeholder to keep linter happy for async function insertion below
}

let _running = false;
let _settingsInterval = null;
let _acquireInterval = null;
let _webhookServer = null; // http.Server returned by listen()
let _pollLoopPromise = null;
let _currentRequestController = null;
let _backupInterval = null;
let _backupCronTask = null;
let _lastBackupAt = 0;
const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000; // don't allow backups more frequently than 5 minutes
let _lastScheduleKey = null;
let _lastReloadMs = null;
// Network error backoff + log suppression for Telegram polling
let _netErrorStreak = 0; // consecutive network failures (e.g., ETIMEDOUT)
let _lastNetLogAt = 0;   // timestamp of last emitted network-error log

function currentReloadMs() {
  try {
    const s = Number(SETTINGS_RELOAD_SECONDS);
    if (Number.isFinite(s) && s > 0) return Math.max(5, Math.min(3600, Math.round(s))) * 1000;
  } catch (_) {}
  return 60 * 1000;
}

function scheduleSettingsReloadTimer() {
  const ms = currentReloadMs();
  if (_lastReloadMs === ms && _settingsInterval) return; // no change
  try { if (_settingsInterval) { clearInterval(_settingsInterval); _settingsInterval = null; } } catch (_) {}
  _settingsInterval = setInterval(async () => {
    try {
      await loadTelegramSettings();
      try { applyBotEnabledState(); } catch (_) {}
      try { scheduleBackupFromSettings(); } catch (_) {}
      // If interval changed due to settings, reschedule
      const nowMs = currentReloadMs();
      if (nowMs !== _lastReloadMs) {
        _lastReloadMs = nowMs;
        scheduleSettingsReloadTimer();
      }
    } catch (e) {
      console.warn('[BOT] periodic settings reload failed:', e && e.message ? e.message : e);
    }
  }, ms);
  _lastReloadMs = ms;
}

// Map a plain text command to the same view its button would open.
// Returns true when the text was handled as a command.
const COMMAND_VIEWS = {
  start: (chatId, msgId) => handleStart(chatId, null, msgId),
  servers: (chatId, msgId) => handleCallback({ data: 'servers_page:1', message: { chat: { id: chatId }, message_id: msgId }, id: null }),
  active: (chatId, msgId) => handleCallback({ data: 'users_page:active:1', message: { chat: { id: chatId }, message_id: msgId }, id: null }),
  soon: (chatId, msgId) => handleCallback({ data: 'users_page:soon:1', message: { chat: { id: chatId }, message_id: msgId }, id: null }),
  expired: (chatId, msgId) => handleCallback({ data: 'users_page:expired:1', message: { chat: { id: chatId }, message_id: msgId }, id: null })
};

function _commandName(txt) {
  const base = String(BOT_USERNAME ? `@${BOT_USERNAME}` : '');
  const t = String(txt || '').trim().toLowerCase();
  if (t === '/start' || t === `/start${base}`) return 'start';
  for (const name of Object.keys(COMMAND_VIEWS)) {
    if (t === `/${name}` || t === `/${name}${base}`) return name;
  }
  return null;
}

// Shared inbound-text handler used by both the poll loop and the webhook so the
// two transports can never diverge in behaviour.
async function handleInboundText(message) {
  const chatId = message && message.chat && message.chat.id;
  if (!chatId) return false;
  const txt = (message.text || '').trim();
  const name = _commandName(txt);
  if (name) {
    // Editing the user's own command message keeps the bot from adding clutter.
    await COMMAND_VIEWS[name](chatId, message.message_id);
    return true;
  }
  if (txt) {
    await sendMessage(chatId, 'Send /start to view the dashboard');
    return true;
  }
  return false;
}

async function pollLoop() {
  while (_running) {
    try {
      if (!API_BASE) {
        console.warn('[BOT] No API base configured (no token). Sleeping and will retry settings load.');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      const start = Date.now();
      // Create a cancellation mechanism for this long-poll request so it can be cancelled on shutdown.
      // Prefer AbortController (modern axios + Node), fall back to axios.CancelToken for older axios.
      _currentRequestController = null;
      const axiosOpts = { params: { offset: lastUpdateId + 1, timeout: 30 } };
      // Prefer AbortController when available
      try {
        if (typeof AbortController !== 'undefined') {
          const ac = new AbortController();
          axiosOpts.signal = ac.signal;
          _currentRequestController = { abort: () => { try { ac.abort(); } catch (_) {} } };
        }
      } catch (e) {
        _currentRequestController = null;
      }
      // Fallback to axios.CancelToken if AbortController not used / supported by axios version
      try {
        if (!_currentRequestController && axios && axios.CancelToken) {
          const source = axios.CancelToken.source();
          axiosOpts.cancelToken = source.token;
          _currentRequestController = { abort: (msg) => { try { source.cancel(msg); } catch (_) {} } };
        }
      } catch (e) {
        // ignore if CancelToken is not available
      }

      const res = await axios.get(`${API_BASE}/getUpdates`, axiosOpts);
      // clear controller reference after successful request
      _currentRequestController = null;
      const dur = Date.now() - start;
      try { metrics.getUpdates_latency_ms.observe(dur); } catch (_) {}
  if (!_running) break;
  if (res.data && res.data.ok && Array.isArray(res.data.result)) {
        try { metrics.updates_total.inc(res.data.result.length || 0); } catch (_) {}
        // Update bot status in DB to indicate successful poll
        try { await writeBotStatus({ last_success: new Date().toISOString(), last_error: null }); } catch (_) {}
        for (const update of res.data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id || 0);
          if (update.message && update.message.text) {
            await handleInboundText(update.message);
          } else if (update.callback_query) {
            await handleCallback(update.callback_query);
          }
        }
      }
    } catch (e) {
      // If the request was aborted (via AbortController), that's expected during shutdown
      const isCanceled = e && (e.name === 'CanceledError' || e.code === 'ERR_CANCELED' || String(e.message || '').toLowerCase().includes('canceled'));
      if (isCanceled && !_running) {
        // clean exit from poll loop
        break;
      }
      // Extract Telegram error details if available
      const errData = e && e.response && e.response.data ? e.response.data : null;
      const description = errData && (errData.description || errData.error) ? (errData.description || errData.error) : (e && e.message ? e.message : String(e));
      const statusCode = e && e.response && e.response.status ? e.response.status : null;
      const code = (e && (e.code || (e.cause && e.cause.code))) || null;
      const descLower = String(description || '').toLowerCase();

      // Determine backoff with special cases
      let backoffMs = 2000;
      let shouldLog = true;
      const isNetworkIssue = (
        code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ECONNRESET' ||
        code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EAI_AGAIN' ||
        code === 'ENOTFOUND' || (!statusCode && !errData && /timeout|network|socket/i.test(descLower))
      );

      if (isNetworkIssue) {
        // Exponential backoff on network errors, capped at 5 minutes
        _netErrorStreak = Math.min(_netErrorStreak + 1, 12);
        backoffMs = Math.min(5 * 60 * 1000, 2000 * Math.pow(2, _netErrorStreak));
        // Suppress noisy logs: log the first few, then at most every 15s
        const now = Date.now();
        if (_netErrorStreak > 3 && (now - _lastNetLogAt) < 15000) {
          shouldLog = false;
        } else {
          _lastNetLogAt = now;
        }
      } else {
        // Reset streak on non-network error
        _netErrorStreak = 0;
      }

      // Auto-recovery cases for Telegram API conflicts
      try {
        // If webhook is set, clear it once and retry
        if (statusCode === 409 && (descLower.includes('webhook') || (descLower.includes('getupdates') && descLower.includes('webhook')))) {
          try {
            if (API_BASE) {
              console.log('[BOT] 409 suggests webhook conflict — attempting to delete webhook once');
              try { await axios.post(`${API_BASE}/deleteWebhook`); console.log('[BOT] deleteWebhook called'); } catch (delErr) { console.warn('[BOT] deleteWebhook failed:', delErr && delErr.response ? delErr.response.data : delErr && delErr.message ? delErr.message : delErr); }
            }
          } catch (_) {}
          backoffMs = Math.max(backoffMs, 3000);
        }
        // If another getUpdates is running elsewhere, use a longer backoff to reduce churn
        if (statusCode === 409 && descLower.includes('terminated') && descLower.includes('getupdates')) {
          if (shouldLog) console.warn('[BOT] Another instance appears to be polling getUpdates. Ensure only one bot instance runs.');
          backoffMs = Math.max(backoffMs, 15000);
        }
      } catch (_) {
        // ignore recovery errors
      }

      if (shouldLog) {
        console.warn('getUpdates poll failed:', description, statusCode ? `(HTTP ${statusCode})` : (code ? `(code ${code})` : ''));
      }
      try { await writeBotStatus({ last_success: null, last_error: description, code: statusCode || code || null }); } catch (_) {}
      try { metrics.bot_errors_total.inc(); } catch (_) {}

      // Backoff then retry
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
}

// Initialize: load settings from DB and start poll loop; periodically reload settings so Settings>Telegram updates take effect
// Start the bot: load settings, start periodic reload, and begin advisory-lock acquisition + poll loop.
async function startTelegramBot() {
  if (_running) return;
  _running = true;
  console.log('Starting Telegram bot poller...');
  await loadTelegramSettings();
  // schedule periodic settings reload using configured interval
  scheduleSettingsReloadTimer();
  // Write initial status
  try { await writeBotStatus({ last_success: null, last_error: null }); } catch (_) {}

  // If webhook mode requested, start webhook receiver (will no-op otherwise)
  let webhookMode = false;
  try {
    await startWebhookIfRequested();
    // Determine webhook mode from env to optionally skip polling
    webhookMode = (process.env.USE_WEBHOOK === 'true' || String(process.env.USE_WEBHOOK || '').toLowerCase() === 'true');
  } catch (e) { console.warn('[BOT] startWebhookIfRequested failed:', e && e.message ? e.message : e); }

  // Register bot commands (Start) so Telegram clients show them
  try { await registerBotCommands(); } catch (_) {}

  // Try to acquire advisory lock; if obtained, start pollLoop. Otherwise retry periodically.
  // In webhook mode, we do NOT start the poll loop to avoid Telegram 409 conflicts.
  const tryAcquireOnce = async () => {
    try {
      const r = await pool.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
      _haveAdvisoryLock = !!(r.rows && r.rows[0] && r.rows[0].ok);
      if (_haveAdvisoryLock && !webhookMode) {
        console.log('[BOT] acquired advisory lock; starting poll loop');
        // start poll loop in background
        _pollLoopPromise = (async () => { try { await pollLoop(); } catch (e) { console.error('bot failed after acquiring lock:', e && e.message ? e.message : e); } })();
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[BOT] advisory lock check failed:', e && e.message ? e.message : e);
      return false;
    }
  };
  // If the bot is disabled via settings, don't attempt to acquire lock / start poll loop
  if (!TELEGRAM_ENABLED) {
    console.log('[BOT] bot is disabled by settings; not starting poll loop');
  } else if (!webhookMode) {
    const acquired = await tryAcquireOnce();
    if (!acquired) {
      console.log('[BOT] advisory lock not available; entering waiter mode and will retry every 30s');
      _acquireInterval = setInterval(async () => {
        const ok = await tryAcquireOnce();
        if (ok && _acquireInterval) {
          clearInterval(_acquireInterval);
          _acquireInterval = null;
        }
      }, 30 * 1000);
    }
  } else {
    console.log('[BOT] webhook mode enabled; skipping long-poll getUpdates loop');
  }
  // Schedule periodic backup/report if configured
  try { scheduleBackupFromSettings(); } catch (e) { console.warn('[BOT] scheduleBackupFromSettings failed:', e && e.message ? e.message : e); }
}

// Apply enabled/disabled state from settings without stopping the settings reload timer.
async function applyBotEnabledState() {
  try {
    if (!TELEGRAM_ENABLED) {
      // If disabling, abort any poll and release lock but keep the settings reload timer so the change can be reverted
      if (_currentRequestController && typeof _currentRequestController.abort === 'function') {
        try { _currentRequestController.abort(); } catch (_) {}
        _currentRequestController = null;
      }
      // release advisory lock if held
      if (_haveAdvisoryLock) {
        try { await pool.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); } catch (_) {}
        _haveAdvisoryLock = false;
        console.log('[BOT] advisory lock released due to bot being disabled');
      }
      // stop any existing poll loop promise reference
      _pollLoopPromise = null;
      // clear any scheduled backup tasks
      try { if (_backupInterval) { clearInterval(_backupInterval); _backupInterval = null; } } catch (_) {}
      try { if (_backupCronTask) { _backupCronTask.stop(); _backupCronTask = null; } } catch (_) {}
      // mark schedule key so enabling later will cause reschedule
      _lastScheduleKey = null;
      return;
    }

    // If enabling and we don't have the advisory lock, try to acquire and start poll loop
    if (!_haveAdvisoryLock) {
      try {
        const r = await pool.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
        _haveAdvisoryLock = !!(r.rows && r.rows[0] && r.rows[0].ok);
        if (_haveAdvisoryLock) {
          console.log('[BOT] acquired advisory lock after enabling; starting poll loop');
          _pollLoopPromise = (async () => { try { await pollLoop(); } catch (e) { console.error('bot failed after acquiring lock:', e && e.message ? e.message : e); } })();
          return;
        }
      } catch (e) {
        console.warn('[BOT] advisory lock check failed while enabling bot:', e && e.message ? e.message : e);
      }
      // If we couldn't get it now, ensure we have a retry loop
      if (!_acquireInterval) {
        _acquireInterval = setInterval(async () => {
          try {
            const r2 = await pool.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
            const ok2 = !!(r2.rows && r2.rows[0] && r2.rows[0].ok);
            if (ok2) {
              _haveAdvisoryLock = true;
              clearInterval(_acquireInterval);
              _acquireInterval = null;
              console.log('[BOT] acquired advisory lock after retry; starting poll loop');
              _pollLoopPromise = (async () => { try { await pollLoop(); } catch (e) { console.error('bot failed after acquiring lock:', e && e.message ? e.message : e); } })();
            }
          } catch (e) {
            // ignore; will retry
          }
        }, 30 * 1000);
      }
    }
  } catch (e) {
    console.warn('[BOT] applyBotEnabledState failed:', e && e.message ? e.message : e);
  }
}

// Helper: Convert expire_date ISO timestamp to correct local YYYY-MM-DD date string
function _fixExpireDate(val) {
  if (!val) return val;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('T')) {
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return val;
      let tz = 'UTC';
      try {
        const settingsCache = require('./lib/settingsCache');
        const cached = settingsCache.getGeneralCached();
        if (cached && cached.timezone) tz = cached.timezone;
      } catch (_) {}
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (_) { return val; }
  }
  return val;
}

// Create a JSON snapshot of key tables (config + small dataset) and return path to temp file
async function createBackupSnapshot() {
  try {
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpdir = os.tmpdir();
    const outPath = path.join(tmpdir, `cmp-backup-${now}.json`);
    // Fetch app settings, servers, server_keys, users, admins (with avatars), domains, and financial snapshots
    const [settingsRes, serversRes, serverKeysRes, usersRes, adminsRes, domainsRes, snapshotsRes] = await Promise.all([
      pool.query('SELECT * FROM app_settings'),
      pool.query('SELECT id, server_name, ip_address, domain_name, owner, service_type, api_key, display_pos, created_at FROM servers'),
      pool.query('SELECT id, server_id, username, description, original_key, generated_key, created_at FROM server_keys'),
      pool.query('SELECT id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, enabled, created_at FROM users'),
      pool.query('SELECT id, display_name, username, role, avatar_url, avatar_data, created_at FROM admins'),
      pool.query('SELECT id, domain, server, service, unlimited, created_at, updated_at FROM domains').catch(() => ({ rows: [] })),
      pool.query('SELECT id, month_start::text as month_start, month_end::text as month_end, server_id, mini_count, basic_count, unlimited_count, price_mini_cents, price_basic_cents, price_unlimited_cents, revenue_cents, created_at, created_by, notes FROM monthly_financial_snapshots ORDER BY month_start ASC').catch(() => ({ rows: [] }))
    ]);
    // Load keyserver config from file
    let keyserverConfig = null;
    try {
      const ksConfigPath = path.join(__dirname, 'data', 'keyserver.json');
      if (fs.existsSync(ksConfigPath)) {
        keyserverConfig = JSON.parse(fs.readFileSync(ksConfigPath, 'utf-8'));
      }
    } catch (_) {}
    const payload = { 
      created_at: new Date().toISOString(), 
      app_settings: settingsRes.rows || [], 
      servers: serversRes.rows || [], 
      server_keys: serverKeysRes.rows || [], 
      users: (usersRes.rows || []).map(u => ({
        ...u,
        expire_date: u.expire_date ? _fixExpireDate(u.expire_date instanceof Date ? u.expire_date.toISOString() : String(u.expire_date)) : null
      })),
      admins: adminsRes.rows || [],
      domains: domainsRes.rows || [],
      financial_snapshots: snapshotsRes.rows || [],
      keyserver_config: keyserverConfig || null,
      note: 'Avatar files in public/uploads/ are not included - backup that directory separately'
    };
    await fs.promises.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
    return outPath;
  } catch (e) {
    console.warn('[BOT] createBackupSnapshot failed:', e && e.message ? e.message : e);
    return null;
  }
}

// ─── Key server ZIP backup ───────────────────────────────────────────────
// Builds a zip archive containing:
//   manifest.json                - summary of what was captured
//   keyserver/config.json        - backend/data/keyserver.json (port, secretKey, configDir, ...)
//   keyserver/token_map.json     - backend/data/token_map.json (token <-> filename mapping)
//   keyserver/keys/<file>        - every generated key file from the key server config dir
//   database.json                - the same DB+config snapshot produced by createBackupSnapshot()
// Returns the path to the zip, or null if it could not be created.
const KEY_ZIP_MAX_BYTES = 45 * 1024 * 1024; // Telegram Bot API download limit is 50MB; stay under it
const KEY_FILE_EXT_RE = /\.(ya?ml|json|txt)$/i;

function _loadKeyserverConfigSafe() {
  try {
    const p = path.join(__dirname, 'data', 'keyserver.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn('[BOT] could not read keyserver.json:', e && e.message ? e.message : e);
    return null;
  }
}

function _loadTokenMapSafe() {
  try {
    const p = path.join(__dirname, 'data', 'token_map.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn('[BOT] could not read token_map.json:', e && e.message ? e.message : e);
    return null;
  }
}

function _collectKeyFiles(configDir) {
  const collected = [];
  if (!configDir || !fs.existsSync(configDir)) return collected;
  let entries = [];
  try { entries = fs.readdirSync(configDir); } catch (e) { return collected; }
  for (const filename of entries) {
    if (!KEY_FILE_EXT_RE.test(filename)) continue;
    const full = path.join(configDir, filename);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      collected.push({ full, filename, size: st.size, modified: st.mtime });
    } catch (_) { /* skip unreadable entries */ }
  }
  return collected;
}

// Create the keys + key server config zip. `dbSnapshotPath` is the JSON produced by
// createBackupSnapshot(); it is embedded so a single archive is enough to restore everything.
function _resolveArchiverFactory() {
  let mod = null;
  try { mod = require('archiver'); } catch (e) { return null; }
  if (!mod) return null;
  // archiver >= 8 exports named classes; archiver <= 7 exports a factory function.
  if (typeof mod === 'function') return (opts) => mod('zip', opts);
  if (typeof mod.ZipArchive === 'function') return (opts) => new mod.ZipArchive(opts);
  if (typeof mod.create === 'function') return (opts) => mod.create('zip', opts);
  return null;
}

async function createKeysZipBackup(dbSnapshotPath = null) {
  const createArchive = _resolveArchiverFactory();
  if (!createArchive) {
    console.warn('[BOT] archiver module not installed; skipping key zip backup');
    return null;
  }

  const started = Date.now();
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(os.tmpdir(), `cmp-keys-backup-${stamp}.zip`);

    const keyserverConfig = _loadKeyserverConfigSafe();
    const configDir = (keyserverConfig && keyserverConfig.configDir) || '/srv/cmp/configs';
    const keyFiles = _collectKeyFiles(configDir);
    const totalKeyBytes = keyFiles.reduce((s, f) => s + (f.size || 0), 0);

    if (totalKeyBytes > KEY_ZIP_MAX_BYTES) {
      console.warn('[BOT] key files total %s bytes which exceeds the %s byte zip limit; skipping key zip backup',
        totalKeyBytes, KEY_ZIP_MAX_BYTES);
      return null;
    }

    const tokenMap = _loadTokenMapSafe();

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = createArchive({ zlib: { level: 9 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.on('warning', (w) => { console.warn('[BOT] archiver warning:', w && w.message ? w.message : w); });
      archive.pipe(output);

      // Manifest first so the archive is self-describing
      const manifest = {
        kind: 'cmp-keys-and-keyserver-backup',
        version: 1,
        created_at: new Date().toISOString(),
        keyserver_config_dir: configDir,
        keyserver_config_file_present: !!keyserverConfig,
        token_map_present: !!tokenMap,
        key_file_count: keyFiles.length,
        key_files_total_bytes: totalKeyBytes,
        database_snapshot_included: !!dbSnapshotPath,
        key_files: keyFiles.map(f => ({ filename: f.filename, size: f.size, modified: f.modified })),
        restore_hint: [
          'Place keyserver/config.json at backend/data/keyserver.json',
          'Place keyserver/token_map.json at backend/data/token_map.json',
          'Copy keyserver/keys/* into the configDir configured in keyserver.json',
          'database.json mirrors the DB+config JSON backup (app_settings, servers, server_keys, users, admins, domains, financial_snapshots)',
        ].join('\n')
      };
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // Key server configuration + token map
      if (keyserverConfig) {
        archive.append(JSON.stringify(keyserverConfig, null, 2), { name: 'keyserver/config.json' });
      }
      if (tokenMap) {
        archive.append(JSON.stringify(tokenMap, null, 2), { name: 'keyserver/token_map.json' });
      }

      // Generated key files (yaml/yml/json/txt), including companion .meta.json files
      for (const f of keyFiles) {
        archive.file(f.full, { name: `keyserver/keys/${f.filename}` });
      }

      // Embed the database snapshot for a single-file restore
      if (dbSnapshotPath && fs.existsSync(dbSnapshotPath)) {
        archive.file(dbSnapshotPath, { name: 'database.json' });
      }

      archive.finalize();
    });

    const stats = await fs.promises.stat(outPath);
    console.log('[BOT] created keys zip backup: %s (%s key files, %s bytes) in %sms',
      outPath, keyFiles.length, stats.size, Date.now() - started);
    return outPath;
  } catch (e) {
    console.warn('[BOT] createKeysZipBackup failed:', e && e.message ? e.message : e);
    return null;
  }
}

// Perform a periodic report and, if enabled, send a backup to DEFAULT_CHAT_ID
async function performPeriodicReportAndBackup() {
  try {
    // Rate-limit guard: prevent backups running too frequently (in case of reschedule bugs)
    try {
      const now = Date.now();
      if (_lastBackupAt && (now - _lastBackupAt) < BACKUP_MIN_INTERVAL_MS) {
        try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [DEFAULT_CHAT_ID || null, null, null, 'system', null, null, 'backup_skipped_rate_limited', { last_run: new Date(_lastBackupAt).toISOString() }]); } catch (_) {}
        return;
      }
      _lastBackupAt = now;
    } catch (e) {
      // ignore rate limit check failures
    }
    if (!BACKUP_DB_AND_CONFIG) {
      try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [DEFAULT_CHAT_ID || null, null, null, 'system', null, null, 'backup_skipped_disabled', { reason: 'backup_disabled' }]); } catch (_) {}
      return;
    }
    if (!API_BASE) {
      console.log('[BOT] API_BASE not configured; skipping periodic backup/report');
      try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [DEFAULT_CHAT_ID || null, null, null, 'system', null, null, 'backup_skipped_no_token', { reason: 'no_token' }]); } catch (_) {}
      return;
    }
    const target = DEFAULT_CHAT_ID;
    if (!target) {
      console.log('[BOT] No DEFAULT_CHAT_ID configured; skipping periodic backup/report');
      try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [null, null, null, 'system', null, null, 'backup_skipped_no_target', { reason: 'no_target' }]); } catch (_) {}
      return;
    }
    // Send a short summary with current time in configured timezone
    const dash = await fetchDashboard();
    const currentTime = formatDateTimeWithTZ();
    const text = dash ? `<b>🔁 Periodic Report</b>\n🕐 Time: ${currentTime}\n📡 Servers: ${dash.totalServers} | 👥 Users: ${dash.totalUsers}\n⚙️ Status: Active ${dash.status.active}, Soon ${dash.status.soon}, Expired ${dash.status.expired}` : `<b>🔁 Periodic Report</b>\n🕐 Time: ${currentTime}\n(Stats unavailable)`;
    await sendMessage(target, text);
    // Create and send backup file
    const filePath = await createBackupSnapshot();
    if (filePath) {
      try {
        await sendDocument(target, filePath, `DB+config backup ${currentTime}`);
        // record success audit with file metadata
        try {
          let stats = null;
          try { stats = await fs.promises.stat(filePath); } catch (_) { stats = null; }
          const payload = { type: 'backup', file: path.basename(filePath), size: stats && stats.size || null, created_at: new Date().toISOString() };
          await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [target, null, null, 'system', null, null, 'backup_sent', payload]);
        } catch (_) {}
      } catch (e) {
        try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, error, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [target, null, null, 'system', null, null, 'backup_failed', (e && e.message) ? String(e.message) : String(e), { type: 'backup', file: path.basename(filePath) }]); } catch (_) {}
      }
    }

    // Build and send the keys + key server configuration zip (single archive, includes the DB snapshot)
    let zipPath = null;
    try {
      zipPath = await createKeysZipBackup(filePath);
    } catch (zipErr) {
      console.warn('[BOT] failed to build keys zip backup:', zipErr && zipErr.message ? zipErr.message : zipErr);
    }
    // The JSON snapshot is already sent on its own; remove the temp copy once the zip has embedded it.
    if (filePath) { try { await fs.promises.unlink(filePath); } catch (_) {} }
    if (zipPath) {
      try {
        let zstats = null;
        try { zstats = await fs.promises.stat(zipPath); } catch (_) { zstats = null; }
        const sizeKb = zstats && zstats.size ? Math.round(zstats.size / 1024) : null;
        await sendDocument(target, zipPath, `🔐 Keys + key server config backup${sizeKb ? ` (${sizeKb} KB)` : ''}\n🕐 ${currentTime}`);
        try {
          const payload = { type: 'keys_zip_backup', file: path.basename(zipPath), size: zstats && zstats.size || null, created_at: new Date().toISOString() };
          await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [target, null, null, 'system', null, null, 'keys_backup_sent', payload]);
        } catch (_) {}
      } catch (e) {
        try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, error, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [target, null, null, 'system', null, null, 'keys_backup_failed', (e && e.message) ? String(e.message) : String(e), { type: 'keys_zip_backup', file: path.basename(zipPath) }]); } catch (_) {}
      }
      try { await fs.promises.unlink(zipPath); } catch (_) {}
    } else {
      try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [target, null, null, 'system', null, null, 'keys_backup_skipped', { reason: 'zip_not_created' }]); } catch (_) {}
    }
  } catch (e) {
    console.warn('[BOT] performPeriodicReportAndBackup failed:', e && e.message ? e.message : e);
  }
}

function scheduleBackupFromSettings() {
  try {
    // Compute schedule key and bail early if nothing changed to avoid noisy logs
    const newKey = JSON.stringify({ enabled: TELEGRAM_ENABLED, backup: BACKUP_DB_AND_CONFIG, cron: NOTIFICATION_CRON, mins: NOTIFICATION_TIME_MINUTES, tz: NOTIFICATION_TZ });
    // If nothing changed since last schedule, skip rescheduling to avoid churn and logs
    if (_lastScheduleKey === newKey) return;
    const prevKey = _lastScheduleKey;
    _lastScheduleKey = newKey;

    // Clear any existing scheduled tasks to avoid duplicates
    try { if (_backupInterval) { clearInterval(_backupInterval); _backupInterval = null; } } catch (_) {}
    try { if (_backupCronTask) { _backupCronTask.stop(); _backupCronTask = null; } } catch (_) {}

    // If the bot is globally disabled or backups are disabled, stop here and log only on state change
    if (!TELEGRAM_ENABLED || !BACKUP_DB_AND_CONFIG) {
      // Only log when the schedule state actually changed
      try {
        console.log('[BOT] periodic backup/report disabled by settings (enabled=%s backup=%s)', TELEGRAM_ENABLED ? 'YES' : 'NO', BACKUP_DB_AND_CONFIG ? 'YES' : 'NO');
      } catch (_) {}
      return;
    }

  // If a cron expression is configured, prefer that
  if (NOTIFICATION_CRON) {
      // validate cron; if invalid, log and fall back to minute schedule (if any)
      if (cron.validate(NOTIFICATION_CRON)) {
        _backupCronTask = cron.schedule(NOTIFICATION_CRON, () => {
          try { performPeriodicReportAndBackup(); } catch (e) { console.warn('[BOT] scheduled cron backup error:', e && e.message ? e.message : e); }
        }, { scheduled: true, timezone: NOTIFICATION_TZ || undefined });
        // Do NOT run a backup immediately at schedule time; backups should only run on cron triggers.
        console.log('[BOT] scheduled periodic backup/report using cron expression: %s (tz=%s)', NOTIFICATION_CRON, NOTIFICATION_TZ || 'local');
        return;
      }
      console.warn('[BOT] notification cron expression is invalid: %s - falling back to minute-based schedule if configured', NOTIFICATION_CRON);
    }
    // Fallback to minutes-based scheduling for backward compatibility
    const mins = (typeof NOTIFICATION_TIME_MINUTES === 'number' && Number.isFinite(NOTIFICATION_TIME_MINUTES) && NOTIFICATION_TIME_MINUTES > 0) ? NOTIFICATION_TIME_MINUTES : 24 * 60; // default daily
    // schedule
    _backupInterval = setInterval(() => {
      try { performPeriodicReportAndBackup(); } catch (e) { console.warn('[BOT] scheduled backup error:', e && e.message ? e.message : e); }
    }, mins * 60 * 1000);
    // Do NOT run once immediately; rely on scheduled intervals.
    console.log('[BOT] scheduled periodic backup/report every %s minutes', mins);
  } catch (e) {
    console.warn('[BOT] scheduleBackupFromSettings failed:', e && e.message ? e.message : e);
  }
}

// Webhook mode support: if USE_WEBHOOK=true, start a tiny express receiver and set webhook
// Webhook mode support: if USE_WEBHOOK=true, start a tiny express receiver and set webhook
async function startWebhookIfRequested() {
  if (!(process.env.USE_WEBHOOK === 'true' || String(process.env.USE_WEBHOOK || '').toLowerCase() === 'true')) return;
  try {
      const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || 3002);
      const WEBHOOK_URL = process.env.WEBHOOK_URL; // public URL where Telegram will POST updates
      if (!WEBHOOK_URL) {
        console.error('[WEBHOOK] WEBHOOK_URL not configured; cannot enable webhook mode');
        return;
      }
      // Ensure we have a token loaded (it may come from DB). Wait briefly if not present.
      if (!TELEGRAM_TOKEN) {
        const start = Date.now();
        const timeoutMs = 30 * 1000; // wait up to 30s for settings loader to populate token
        while (!TELEGRAM_TOKEN && (Date.now() - start) < timeoutMs) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (!TELEGRAM_TOKEN) {
        console.error('[WEBHOOK] No TELEGRAM_TOKEN available after waiting for settings; aborting webhook setup');
        return;
      }
      // Build a non-secret, non-token-exposing path. Prefer BOT_USERNAME if present.
      const safeSuffix = BOT_USERNAME ? encodeURIComponent(BOT_USERNAME) : `bot-${String(TELEGRAM_TOKEN).slice(-10)}`;
      const WEBHOOK_PATH = process.env.WEBHOOK_PATH || `/webhook/telegram/${safeSuffix}`;
      // set webhook
      try {
        const setRes = await axios.post(`${API_BASE || `https://api.telegram.org/bot${TELEGRAM_TOKEN}`}/setWebhook`, { url: `${WEBHOOK_URL}${WEBHOOK_PATH}` });
        if (!(setRes.data && setRes.data.ok)) {
          console.error('[WEBHOOK] setWebhook failed', setRes.data);
        } else {
          console.log('[WEBHOOK] setWebhook OK ->', `${WEBHOOK_URL}${WEBHOOK_PATH}`);
        }
      } catch (e) {
        console.error('[WEBHOOK] setWebhook error:', e && e.response ? e.response.data : e && e.message ? e.message : e);
      }

    const wapp = express();
    wapp.use(bodyParser.json({ limit: '1mb' }));
    wapp.post(WEBHOOK_PATH, async (req, res) => {
      try {
        const update = req.body;
        try { metrics.updates_total.inc(1); } catch (_) {}
        // mirror the same handling as in pollLoop for a single update
        if (update.message && update.message.text) {
          await handleInboundText(update.message);
        } else if (update.callback_query) {
          await handleCallback(update.callback_query);
        }
        res.json({ ok: true });
      } catch (e) {
        try { metrics.bot_errors_total.inc(); } catch (_) {}
        console.error('[WEBHOOK] processing failed:', e && e.message ? e.message : e);
        res.status(500).json({ ok: false });
      }
    });
    _webhookServer = wapp.listen(WEBHOOK_PORT, () => console.log('[WEBHOOK] listening on port', WEBHOOK_PORT, 'path', WEBHOOK_PATH));
  } catch (e) {
    console.error('[WEBHOOK] initialization failed:', e && e.message ? e.message : e);
  }
}

// Keep logging of unhandled rejections / uncaught exceptions but don't exit the process here;
// let the host application decide how to handle shutdown.
process.on('unhandledRejection', (reason, promise) => {
  try { metrics.bot_errors_total.inc(); } catch (_) {}
  console.error('[BOT] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  try { metrics.bot_errors_total.inc(); } catch (_) {}
  console.error('[BOT] uncaughtException:', err && err.stack ? err.stack : err);
});

// Graceful shutdown: release advisory lock and stop internal loops
async function releaseLock() {
  try {
    if (_haveAdvisoryLock) {
      try { await pool.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); console.log('[BOT] advisory lock released'); } catch (_) {}
      _haveAdvisoryLock = false;
    }
  } catch (e) {
    console.warn('[BOT] error releasing advisory lock:', e && e.message ? e.message : e);
  }
}

async function stopTelegramBot() {
  if (!_running) return;
  console.log('[BOT] stop requested — shutting down bot');
  _running = false;
  // clear intervals
  try { if (_settingsInterval) { clearInterval(_settingsInterval); _settingsInterval = null; } } catch(_) {}
  try { if (_acquireInterval) { clearInterval(_acquireInterval); _acquireInterval = null; } } catch(_) {}
  // Abort any in-flight long-poll request so the loop can exit quickly
  try {
    if (_currentRequestController && typeof _currentRequestController.abort === 'function') {
      try { _currentRequestController.abort(); } catch (_) {}
      _currentRequestController = null;
    }
  } catch (_) {}
  // close webhook server if present
  if (_webhookServer && typeof _webhookServer.close === 'function') {
    try {
      await new Promise((resolve) => _webhookServer.close(() => resolve()));
      _webhookServer = null;
    } catch (e) {
      console.warn('[BOT] error closing webhook server:', e && e.message ? e.message : e);
    }
  }
  // release advisory lock
  await releaseLock();
  // clear backup interval
  try { if (_backupInterval) { clearInterval(_backupInterval); _backupInterval = null; } } catch (_) {}
  // stop cron task if present
  try { if (_backupCronTask) { _backupCronTask.stop(); _backupCronTask = null; } } catch (_) {}
  // wait for poll loop to finish (with timeout)
  if (_pollLoopPromise) {
    try {
      await Promise.race([_pollLoopPromise, new Promise(r => setTimeout(r, 5000))]);
    } catch (e) {
      console.warn('[BOT] poll loop did not finish cleanly:', e && e.message ? e.message : e);
    }
  }
  console.log('[BOT] stopped');
}

module.exports = { startTelegramBot, stopTelegramBot };

// Export a one-off backup runner so external scripts can trigger a single report+backup
async function doOneOffBackup() {
  try {
    await loadTelegramSettings();
    await performPeriodicReportAndBackup();
  } catch (e) {
    console.warn('[BOT] doOneOffBackup failed:', e && e.message ? e.message : e);
    throw e;
  }
}
module.exports.doOneOffBackup = doOneOffBackup;

// Notify via Telegram when a login occurs. Fire-and-forget; respects LOGIN_NOTIFICATION flag.
async function notifyLoginEvent(info) {
  try {
    if (!TELEGRAM_ENABLED) {
      // bot globally disabled
      try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [DEFAULT_CHAT_ID || null, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'skipped_bot_disabled', info || null]); } catch (_) {}
      return;
    }
    if (!LOGIN_NOTIFICATION) {
      // global disabled, still record audit as skipped
      try {
  await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [DEFAULT_CHAT_ID || null, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'skipped_global_off', info || null]);
      } catch (_) {}
      return;
    }
    if (!API_BASE) {
      // settings not yet loaded; skip but record audit
      try {
  await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [DEFAULT_CHAT_ID || null, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'skipped_no_token', info || null]);
      } catch (_) {}
      return;
    }
    const target = DEFAULT_CHAT_ID;
    if (!target) {
  try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [null, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'skipped_no_target', info || null]); } catch (_) {}
      return;
    }
    // check per-chat override
    try {
      const chatPref = await getChatNotificationEnabled(target);
      if (chatPref === false) {
  try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [target, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'skipped_chat_opt_out', info || null]); } catch (_) {}
        return;
      }
    } catch (e) {
      // continue if override check fails
    }
    const parts = [];
    parts.push('<b>🔑 Login Notification</b>');
    if (info && info.username) parts.push(`👤 User: ${escapeHtml(info.username)}`);
  // Show the role instead of raw ID in the notification for readability
  if (info && info.role) parts.push(`🎖 Role: ${escapeHtml(String(info.role))}`);
    if (info && info.ip) parts.push(`📡 IP: ${escapeHtml(info.ip)}`);
    if (info && info.userAgent) parts.push(`🖥️ UA: ${escapeHtml(String(info.userAgent)).slice(0,200)}`);
    parts.push(`📅 ${new Date().toISOString()}`);
    // attempt send
    try {
      await sendMessage(target, parts.join('\n'));
  try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [target, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'sent', info || null]); } catch (_) {}
    } catch (e) {
  try { await pool.query('INSERT INTO telegram_login_notify_audit (chat_id, admin_id, role, username, ip, user_agent, status, error, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [target, info && info.adminId || null, info && info.role || null, info && info.username || null, info && info.ip || null, info && info.userAgent || null, 'failed', (e && (e.response && e.response.data) ? JSON.stringify(e.response.data) : (e && e.message ? String(e.message) : String(e))), info || null]); } catch (_) {}
    }
  } catch (e) {
    console.warn('[BOT] notifyLoginEvent failed:', e && e.message ? e.message : e);
  }
}

// Export notify helper
module.exports.notifyLoginEvent = notifyLoginEvent;

// Helper to write bot status into app_settings.telegram_bot_status (throttled)
let _lastStatusWrite = 0;
async function writeBotStatus(obj) {
  try {
    const now = Date.now();
    if (now - _lastStatusWrite < 15000) return; // throttle writes to at most every 15s
    _lastStatusWrite = now;
    const next = { ...(obj || {}), updated_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      ['telegram_bot_status', next, null]
    );
  } catch (e) {
    // don't crash the bot for status write failures
    console.warn('[BOT] writeBotStatus failed:', e && e.message ? e.message : e);
  }
}

// Note: process signal handlers are intentionally not registered here so the host
// application (e.g. index.js) can orchestrate graceful shutdown by calling
// stopTelegramBot() and closing the HTTP server.

// Export an on-demand apply function to reload settings and re-apply scheduling/enabled state immediately.
async function applySettingsNow() {
  await loadTelegramSettings();
  await applyBotEnabledState();
  await scheduleBackupFromSettings();
  // If settings interval changed, reschedule timer
  scheduleSettingsReloadTimer();
  return { reloaded: true, enabled: TELEGRAM_ENABLED, reload_seconds: SETTINGS_RELOAD_SECONDS, cron: NOTIFICATION_CRON || null };
}
module.exports.applySettingsNow = applySettingsNow;
// Exported for tests/scripts: build a zip of all key files + key server configuration.
module.exports.createKeysZipBackup = createKeysZipBackup;
module.exports.performPeriodicReportAndBackup = performPeriodicReportAndBackup;
