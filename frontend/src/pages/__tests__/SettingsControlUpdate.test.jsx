import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import SettingsPage from '../SettingsPage.jsx';
import axios from 'axios';

// Use real axios mock to control requests in this suite
vi.mock('axios', () => {
  const get = vi.fn();
  const post = vi.fn();
  const put = vi.fn();
  const del = vi.fn();
  return { default: { get, post, put, delete: del }, get, post, put, delete: del };
});

// Mock auth to avoid real tokens
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: null }) }));

describe('SettingsPage Control Update inline status and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.setItem('settings.lastTab', 'control'); } catch {}

    // Default GET handlers for initial mounts used by SettingsPage
    axios.get.mockImplementation((url) => {
      // Settings pages loaded on mount (database/telegram/remote/general)
      if (url.endsWith('/api/admin/settings/database')) return Promise.resolve({ data: { data: { host: '', port: 5432, user: '', database: '', ssl: false } } });
      if (url.endsWith('/api/admin/settings/telegram')) return Promise.resolve({ data: { data: { botToken: '********', defaultChatId: '', messageTemplate: '', notificationTime: '@daily', databaseBackup: false, loginNotification: false, enabled: true, settings_reload_seconds: 60 } } });
      if (url.endsWith('/api/admin/settings/remoteServer')) return Promise.resolve({ data: { data: { host: '', port: 22, username: '', authMethod: 'password' } } });
      if (url.endsWith('/api/admin/settings/general')) return Promise.resolve({ data: { data: { title: 'VChannel', theme: 'system', showTooltips: true, currency: 'USD', autoLogoutMinutes: 0 } } });
      if (url.endsWith('/internal/bot/status')) return Promise.resolve({ data: { ok: true, status: {} } });
      if (url.endsWith('/api/admin/db/status')) return Promise.resolve({ data: { database: 'testdb', host: 'localhost', tables: 0, counts: {}, version: '1', dbSize: { pretty: '0B' }, lastBackup: null, largestTables: [] } });

      // Control tab lightweight loaders
      if (url.endsWith('/api/admin/control/cert/status')) return Promise.resolve({ data: { ok: true } });
      if (url.endsWith('/api/admin/control/cert/config')) return Promise.resolve({ data: { config: { domain: 'localhost.test', email: 'admin@example.com', api_token: '********' } } });

      if (url.endsWith('/api/admin/control/update/source')) {
        return Promise.resolve({ data: { originUrl: 'https://example.com/repo.git' } });
      }
      if (url.endsWith('/api/admin/control/update/status')) {
        return Promise.resolve({ data: { ok: true, gitOrigin: 'https://git.example/actual.git', storedOrigin: 'https://example.com/repo.git', updatedBy: 1, updatedAt: '2025-01-01T00:00:00Z' } });
      }

      // Update check (when user clicks Check)
      if (url.endsWith('/api/admin/control/update/check')) {
        return Promise.resolve({ data: { branch: 'main', localSha: 'aaaaaaaaaaaa', remoteSha: 'bbbbbbbbbbbb', behind: true, originUrl: 'https://git.example/actual.git' } });
      }

      return Promise.resolve({ data: {} });
    });

    axios.put.mockImplementation((url, body, cfg) => {
      // Retry/Save source
      if (url.endsWith('/api/admin/control/update/source')) {
        // Simulate success first; tests can override below if needed
        return Promise.resolve({ status: 200, data: { ok: true } });
      }
      return Promise.resolve({ status: 200, data: { ok: true } });
    });
  });

  it('renders inline origins and shows mismatch badge when different', async () => {
    render(<SettingsPage />);

    // Ensure we are on Control tab and inline fields show up
  const gitOriginCells = await screen.findAllByText(/Git origin/i);
  const storedOriginCells = await screen.findAllByText(/Stored origin/i);
  expect(gitOriginCells.length).toBeGreaterThan(0);
  expect(storedOriginCells.length).toBeGreaterThan(0);

    // Badge should appear because gitOrigin !== storedOrigin in our mock
    const badge = await screen.findByLabelText('origin-mismatch');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/differs/i);
  });

  it('clicking Retry updates git remote and refreshes status', async () => {
    // Arrange: Track calls and allow status to change after retry
    let retried = false;
    axios.put.mockImplementation((url, body) => {
      if (url.endsWith('/api/admin/control/update/source')) {
        retried = true;
        return Promise.resolve({ status: 200, data: { ok: true } });
      }
      return Promise.resolve({ status: 200, data: { ok: true } });
    });
    axios.get.mockImplementation((url) => {
      // Keep previous handlers, but return matching origins after retry when status queried again
      if (url.endsWith('/api/admin/control/update/status')) {
        if (retried) {
          return Promise.resolve({ data: { ok: true, gitOrigin: 'https://example.com/repo.git', storedOrigin: 'https://example.com/repo.git', updatedBy: 1, updatedAt: '2025-01-01T00:00:00Z' } });
        }
        return Promise.resolve({ data: { ok: true, gitOrigin: 'https://git.example/actual.git', storedOrigin: 'https://example.com/repo.git', updatedBy: 1, updatedAt: '2025-01-01T00:00:00Z' } });
      }
      if (url.endsWith('/api/admin/control/update/source')) {
        return Promise.resolve({ data: { originUrl: 'https://example.com/repo.git' } });
      }
      // Fall through to base initial mock behaviors for other endpoints
      if (url.endsWith('/api/admin/settings/database')) return Promise.resolve({ data: { data: { host: '', port: 5432, user: '', database: '', ssl: false } } });
      if (url.endsWith('/api/admin/settings/telegram')) return Promise.resolve({ data: { data: { botToken: '********', defaultChatId: '', messageTemplate: '', notificationTime: '@daily', databaseBackup: false, loginNotification: false, enabled: true, settings_reload_seconds: 60 } } });
      if (url.endsWith('/api/admin/settings/remoteServer')) return Promise.resolve({ data: { data: { host: '', port: 22, username: '', authMethod: 'password' } } });
      if (url.endsWith('/api/admin/settings/general')) return Promise.resolve({ data: { data: { title: 'VChannel', theme: 'system', showTooltips: true, currency: 'USD', autoLogoutMinutes: 0 } } });
      if (url.endsWith('/internal/bot/status')) return Promise.resolve({ data: { ok: true, status: {} } });
      if (url.endsWith('/api/admin/db/status')) return Promise.resolve({ data: { database: 'testdb', host: 'localhost', tables: 0, counts: {}, version: '1', dbSize: { pretty: '0B' }, lastBackup: null, largestTables: [] } });
      if (url.endsWith('/api/admin/control/cert/status')) return Promise.resolve({ data: { ok: true } });
      if (url.endsWith('/api/admin/control/cert/config')) return Promise.resolve({ data: { config: { domain: 'localhost.test', email: 'admin@example.com', api_token: '********' } } });
      if (url.endsWith('/api/admin/control/update/check')) return Promise.resolve({ data: { branch: 'main', localSha: 'aaaaaaaaaaaa', remoteSha: 'bbbbbbbbbbbb', behind: true, originUrl: 'https://git.example/actual.git' } });
      return Promise.resolve({ data: {} });
    });

    render(<SettingsPage />);
    // Mismatch badge appears initially
    const badge = await screen.findByLabelText('origin-mismatch');
    expect(badge).toBeInTheDocument();

    // Click Retry button
    const retryBtn = await screen.findByRole('button', { name: /Retry Git Remote Update/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      // After retry, mismatch badge should disappear
      expect(screen.queryByLabelText('origin-mismatch')).toBeNull();
    });

    // Ensure PUT was called with stored origin
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/control\/update\/source$/),
      expect.objectContaining({ url: 'https://example.com/repo.git' }),
      expect.any(Object)
    );
  });
});
