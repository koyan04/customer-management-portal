const fs = require('fs');
const path = require('path');
const request = require('supertest');

// Ensure a minimal frontend/dist exists before loading the app, so app.js mounts it
const distDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const indexPath = path.join(distDir, 'index.html');

describe('Static frontend serving', () => {
  let app;
  beforeAll(() => {
    try { fs.mkdirSync(distDir, { recursive: true }); } catch (_) {}
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, '<!doctype html><html><head><title>CMP Test</title></head><body><div id="root"></div></body></html>');
    }
    // Require after creating dist so app mounts it
    app = require('../app');
  });

  afterAll(() => {
    // Best-effort cleanup (keep dist if it already existed beforehand)
    try {
      const content = fs.readFileSync(indexPath, 'utf8');
      if (content.includes('CMP Test')) {
        fs.unlinkSync(indexPath);
        // Attempt to remove dist dir if empty
        try { fs.rmdirSync(distDir); } catch (_) {}
      }
    } catch (_) {}
  });

  it('serves index.html for non-API routes', async () => {
    const res = await request(app).get('/app');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    // Don't assert a specific title because an existing built dist may already exist
    // Simply verify we received HTML content
    expect(typeof res.text).toBe('string');
    expect(res.text.toLowerCase()).toContain('<html');
  });
});
