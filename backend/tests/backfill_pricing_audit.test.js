const { main } = require('../scripts/backfill_pricing_audit');

jest.mock('../db', () => {
  // we'll override implementation in tests if needed
  return {};
});

describe('backfill_pricing_audit script', () => {
  let realDb;
  beforeEach(() => {
    jest.resetModules();
    realDb = require('../db');
  });

  test('dry-run does not perform UPDATE', async () => {
    // create mock client and pool
    const mockClient = {
      query: jest.fn()
        .mockImplementationOnce(() => Promise.resolve({ rows: [{ c: 1 }] })) // count
        .mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 1, after_data: { price_mini: 1.23, price_basic: 2, price_unlimited: 0 } }] })), // select rows
      release: jest.fn()
    };
    const mockPool = {
      connect: async () => mockClient,
      end: async () => {},
    };
    // replace '../db' in module cache
    jest.doMock('../db', () => mockPool);
    const mod = require('../scripts/backfill_pricing_audit');
    await mod.main({ dry: true, batch: 100 });
    // mockClient.query called for SELECTs but should not be called with UPDATE
    const updateCalled = mockClient.query.mock.calls.some(c => String(c[0]).toUpperCase().includes('UPDATE SETTINGS_AUDIT'));
    expect(updateCalled).toBe(false);
  });

  test('non-dry run performs UPDATE for rows missing cents', async () => {
    const mockClient = {
      query: jest.fn()
        .mockImplementationOnce(() => Promise.resolve({ rows: [{ c: 1 }] })) // count
        .mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 42, after_data: { price_mini: 1.5, price_basic: '2.00', price_unlimited: '0' } }] })) // select rows
        .mockImplementationOnce(() => Promise.resolve({})), // update
      release: jest.fn()
    };
    const mockPool = {
      connect: async () => mockClient,
      end: async () => {},
    };
    jest.doMock('../db', () => mockPool);
    const mod = require('../scripts/backfill_pricing_audit');
    await mod.main({ dry: false, batch: 100 });
    // Ensure an UPDATE was executed
    const updateCall = mockClient.query.mock.calls.find(c => String(c[0]).toUpperCase().includes('UPDATE SETTINGS_AUDIT'));
    expect(updateCall).toBeDefined();
    // verify parameters: [next, id]
    const params = updateCall[1];
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBe(2);
    expect(params[1]).toBe(42);
    expect(params[0]).toHaveProperty('price_mini_cents', 150);
    expect(params[0]).toHaveProperty('price_basic_cents', 200);
    expect(params[0]).toHaveProperty('price_unlimited_cents', 0);
  });
});
