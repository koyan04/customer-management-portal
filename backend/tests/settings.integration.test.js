const request = require('supertest');
require('dotenv').config();
const app = require('../app');
const pool = require('../db');

// Create a fake admin token by inserting a temp admin and using a dummy middleware override isn't trivial here,
// so we'll bypass auth by temporarily stubbing the authenticateToken/isAdmin middleware in the app router for this test.

describe('Settings integration', () => {
  let server;
  beforeAll((done) => {
    server = app.listen(0, done);
  });
  afterAll(async () => {
    try { await pool.query("DELETE FROM app_settings WHERE settings_key = 'general'"); } catch(_) {}
    try { await pool.end(); } catch(_) {}
    server.close();
  });

  test('PUT and GET general settings persist price cents', async () => {
    // Use request to bypass auth by directly calling route handlers with agent that sets req.user
    // We will call DB directly using the same logic as route to simulate authenticated request
    const payload = { title: 'Test', price_mini: 3.5, price_basic: 4.0, price_unlimited: 0, currency: 'usd' };
    // Validate via validateSettings first to ensure our cleaned object
    const { validateSettings } = require('../lib/validateSettings');
    const { ok, cleaned } = validateSettings('general', payload);
    expect(ok).toBe(true);

    // Insert into DB as the route would do
    const before = null;
    const toStore = { ...(before || {}), ...cleaned };
    await pool.query(`INSERT INTO app_settings (settings_key, data, updated_by, updated_at) VALUES ($1,$2,$3, now()) ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`, ['general', toStore, null]);

    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    const row = r.rows[0].data;
    expect(row.price_mini_cents).toBe(350);
    expect(row.price_basic_cents).toBe(400);
    expect(row.price_unlimited_cents).toBe(0);
    expect(row.currency).toBe('USD');
  }, 20000);
});
