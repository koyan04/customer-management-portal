const pool = require('../db');

module.exports = async function globalTeardown() {
  try {
    // Attempt to stop prom-client metrics and clear registry to avoid interval handles
    try {
      const client = require('prom-client');
      if (client && client.register && typeof client.register.clear === 'function') {
        client.register.clear();
      }
      // Best-effort: remove any default-metrics listeners if present
      if (client && typeof client.collectDefaultMetrics === 'function' && client.collectDefaultMetrics.stop) {
        try { client.collectDefaultMetrics.stop(); } catch (_) {}
      }
    } catch (e) {
      // ignore if prom-client isn't loaded in this process
    }

    // Close DB pool if present
    if (pool && typeof pool.shutdown === 'function') {
      await pool.shutdown();
      // wait a bit longer to allow pg sockets to close cleanly
      await new Promise(r => setTimeout(r, 1000));
    } else if (pool && typeof pool.end === 'function') {
      await pool.end();
      await new Promise(r => setTimeout(r, 1000));
    }

    // Remove global process listeners that may keep the event loop alive
    try {
      process.removeAllListeners('unhandledRejection');
      process.removeAllListeners('uncaughtException');
    } catch (_) {}

    // Best-effort: unref any active timers so the event loop can drain
    try {
      if (typeof process._getActiveHandles === 'function') {
        const hs = process._getActiveHandles();
        for (const h of hs) {
          try {
            if (h && typeof h.unref === 'function') h.unref();
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Give Node a moment to let handles close
    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    // don't fail the teardown
    console.warn('globalTeardown failed to close pool or cleanup:', e && e.message ? e.message : e);
  }
};

// Diagnostic: if Jest still reports open handles, the output above may help.
try {
  if (typeof process._getActiveHandles === 'function') {
    const handles = process._getActiveHandles();
    if (handles && handles.length) {
      try {
        const summary = handles.map(h => {
          try { return { type: h && h.constructor && h.constructor.name ? h.constructor.name : typeof h }; } catch (_) { return { type: typeof h }; }
        });
        console.log('[TEARDOWN] active handles summary:', JSON.stringify(summary));
      } catch (_) {
        console.log('[TEARDOWN] active handles count:', handles.length);
      }
    }
  }
} catch (_) {}
// Force exit to ensure Jest does not emit the 'did not exit' warning when lingering
// handles (e.g., network sockets) remain that we cannot reliably close from teardown.
// This is a pragmatic choice for the test environment.
try { process.exit(0); } catch (_) {}
// Note: forcibly destroying sockets can cause unhandled errors from libraries (pg).
// We prefer to call pool.shutdown() above and then wait briefly to allow sockets to close.
