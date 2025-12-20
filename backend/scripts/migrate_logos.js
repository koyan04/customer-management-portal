#!/usr/bin/env node
/**
 * One-time migration script to move logos from uploads to logos directory
 * Run this once after upgrading to the new logo persistence system
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
const logosDir = path.join(__dirname, '..', 'public', 'logos');

async function migrate() {
  console.log('Starting logo migration...\n');

  // Ensure logos directory exists
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
    console.log('✓ Created logos directory');
  }

  // Connect to database
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'user_mgmt',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || ''
  });

  try {
    // Get current logo URLs from database
    const result = await pool.query(
      "SELECT data FROM app_settings WHERE settings_key = 'general'"
    );

    if (!result.rows || result.rows.length === 0) {
      console.log('No general settings found in database');
      return;
    }

    const settings = result.rows[0].data || {};
    const logoUrl = settings.logo_url;
    const logoUrl2x = settings.logo_url_2x;
    const faviconUrl = settings.favicon_url;
    const touchIconUrl = settings.apple_touch_icon_url;

    let migrated = 0;
    const updates = {};

    // Function to migrate a file
    const migrateFile = (url, newBaseName) => {
      if (!url || !url.startsWith('/uploads/')) return null;
      
      const filename = path.basename(url);
      const srcPath = path.join(uploadsDir, filename);
      
      if (!fs.existsSync(srcPath)) {
        console.log(`⚠ File not found: ${filename}`);
        return null;
      }

      const destPath = path.join(logosDir, newBaseName);
      fs.copyFileSync(srcPath, destPath);
      console.log(`✓ Migrated ${filename} → ${newBaseName}`);
      migrated++;
      
      return `/logos/${newBaseName}`;
    };

    // Migrate logo files
    if (logoUrl) {
      const newUrl = migrateFile(logoUrl, 'logo-70x70.png');
      if (newUrl) updates.logo_url = newUrl;
    }

    if (logoUrl2x) {
      const newUrl = migrateFile(logoUrl2x, 'logo-140x140.png');
      if (newUrl) updates.logo_url_2x = newUrl;
    }

    if (faviconUrl) {
      const newUrl = migrateFile(faviconUrl, 'favicon-32x32.png');
      if (newUrl) updates.favicon_url = newUrl;
    }

    if (touchIconUrl) {
      const newUrl = migrateFile(touchIconUrl, 'favicon-180x180.png');
      if (newUrl) updates.apple_touch_icon_url = newUrl;
    }

    // Update database if any files were migrated
    if (Object.keys(updates).length > 0) {
      const newSettings = { ...settings, ...updates };
      await pool.query(
        `UPDATE app_settings 
         SET data = $1, updated_at = now() 
         WHERE settings_key = 'general'`,
        [newSettings]
      );
      console.log(`\n✓ Updated database with new logo URLs`);
      console.log('New URLs:', updates);
    }

    console.log(`\n✓ Migration complete! Migrated ${migrated} file(s)`);
    console.log('✓ Logos are now stored in: backend/public/logos/');
    console.log('✓ Restart your server for changes to take effect');

  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
