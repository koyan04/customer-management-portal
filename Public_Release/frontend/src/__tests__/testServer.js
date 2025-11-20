import { setupServer } from 'msw/node';
import { rest } from 'msw';

const ORIGIN = 'http://localhost:3001';

// Default handlers used across tests; individual tests may override with server.use
const handlers = [
  // Settings fetches
  rest.get(`${ORIGIN}/api/admin/settings/:key`, (req, res, ctx) => {
    const { key } = req.params;
    if (key === 'database') return res(ctx.json({ data: { host: '', port: 5432, user: '', database: '', ssl: false } }));
    if (key === 'telegram') return res(ctx.json({ data: { botToken: '********', defaultChatId: '', messageTemplate: '', notificationTime: '@daily', databaseBackup: false, loginNotification: false, enabled: true, settings_reload_seconds: 60 } }));
    if (key === 'remoteServer') return res(ctx.json({ data: { host: '', port: 22, username: '', authMethod: 'password' } }));
    if (key === 'general') return res(ctx.json({ data: { title: 'VChannel', theme: 'system', showTooltips: true, currency: 'USD', autoLogoutMinutes: 0 } }));
    return res(ctx.json({ data: {} }));
  }),
  // DB status
  rest.get(`${ORIGIN}/api/admin/db/status`, (_req, res, ctx) => res(ctx.json({ database: 'testdb', host: 'localhost', tables: 0, counts: {}, version: '1', dbSize: { pretty: '0B' }, lastBackup: null, largestTables: [] }))),
  // Bot status
  rest.get(`${ORIGIN}/internal/bot/status`, (_req, res, ctx) => res(ctx.json({ ok: true, status: {} }))),

  // Admin panel lists
  rest.get(`/api/admin/accounts`, (_req, res, ctx) => res(ctx.json([]))),
  // Servers list (relative and absolute) + CORS preflight
  rest.options(`/api/servers`, (_req, res, ctx) => res(
    ctx.status(204),
    ctx.set('Access-Control-Allow-Origin', '*'),
    ctx.set('Access-Control-Allow-Headers', '*'),
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  )),
  rest.options(`${ORIGIN}/api/servers`, (_req, res, ctx) => res(
    ctx.status(204),
    ctx.set('Access-Control-Allow-Origin', '*'),
    ctx.set('Access-Control-Allow-Headers', '*'),
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  )),
  rest.get(`/api/servers`, (_req, res, ctx) => res(ctx.json([]))),
  rest.get(`${ORIGIN}/api/servers`, (_req, res, ctx) => res(ctx.json([]))),

  // Snapshot download (record=1 recognized but not required)
  rest.get(`${ORIGIN}/api/admin/backup/snapshot`, (req, res, ctx) => {
    const blobJson = { created_at: new Date().toISOString(), app_settings: [], servers: [], users: [] };
    return res(ctx.json(blobJson));
  }),

  // Backup record
  rest.post(`${ORIGIN}/api/admin/backup/record`, (_req, res, ctx) => res(ctx.json({ ok: true }))),
  // Restore snapshot
  rest.post(`${ORIGIN}/api/admin/restore/snapshot`, (_req, res, ctx) => res(ctx.json({ msg: 'Uploaded' }))),

  // --- Certificate status/config minimal handlers to silence warnings ---
  rest.options(`/api/admin/control/cert/status`, (_req, res, ctx) => res(
    ctx.status(204),
    ctx.set('Access-Control-Allow-Origin', '*'),
    ctx.set('Access-Control-Allow-Headers', '*'),
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  )),
  rest.options(`${ORIGIN}/api/admin/control/cert/status`, (_req, res, ctx) => res(
    ctx.status(204),
    ctx.set('Access-Control-Allow-Origin', '*'),
    ctx.set('Access-Control-Allow-Headers', '*'),
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  )),
  rest.get(`/api/admin/control/cert/status`, (_req, res, ctx) => res(ctx.json({
    ok: true,
    domain: 'localhost.test',
    daysRemaining: 90,
    notBefore: '2025-01-01T00:00:00Z',
    notAfter: '2026-01-01T00:00:00Z',
    issuer: 'LetsEncrypt (staging)',
  }))),
  rest.get(`${ORIGIN}/api/admin/control/cert/status`, (_req, res, ctx) => res(ctx.json({
    ok: true,
    domain: 'localhost.test',
    daysRemaining: 90,
    notBefore: '2025-01-01T00:00:00Z',
    notAfter: '2026-01-01T00:00:00Z',
    issuer: 'LetsEncrypt (staging)',
  }))),
  // Health endpoint to surface version for App footer
  rest.get(`/api/health`, (_req, res, ctx) => res(ctx.json({ ok: true, versions: { appVersion: 'cmp ver 1.0' } }))),
  rest.get(`${ORIGIN}/api/health`, (_req, res, ctx) => res(ctx.json({ ok: true, versions: { appVersion: 'cmp ver 1.0' } }))),
  // Matview status default handlers (relative base used by components in tests)
  rest.get(`/api/admin/matviews`, (_req, res, ctx) => res(ctx.json({ ok: true, matviews: [{ name: 'user_status_matview', refreshing: false, pending: false, last_success: null }] })) ),
    // Matview status default handlers for absolute origin requests
    rest.options(`${ORIGIN}/api/admin/matviews`, (_req, res, ctx) => res(
      ctx.status(204),
      ctx.set('Access-Control-Allow-Origin', '*'),
      ctx.set('Access-Control-Allow-Headers', '*'),
      ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    )),
    rest.options(`${ORIGIN}/api/admin/matviews/user_status_matview/refresh`, (_req, res, ctx) => res(
      ctx.status(204),
      ctx.set('Access-Control-Allow-Origin', '*'),
      ctx.set('Access-Control-Allow-Headers', '*'),
      ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    )),
    rest.get(`${ORIGIN}/api/admin/matviews`, (_req, res, ctx) => res(ctx.json({ ok: true, matviews: [{ name: 'user_status_matview', refreshing: false, pending: false, last_success: null }] })) ),
    rest.post(`${ORIGIN}/api/admin/matviews/user_status_matview/refresh`, (_req, res, ctx) => res(ctx.json({ ok: true, enqueued: true })) ),
  rest.post(`/api/admin/matviews/user_status_matview/refresh`, (_req, res, ctx) => res(ctx.json({ ok: true, enqueued: true })) ),
  // Update status endpoint handlers
  rest.get(`/api/admin/control/update/status`, (_req, res, ctx) => res(ctx.json({
    ok: true,
    gitOrigin: 'https://git.example/actual.git',
    storedOrigin: 'https://example.com/repo.git',
    updatedBy: 1,
    updatedAt: '2025-01-01T00:00:00Z'
  }))),
  rest.get(`${ORIGIN}/api/admin/control/update/status`, (_req, res, ctx) => res(ctx.json({
    ok: true,
    gitOrigin: 'https://git.example/actual.git',
    storedOrigin: 'https://example.com/repo.git',
    updatedBy: 1,
    updatedAt: '2025-01-01T00:00:00Z'
  }))),

  // Cert config endpoints (status fetch also tries to load config)
  rest.options(`/api/admin/control/cert/config`, (_req, res, ctx) => res(
    ctx.status(204),
    ctx.set('Access-Control-Allow-Origin', '*'),
    ctx.set('Access-Control-Allow-Headers', '*'),
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  )),
  rest.options(`${ORIGIN}/api/admin/control/cert/config`, (_req, res, ctx) => res(
    ctx.status(204),
    ctx.set('Access-Control-Allow-Origin', '*'),
    ctx.set('Access-Control-Allow-Headers', '*'),
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  )),
  rest.get(`/api/admin/control/cert/config`, (_req, res, ctx) => res(ctx.json({
    config: { domain: 'localhost.test', email: 'admin@example.com', api_token: '********' }
  }))),
  rest.get(`${ORIGIN}/api/admin/control/cert/config`, (_req, res, ctx) => res(ctx.json({
    config: { domain: 'localhost.test', email: 'admin@example.com', api_token: '********' }
  }))),
];

export const server = setupServer(...handlers);
export { rest };
