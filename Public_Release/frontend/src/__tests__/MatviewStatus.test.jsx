import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MatviewStatus from '../components/MatviewStatus.jsx';
import { server, rest } from './testServer';

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 't-admin' }) }));

const ORIGIN = 'http://localhost:3001';

describe('MatviewStatus component', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  test('renders last refresh and state, triggers enqueue refresh', async () => {
  let getCalls = 0;
  server.use(
      rest.options(`${ORIGIN}/api/admin/matviews`, (req, res, ctx) => res(
        ctx.status(204),
        ctx.set('Access-Control-Allow-Origin', '*'),
        ctx.set('Access-Control-Allow-Headers', '*'),
        ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
      )),
      rest.options(`${ORIGIN}/api/admin/matviews/user_status_matview/refresh`, (req, res, ctx) => res(
        ctx.status(204),
        ctx.set('Access-Control-Allow-Origin', '*'),
        ctx.set('Access-Control-Allow-Headers', '*'),
        ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
      )),
      rest.get(`${ORIGIN}/api/admin/matviews`, (req, res, ctx) => {
        getCalls += 1;
        if (getCalls === 1) {
          // initial load: idle
          return res(ctx.json({ ok: true, matviews: [{ name: 'user_status_matview', refreshing: false, pending: false, last_success: '2025-11-08T00:00:00Z' }] }));
        }
        // subsequent poll after enqueue shows refreshing true
        return res(ctx.json({ ok: true, matviews: [{ name: 'user_status_matview', refreshing: true, pending: false, last_success: '2025-11-08T00:00:00Z' }] }));
      }),
      rest.post(`${ORIGIN}/api/admin/matviews/user_status_matview/refresh`, (req, res, ctx) => {
        return res(ctx.json({ ok: true, enqueued: true }));
      })
    );

    render(<MatviewStatus />);

  // Collapsed single-line renders with Last: and State
  await screen.findByRole('button', { name: /User Status Materialized View/i });
  // Expand to show actions
  const headerBtn = screen.getByRole('button', { name: /User Status Materialized View/i });
  fireEvent.click(headerBtn);
  // Now the detail + actions are visible
  await screen.findByText(/Last refresh:/i);
  // Assert a formatted date appears somewhere (partial year match) – could appear in 2 places (collapsed header + detail)
  await waitFor(() => expect(screen.getAllByText(/2025/i).length).toBeGreaterThan(0));
  const refreshBtn = screen.getByRole('button', { name: /Refresh$/i });
  fireEvent.click(refreshBtn);

    await waitFor(() => expect(screen.getAllByText(/Refreshing…/i).length).toBeGreaterThan(0));
  });
});
