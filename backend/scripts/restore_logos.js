#!/usr/bin/env node
/**
 * Restore script for logos
 * Restores logo files from the most recent backup
 * Run this after database restore if logos are missing
 */

const fs = require('fs');
const path = require('path');

const logosDir = path.join(__dirname, '..', 'public', 'logos');
const backupDir = path.join(__dirname, '..', 'logo_backups');

try {
  // Ensure logos directory exists
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
  }

  if (!fs.existsSync(backupDir)) {
    console.log('No backup directory found. Please run backup_logos.js first.');
    process.exit(1);
  }

  // Find most recent backup
  const backups = fs.readdirSync(backupDir)
    .filter(name => name.startsWith('logos_'))
    .map(name => ({
      name,
      path: path.join(backupDir, name),
      time: fs.statSync(path.join(backupDir, name)).mtime
    }))
    .sort((a, b) => b.time - a.time);

  if (backups.length === 0) {
    console.log('No logo backups found.');
    process.exit(1);
  }

  const latestBackup = backups[0];
  console.log(`Restoring from: ${latestBackup.name}`);

  // Copy all files from backup to logos directory
  const files = fs.readdirSync(latestBackup.path);
  let restored = 0;

  for (const file of files) {
    const srcPath = path.join(latestBackup.path, file);
    const destPath = path.join(logosDir, file);
    
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
      restored++;
    }
  }

  console.log(`✓ Restored ${restored} logo files from backup`);
  console.log('✓ Logo files are now available at backend/public/logos/');
  console.log('✓ Your logos should now display correctly in the application');
  
} catch (err) {
  console.error('Restore failed:', err.message);
  process.exit(1);
}
