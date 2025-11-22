import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server, rest } from '../../__tests__/testServer';
import SettingsPage from '../SettingsPage.jsx';

// Mock auth to avoid real tokens
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: null }) }));

describe('SettingsPage with MSW handlers (snapshot)', () => {
  const ORIGIN = 'http://localhost:3001';
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('downloads snapshot via MSW and shows confirmation', async () => {
    // Override the snapshot endpoint to ensure it’s hit and returns data
    server.use(
      rest.get(`${ORIGIN}/api/admin/backup/snapshot`, (req, res, ctx) => {
        const json = { created_at: '2025-01-01T00:00:00Z', app_settings: [], servers: [], users: [] };
        return res(ctx.json(json));
      })
    );

    render(<SettingsPage />);
    const btn = await screen.findByRole('button', { name: /Download Telegram backup \(JSON\)/i });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Download started/i));
  });

  it('uploads snapshot via MSW and shows server message', async () => {
    // Use MSW to mock the upload endpoint so the test exercises the network path
    server.use(
      rest.post(`${ORIGIN}/api/admin/restore/snapshot`, (req, res, ctx) => {
        return res(ctx.json({ msg: 'Uploaded' }));
      })
    );

    render(<SettingsPage />);
    const input = await screen.findByLabelText(/Restore Telegram Snapshot \(JSON\)/i);
    const file = new File([JSON.stringify({ users: [] })], 'cmp-backup.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    // wait until the filename is shown next to the input (ensures state updated)
    await screen.findByText(/cmp-backup.json/);
    const restoreButtons = await screen.findAllByRole('button', { name: /Restore/i });
    // click third Restore button (snapshot)
    fireEvent.click(restoreButtons[2]);

    // Expect modal to appear and show the server message from MSW
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    // Assert the dialog shows the server-provided message
    await waitFor(() => within(screen.getByRole('dialog')).getByText(/Uploaded/));
  });
});
