#!/usr/bin/env node
/*
  CMP Background Worker
  Responsibilities (extensible):
   - Periodic matview refresh if USE_USER_STATUS_MATVIEW=1 and MATVIEW_REFRESH_INTERVAL_SEC set
   - Future: queue processing, email/telegram batch jobs
*/
const pool = require('../db');
const log = require('../lib/logger');

function seconds(n) { return n * 1000; }

let _interval;

async function maybeRefreshMatview() {
  try {
    const enabled = String(process.env.USE_USER_STATUS_MATVIEW || '').match(/^(1|true|yes|on)$/i);
    if (!enabled) return;
    const intervalSec = Number(process.env.MATVIEW_REFRESH_INTERVAL_SEC || '0');
    if (!intervalSec || intervalSec < 30) return; // guard minimum
    if (_interval) return; // already scheduled
    log.info('matview-refresh-schedule', { everySec: intervalSec });
    _interval = setInterval(async () => {
      try {
        const { refreshUserStatusMatview } = require('../lib/matview_refresh');
        await refreshUserStatusMatview();
        log.info('matview-refresh-complete');
      } catch (e) {
        log.error('matview-refresh-failed', { error: e.message || String(e) });
      }
    }, seconds(intervalSec));
    if (typeof _interval.unref === 'function') _interval.unref();
  } catch (e) {
    log.error('matview-refresh-schedule-error', { error: e.message || String(e) });
  }
}

async function start() {
  log.info('worker-start', { pid: process.pid });
  await maybeRefreshMatview();
}

process.on('SIGTERM', async () => {
  log.info('worker-shutdown');
  try { if (_interval) clearInterval(_interval); } catch(_){}
  try { await pool.shutdown?.(); } catch(_){}
  process.exit(0);
});

start();
