const { createHelpers } = require('../lib/telegramHelpers');
const dbCompat = require('../lib/dbCompat');

describe('telegramHelpers', () => {
  test('applyExtendExpire returns updated row', async () => {
    const fakePool = {
      query: jest.fn()
        // first call: select before
        .mockResolvedValueOnce({ rows: [{ expire_date: '2025-10-01T00:00:00Z' }] })
        // second call: update returning
        .mockResolvedValueOnce({ rows: [{ expire_date: '2025-12-01T00:00:00Z', account_name: 'bob' }] })
        // third call: audit insert
        .mockResolvedValueOnce({ rows: [] })
    };
    const helpers = createHelpers(fakePool, dbCompat);
    const res = await helpers.applyExtendExpire(123, 2);
    expect(fakePool.query).toHaveBeenCalledTimes(3);
    expect(res).toHaveProperty('expire_date');
    expect(res.account_name).toBe('bob');
  });

  test('fetchUsersByServer includes status when dbCompat.hasColumn true', async () => {
    const fakePool = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1, account_name: 'alice', service_type: 'basic', expire_date: '2025-12-01', status: 'active' }] })
    };
    // mock dbCompat.hasColumn to return true
    const compat = { hasColumn: jest.fn().mockResolvedValue(true) };
    const helpers = createHelpers(fakePool, compat);
    const users = await helpers.fetchUsersByServer(5);
    expect(compat.hasColumn).toHaveBeenCalledWith(fakePool, 'users', 'status');
    expect(fakePool.query).toHaveBeenCalled();
    expect(users[0].status).toBe('active');
  });

  test('fetchUsersByServer omits status when dbCompat.hasColumn false', async () => {
    const fakePool = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1, account_name: 'alice', service_type: 'basic', expire_date: '2025-12-01' }] })
    };
    const compat = { hasColumn: jest.fn().mockResolvedValue(false) };
    const helpers = createHelpers(fakePool, compat);
    const users = await helpers.fetchUsersByServer(5);
    expect(compat.hasColumn).toHaveBeenCalledWith(fakePool, 'users', 'status');
    expect(fakePool.query).toHaveBeenCalled();
    expect(users[0].status).toBeUndefined();
  });

  test('fetchServerById returns server row', async () => {
    const fakePool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 10, server_name: 'srv-1', ip_address: '1.2.3.4', domain_name: 'example.com', owner: 'ops' }] }) };
    const helpers = createHelpers(fakePool, dbCompat);
    const s = await helpers.fetchServerById(10);
    expect(fakePool.query).toHaveBeenCalledWith(expect.any(String), [10]);
    expect(s).toBeTruthy();
    expect(s.server_name).toBe('srv-1');
  });

  test('fetchUserById returns user with server_name', async () => {
    const fakePool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 7, account_name: 'carol', server_name: 'srv-1', expire_date: '2025-11-01' }] }) };
    const helpers = createHelpers(fakePool, dbCompat);
    const u = await helpers.fetchUserById(7);
    expect(fakePool.query).toHaveBeenCalledWith(expect.any(String), [7]);
    expect(u).toBeTruthy();
    expect(u.server_name).toBe('srv-1');
  });

  test('applyExtendExpire returns null for non-positive months', async () => {
    const fakePool = { query: jest.fn() };
    const helpers = createHelpers(fakePool, dbCompat);
    const res = await helpers.applyExtendExpire(1, 0);
    expect(res).toBeNull();
    expect(fakePool.query).not.toHaveBeenCalled();
  });
});
