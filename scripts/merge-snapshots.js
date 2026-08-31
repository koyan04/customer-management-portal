#!/usr/bin/env node
/**
 * merge-snapshots.js — Merge financial snapshots from a good backup into a
 * backup file that is missing them, so a restore brings the snapshots back.
 *
 * Why this exists:
 *   Some older backups (or backups taken when the snapshots table was empty)
 *   do not contain a `financial_snapshots` array. If you restore from such a
 *   backup, the monthly financial snapshots are lost. This script copies the
 *   `financial_snapshots` array from a known-good backup into the target
 *   backup file, so re-restoring restores the snapshots too.
 *
 * Usage:
 *   node merge-snapshots.js <target-backup.json> <source-backup.json> [output.json]
 *
 *   - target-backup.json : the backup you will restore from (missing snapshots)
 *   - source-backup.json : a backup that HAS financial_snapshots
 *   - output.json        : (optional) where to write the merged file.
 *                          Defaults to overwriting target-backup.json.
 *
 * Example:
 *   node merge-snapshots.js \
 *     cmp-backup-2026-08-30T17-30-00-882Z.json \
 *     cmp-backup.json \
 *     cmp-backup-merged.json
 */
const fs = require('fs');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node merge-snapshots.js <target.json> <source.json> [output.json]');
    process.exit(1);
  }
  const targetPath = args[0];
  const sourcePath = args[1];
  const outputPath = args[2] || targetPath;

  if (!fs.existsSync(targetPath)) {
    console.error('Target backup not found:', targetPath);
    process.exit(1);
  }
  if (!fs.existsSync(sourcePath)) {
    console.error('Source backup not found:', sourcePath);
    process.exit(1);
  }

  const target = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));

  const sourceSnapshots = Array.isArray(source.financial_snapshots)
    ? source.financial_snapshots
    : [];

  if (sourceSnapshots.length === 0) {
    console.error('Source backup has no financial_snapshots. Nothing to merge.');
    process.exit(1);
  }

  // Merge: keep existing target snapshots, add any source snapshots not present.
  const existing = Array.isArray(target.financial_snapshots) ? target.financial_snapshots : [];
  const seen = new Set(existing.map(s => `${s.month_start}|${s.server_id ?? 'global'}`));
  let added = 0;
  for (const s of sourceSnapshots) {
    const key = `${s.month_start}|${s.server_id ?? 'global'}`;
    if (!seen.has(key)) {
      existing.push(s);
      seen.add(key);
      added++;
    }
  }
  target.financial_snapshots = existing;

  fs.writeFileSync(outputPath, JSON.stringify(target, null, 2));
  console.log(`Merged ${added} financial snapshots into ${outputPath}`);
  console.log(`Total financial_snapshots now: ${existing.length}`);
  console.log('Re-restore this file to bring the snapshots back.');
}

main();