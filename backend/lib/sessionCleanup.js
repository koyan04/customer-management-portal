/**
 * Session Cleanup Scheduler
 * Periodically cleans up expired sessions and updates last_seen timestamps
 */

const pool = require('../db');

let cleanupTimer = null;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TIMEOUT_MINUTES = 60;

async function cleanupExpiredSessions() {
  try {
    console.log('[session-cleanup] Running expired session cleanup...');
    
    // Find all expired sessions and update last_seen before deleting them
    const expiredSessions = await pool.query(
      `SELECT admin_id, last_activity 
       FROM active_sessions 
       WHERE last_activity < NOW() - INTERVAL '1 minute' * $1`,
      [SESSION_TIMEOUT_MINUTES]
    );
    
    if (expiredSessions.rows && expiredSessions.rows.length > 0) {
      console.log(`[session-cleanup] Found ${expiredSessions.rows.length} expired sessions`);
      
      // Update last_seen for users with expired sessions
      for (const row of expiredSessions.rows) {
        try {
          await pool.query(
            'UPDATE admins SET last_seen = $1 WHERE id = $2',
            [row.last_activity, row.admin_id]
          );
        } catch (e) {
          console.error('[session-cleanup] Failed to update last_seen for admin', row.admin_id, e.message);
        }
      }
      
      // Delete expired sessions
      const deleteResult = await pool.query(
        'DELETE FROM active_sessions WHERE last_activity < NOW() - INTERVAL \'1 minute\' * $1',
        [SESSION_TIMEOUT_MINUTES]
      );
      
      console.log(`[session-cleanup] Cleaned up ${deleteResult.rowCount || 0} expired sessions`);
    } else {
      console.log('[session-cleanup] No expired sessions found');
    }
  } catch (err) {
    console.error('[session-cleanup] Error during cleanup:', err.message);
  }
}

function startSessionCleanup() {
  if (cleanupTimer) {
    console.warn('[session-cleanup] Cleanup already running');
    return;
  }
  
  console.log(`[session-cleanup] Starting periodic cleanup (every ${CLEANUP_INTERVAL_MS / 1000}s, timeout=${SESSION_TIMEOUT_MINUTES}min)`);
  
  // Run immediately on start
  cleanupExpiredSessions().catch(err => {
    console.error('[session-cleanup] Initial cleanup failed:', err.message);
  });
  
  // Then run periodically
  cleanupTimer = setInterval(() => {
    cleanupExpiredSessions().catch(err => {
      console.error('[session-cleanup] Periodic cleanup failed:', err.message);
    });
  }, CLEANUP_INTERVAL_MS);
}

function stopSessionCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[session-cleanup] Stopped periodic cleanup');
  }
}

module.exports = {
  startSessionCleanup,
  stopSessionCleanup,
  cleanupExpiredSessions
};
