const pool = require('../db');

describe('db pool smoke test', () => {
  test('exports a pool with query and shutdown functions', () => {
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
    expect(typeof pool.shutdown).toBe('function');
  });
});
