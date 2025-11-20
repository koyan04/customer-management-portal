const request = require('supertest');
const { newDb } = require('pg-mem');

// Use pg-mem so integration fallback test runs without external DB credentials.
const db = newDb();

// register date_trunc used by the financial SQL
db.public.registerFunction({
  name: 'date_trunc',
  args: ['text', 'timestamp'],
  returns: 'timestamp',
  implementation: (part, ts) => {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    if ((part || '').toString().toLowerCase() === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1,0,0,0,0));
    if ((part || '').toString().toLowerCase() === 'day') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),0,0,0,0));
    return d;
  }
});

const pg = db.adapters.createPg();
const pool = new pg.Pool();

// Intercept the complex generate_series SQL (pg-mem doesn't implement generate_series over timestamps)
// and implement it using JS queries against the in-memory tables.
const _origQuery = pool.query.bind(pool);
pool.query = async function (text, params) {
  if (typeof text === 'string' && text.includes("generate_series(date_trunc('month'")) {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 0, 0, 0, 0));
      months.push(d);
    }
    const rows = [];
    for (const start of months) {
      const startOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));

      const countsRes = await _origQuery('SELECT service_type, COUNT(*)::int AS cnt FROM users WHERE created_at <= $1 AND (expire_date IS NULL OR expire_date >= $2) GROUP BY service_type', [endOfMonth, startOfMonth]);
      for (const r of countsRes.rows || []) {
        const auditRes = await _origQuery("SELECT after_data FROM settings_audit WHERE settings_key = 'general' AND created_at <= $1 ORDER BY created_at DESC LIMIT 1", [endOfMonth]);
        const appRes = await _origQuery("SELECT data FROM app_settings WHERE settings_key = 'general'");
        rows.push({ month_start: startOfMonth.toISOString(), service_type: r.service_type, cnt: r.cnt, audit_after: (auditRes.rows[0] && auditRes.rows[0].after_data) || null, current_app: (appRes.rows[0] && appRes.rows[0].data) || null });
      }
      if (!countsRes.rows || countsRes.rows.length === 0) {
        const auditRes = await _origQuery("SELECT after_data FROM settings_audit WHERE settings_key = 'general' AND created_at <= $1 ORDER BY created_at DESC LIMIT 1", [endOfMonth]);
        const appRes = await _origQuery("SELECT data FROM app_settings WHERE settings_key = 'general'");
        rows.push({ month_start: startOfMonth.toISOString(), service_type: null, cnt: 0, audit_after: (auditRes.rows[0] && auditRes.rows[0].after_data) || null, current_app: (appRes.rows[0] && appRes.rows[0].data) || null });
      }
    }
    return { rows };
  }
  return _origQuery(text, params);
};

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE app_settings (settings_key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_by INTEGER, updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE settings_audit (id SERIAL PRIMARY KEY, admin_id INTEGER, settings_key TEXT NOT NULL, action TEXT NOT NULL, before_data JSONB, after_data JSONB, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE users (id SERIAL PRIMARY KEY, account_name TEXT, service_type TEXT, server_id INTEGER, created_at TIMESTAMPTZ DEFAULT now(), expire_date TIMESTAMPTZ);
  `);
});

// Mock ../db to export our in-memory pool
jest.doMock('../db', () => pool);

// Mock auth to bypass JWT in unit tests
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
}));

const app = require('../app');

describe('Financial API integration fallback to app_settings (pg-mem)', () => {
  const createdUserIds = [];
  const originalAudits = [];
  let savedAppSettings = null;

  // We'll pick July 2025 as a target month for this test
  const monthEnd = new Date('2025-07-31T23:59:59Z');

  beforeAll(async () => {
    // capture any existing audits (none in pg-mem at this point) and save
    const auditRes = await pool.query("SELECT admin_id, settings_key, action, before_data, after_data, created_at FROM settings_audit WHERE settings_key = 'general' AND created_at <= $1 ORDER BY created_at ASC", [monthEnd]);
    for (const r of (auditRes.rows || [])) originalAudits.push(r);

    // delete any such audits (no-op in pg-mem but kept for parity)
    if (originalAudits.length) await pool.query("DELETE FROM settings_audit WHERE settings_key = 'general' AND created_at <= $1", [monthEnd]);

    // save current app_settings.general (if any)
    const cur = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    if (cur.rows && cur.rows[0]) savedAppSettings = cur.rows[0].data;

    // upsert app_settings.general to controlled price set
    const testData = { price_mini_cents: 250, price_basic_cents: 375, price_unlimited_cents: 0, currency: 'USD' };
    await pool.query("INSERT INTO app_settings (settings_key, data, updated_at) VALUES ('general', $1, now()) ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()", [testData]);

    // insert users active in July 2025: 3 mini, 2 basic
    const s = [`itest-jul-mini-1-${Date.now()}`, `itest-jul-mini-2-${Date.now()}`, `itest-jul-mini-3-${Date.now()}`, `itest-jul-basic-1-${Date.now()}`, `itest-jul-basic-2-${Date.now()}`];
    const types = ['mini','mini','mini','basic','basic'];
    for (let i=0;i<s.length;i++) {
      const r = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [s[i], types[i], null, new Date('2025-07-15T12:00:00Z')]);
      createdUserIds.push(r.rows[0].id);
    }
  }, 20000);

  afterAll(async () => {
    try {
      if (createdUserIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [createdUserIds]);
      // restore audits
      for (const a of originalAudits) {
        try {
          await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [a.admin_id, a.settings_key, a.action, a.before_data, a.after_data, a.created_at]);
        } catch (e) { console.warn('Failed to restore audit:', e && e.message ? e.message : e); }
      }
      // restore app_settings.general
      if (savedAppSettings) {
        await pool.query("UPDATE app_settings SET data = $1, updated_at = now() WHERE settings_key = 'general'", [savedAppSettings]);
      } else {
        await pool.query("DELETE FROM app_settings WHERE settings_key = 'general'");
      }
    } catch (e) {
      console.warn('Integration cleanup error:', e && e.message ? e.message : e);
    }
  });

  test('falls back to app_settings.general when no audit exists for month', async () => {
    const res = await request(app).get('/api/admin/financial');
    expect(res.status).toBe(200);
    const months = res.body.months || [];
    const jul = months.find(m => m.month === '2025-07');
    expect(jul).toBeDefined();

    // 3 mini at 250 + 2 basic at 375 => revenue cents
    const expected = (3 * 250) + (2 * 375);
    expect(Number(jul.revenue_cents)).toBe(expected);
  }, 20000);
});
