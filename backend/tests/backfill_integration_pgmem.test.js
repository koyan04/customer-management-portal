const { newDb } = require('pg-mem');

// Create an in-memory Postgres and a Pool adapter so the backfill script can run
const db = newDb();
const pg = db.adapters.createPg();
const pool = new pg.Pool();

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE settings_audit (id SERIAL PRIMARY KEY, admin_id INTEGER, settings_key TEXT NOT NULL, action TEXT NOT NULL, before_data JSONB, after_data JSONB, created_at TIMESTAMPTZ DEFAULT now());
  `);
});

// Mock ../db to export our pool instance before requiring the backfill script
jest.doMock('../db', () => pool);

test('backfill script writes price_*_cents from legacy decimal keys', async () => {
  // insert a legacy audit row with decimal prices
  const res = await pool.query(
    `INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [null, 'general', 'UPDATE', null, { price_mini: 3.5, price_basic: 4.0, price_unlimited: 0, currency: 'USD' }, new Date('2025-07-01T00:00:00Z')]
  );

  const id = res.rows[0].id;

  // require the backfill script after mocking ../db
  const backfill = require('../scripts/backfill_pricing_audit');

  // run the backfill in non-dry mode against the in-memory DB
  await backfill.main({ dry: false, batch: 100 });

  const updated = await pool.query('SELECT after_data FROM settings_audit WHERE id = $1', [id]);
  const after = updated.rows[0].after_data;

  expect(after.price_mini_cents).toBe(350);
  expect(after.price_basic_cents).toBe(400);
  expect(after.price_unlimited_cents).toBe(0);
  expect(after.currency).toBe('USD');
}, 20000);
