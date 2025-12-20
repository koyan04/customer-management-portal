#!/usr/bin/env node
/**
 * Backup script for logos
 * Creates a backup of all logo files to a timestamped directory
 * Run this before database restore to preserve logos
 */

const fs = require('fs');
const path = require('path');

const logosDir = path.join(__dirname, '..', 'public', 'logos');
const backupDir = path.join(__dirname, '..', 'logo_backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = path.join(backupDir, `logos_${timestamp}`);

try {
  // Create backup directory
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  if (!fs.existsSync(logosDir)) {
    console.log('No logos directory found, nothing to backup');
    process.exit(0);
  }

  // Create timestamped backup subdirectory
  fs.mkdirSync(backupPath, { recursive: true });

  // Copy all files from logos directory
  const files = fs.readdirSync(logosDir);
  let copied = 0;
  
  for (const file of files) {
    const srcPath = path.join(logosDir, file);
    const destPath = path.join(backupPath, file);
    
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
      copied++;
    }
  }

  console.log(`✓ Backed up ${copied} logo files to: ${backupPath}`);
  console.log('You can restore these logos after database restore by running: node scripts/restore_logos.js');
  
} catch (err) {
  console.error('Backup failed:', err.message);
  process.exit(1);
}
