// Minimal structured logger emitting JSON lines. Falls back to console if JSON serialization fails.
// Usage: const log = require('./lib/logger'); log.info('message', { extra: 1 })

function fmt(level, msg, meta) {
  const payload = {
    level,
    msg,
    ts: new Date().toISOString(),
  };
  if (meta && typeof meta === 'object') {
    try {
      Object.assign(payload, meta);
    } catch (_) {}
  }
  return JSON.stringify(payload);
}

const logger = {
  info(msg, meta) {
    try { console.log(fmt('info', msg, meta)); } catch (_) { console.log(msg, meta || ''); }
  },
  warn(msg, meta) {
    try { console.warn(fmt('warn', msg, meta)); } catch (_) { console.warn(msg, meta || ''); }
  },
  error(msg, meta) {
    try { console.error(fmt('error', msg, meta)); } catch (_) { console.error(msg, meta || ''); }
  },
  debug(msg, meta) {
    if (process.env.NODE_ENV !== 'production') {
      try { console.debug(fmt('debug', msg, meta)); } catch (_) { console.debug(msg, meta || ''); }
    }
  }
};

module.exports = logger;
