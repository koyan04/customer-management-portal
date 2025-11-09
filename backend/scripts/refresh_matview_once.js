#!/usr/bin/env node
// One-off trigger for user status matview refresh
require('dotenv').config({ path: __dirname + '/../.env' });
const log = require('../lib/logger');
(async () => {
  try {
    const { refreshNow } = require('../lib/matview_refresh');
    await refreshNow();
    log.info('matview-refresh-once-ok');
    process.exit(0);
  } catch (e) {
    log.error('matview-refresh-once-failed', { error: e.message || String(e) });
    process.exit(1);
  }
})();
