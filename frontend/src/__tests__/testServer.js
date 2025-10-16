import { setupServer } from 'msw/node';
import { rest } from 'msw';

// default handlers can be extended/overridden by tests
export const handlers = [
  rest.get('/api/admin/accounts', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  // viewer/server permissions by editor id
  rest.get('/api/admin/permissions/:id', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  // current user's permissions convenience endpoint
  rest.get('/api/admin/permissions/me', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  rest.get('/api/servers', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  // server-admin assignments (admin-only API) - return empty by default
  rest.get('/api/admin/server-admins/:adminId', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  // handle CORS preflight in tests to avoid MSW warnings
  rest.options('/api/admin/server-admins/:adminId', (req, res, ctx) => {
    return res(ctx.status(200));
  }),
  // also handle absolute backend origin used in frontend during dev
  rest.get('http://localhost:3001/api/servers', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  rest.get('http://localhost:3001/api/admin/permissions/:id', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  rest.get('http://localhost:3001/api/admin/permissions/me', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  rest.get('http://localhost:3001/api/admin/server-admins/:adminId', (req, res, ctx) => {
    return res(ctx.json([]));
  }),
  rest.options('http://localhost:3001/api/admin/server-admins/:adminId', (req, res, ctx) => {
    return res(ctx.status(200));
  })
];

export const server = setupServer(...handlers);
