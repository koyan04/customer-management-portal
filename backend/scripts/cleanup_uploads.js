#!/usr/bin/env node
// Removes files in public/uploads older than N days (default 7). Run as a cron or manually.
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
const days = parseInt(process.env.CLEANUP_DAYS || '7', 10);
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
(async () => {
  try {
    const files = await fs.promises.readdir(uploadsDir);
    let removed = 0;
    for (const f of files) {
      try {
        const p = path.join(uploadsDir, f);
        const stat = await fs.promises.stat(p);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fs.promises.unlink(p);
          console.log('Removed', f);
          removed++;
        }
      } catch (e) { console.warn('Skipping', f, e && e.message); }
    }
    console.log(`Cleanup complete. Removed ${removed} files older than ${days} days.`);
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
