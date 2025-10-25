const request = require('supertest');
const { newDb } = require('pg-mem');

// We'll run this integration test against an in-memory Postgres (pg-mem) so it doesn't
// require external DB credentials. This makes tests hermetic and safe for CI.

// Prepare an in-memory DB and mock ../db to use its Pool adapter before requiring app.
const db = newDb();

// register minimal native functions used by our SQL
db.public.registerFunction({
  name: 'date_trunc',
  args: ['text', 'timestamp'],
  returns: 'timestamp',
  implementation: (part, ts) => {
    // ts may be a Date or string
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    if ((part || '').toString().toLowerCase() === 'month') {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
    }
    if ((part || '').toString().toLowerCase() === 'day') {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    }
    return d;
  }
});

const pg = db.adapters.createPg();
const pool = new pg.Pool();

// create minimal schema needed by the financial route and tests
beforeAll(async () => {
  // NOTE: using basic table shapes sufficient for the tests
  await pool.query(`
    CREATE TABLE servers (id SERIAL PRIMARY KEY, server_name TEXT);
    CREATE TABLE app_settings (settings_key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_by INTEGER, updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE settings_audit (id SERIAL PRIMARY KEY, admin_id INTEGER, settings_key TEXT NOT NULL, action TEXT NOT NULL, before_data JSONB, after_data JSONB, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE users (id SERIAL PRIMARY KEY, account_name TEXT, service_type TEXT, server_id INTEGER, created_at TIMESTAMPTZ DEFAULT now(), expire_date TIMESTAMPTZ);
  `);
});

// Mock ../db to export our pool instance
jest.doMock('../db', () => pool);

// Intercept the complex generate_series SQL (pg-mem doesn't implement generate_series over timestamps)
// and implement it using JS queries against the in-memory tables.
const _origQuery = pool.query.bind(pool);
pool.query = async function (text, params) {
  if (typeof text === 'string' && text.includes("generate_series(date_trunc('month'")) {
    // build last-12-months list based on CURRENT_DATE (system date)
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

      // counts
      const countsRes = await _origQuery('SELECT service_type, COUNT(*)::int AS cnt FROM users WHERE created_at <= $1 AND (expire_date IS NULL OR expire_date >= $2) GROUP BY service_type', [endOfMonth, startOfMonth]);
      for (const r of countsRes.rows || []) {
        // fetch audit for this month
        const auditRes = await _origQuery("SELECT after_data FROM settings_audit WHERE settings_key = 'general' AND created_at <= $1 ORDER BY created_at DESC LIMIT 1", [endOfMonth]);
        const appRes = await _origQuery("SELECT data FROM app_settings WHERE settings_key = 'general'");
        rows.push({ month_start: startOfMonth.toISOString(), service_type: r.service_type, cnt: r.cnt, audit_after: (auditRes.rows[0] && auditRes.rows[0].after_data) || null, current_app: (appRes.rows[0] && appRes.rows[0].data) || null });
      }
      // if no counts rows, still return placeholders so month appears
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

// Mock auth to bypass JWT in unit tests
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
}));

const app = require('../app');

describe('Financial API integration (pg-mem) - historical pricing', () => {
  let serverId;
  const createdUserIds = [];
  const createdAuditIds = [];

  beforeAll(async () => {
    // create a temporary server row to attach users to
    const serverRes = await pool.query('INSERT INTO servers (server_name) VALUES ($1) RETURNING id', [`itest-server-${Date.now()}`]);
    serverId = serverRes.rows[0].id;

    // insert two settings_audit rows representing two months with different prices
    const augAudit = await pool.query(
      `INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [null, 'general', 'UPDATE', null, { price_mini_cents: 350, price_basic_cents: 400, price_unlimited_cents: 0, currency: 'USD' }, new Date('2025-08-31T23:59:59Z')]
    );
    createdAuditIds.push(augAudit.rows[0].id);

    const sepAudit = await pool.query(
      `INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [null, 'general', 'UPDATE', null, { price_mini_cents: 400, price_basic_cents: 500, price_unlimited_cents: 0, currency: 'USD' }, new Date('2025-09-30T23:59:59Z')]
    );
    createdAuditIds.push(sepAudit.rows[0].id);

    // insert users for August (2 mini, 1 basic)
    const u1 = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [`itest-aug-mini-1-${Date.now()}`, 'mini', serverId, new Date('2025-08-10T12:00:00Z')]);
    const u2 = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [`itest-aug-mini-2-${Date.now()}`, 'mini', serverId, new Date('2025-08-15T12:00:00Z')]);
    const u3 = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [`itest-aug-basic-1-${Date.now()}`, 'basic', serverId, new Date('2025-08-20T12:00:00Z')]);
    createdUserIds.push(u1.rows[0].id, u2.rows[0].id, u3.rows[0].id);

    // insert users for September (1 mini, 2 basic)
    const s1 = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [`itest-sep-mini-1-${Date.now()}`, 'mini', serverId, new Date('2025-09-10T12:00:00Z')]);
    const s2 = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [`itest-sep-basic-1-${Date.now()}`, 'basic', serverId, new Date('2025-09-12T12:00:00Z')]);
    const s3 = await pool.query('INSERT INTO users (account_name, service_type, server_id, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [`itest-sep-basic-2-${Date.now()}`, 'basic', serverId, new Date('2025-09-15T12:00:00Z')]);
    createdUserIds.push(s1.rows[0].id, s2.rows[0].id, s3.rows[0].id);
  }, 20000);

  afterAll(async () => {
    try {
      if (createdUserIds.length) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [createdUserIds]);
      }
      if (createdAuditIds.length) {
        await pool.query('DELETE FROM settings_audit WHERE id = ANY($1::int[])', [createdAuditIds]);
      }
      if (serverId) {
        await pool.query('DELETE FROM servers WHERE id = $1', [serverId]);
      }
    } catch (e) {
      console.warn('Cleanup failed:', e && e.message ? e.message : e);
    }
  });

  test('computes revenue using audit prices for each month', async () => {
    const res = await request(app).get('/api/admin/financial');
    expect(res.status).toBe(200);
    const months = res.body.months || [];

    const aug = months.find(m => m.month === '2025-08');
    const sep = months.find(m => m.month === '2025-09');
    expect(aug).toBeDefined();
    expect(sep).toBeDefined();

  const augExpected = (2 * 350) + (1 * 400);
  // The endpoint counts active users during the month (includes prior-month users who remain active),
  // so September includes August users (no expire_date) and is therefore cumulative.
  const sepExpected = ((2 + 1) * 400) + ((1 + 2) * 500);

    expect(Number(aug.revenue_cents)).toBe(augExpected);
    expect(Number(sep.revenue_cents)).toBe(sepExpected);
  }, 20000);
});
