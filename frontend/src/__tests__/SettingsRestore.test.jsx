import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// using Vitest globals per config
import SettingsPage from '../pages/SettingsPage.jsx';

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 'fake', user: { id: 1, role: 'ADMIN' } }) }));
vi.mock('axios', () => {
  const mock = {
    get: vi.fn(async (url) => {
      if (url.endsWith('/api/admin/db/status')) return { data: { database: 'db', host: 'localhost', tables: 3, counts: { admins: 1, servers: 0 }, lastBackup: null } };
      return { data: { data: {} } };
    }),
    put: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async (url) => {
      if (url.endsWith('/api/admin/settings/database/test')) return { data: { ok: true } };
      if (url.endsWith('/api/admin/backup/record')) return { data: { msg: 'Backup recorded' } };
      // default upload success
      return { data: { msg: 'Upload completed' } };
    }),
  };
  return { default: mock };
});
import axios from 'axios';

function setFile(input, file) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe('SettingsPage restore uploads', () => {
  const origLS = global.localStorage;
  beforeEach(() => {
    const store = new Map();
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
      configurable: true,
    });
  });
  afterEach(() => { Object.defineProperty(window, 'localStorage', { value: origLS }); vi.clearAllMocks(); });

  it('shows success message on restore success', async () => {
    render(<SettingsPage />);
    const cfgInput = await screen.findByLabelText(/Restore Config/i);
    setFile(cfgInput, new File([JSON.stringify({ type: 'config-backup-v1' })], 'config.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/Upload completed|Download started/);
  });

  it('shows failure message on restore error', async () => {
    axios.post.mockImplementationOnce(async () => { throw { response: { data: { msg: 'Checksum mismatch' } } }; });
    render(<SettingsPage />);
    const dbInput = await screen.findByLabelText(/Restore Database/i);
    setFile(dbInput, new File([JSON.stringify({ type: 'db-backup-v1' })], 'database.db', { type: 'application/octet-stream' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/Upload failed: Checksum mismatch/);
  });
});
