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

// NOTE ON SCOPE
// These tests previously covered a "Git origin / Stored origin / mismatch
// badge / Retry Git Remote Update" block on the Control tab. That block was
// removed from SettingsPage during the v1.9.30 rewrite, which is why the tests
// were failing: the strings 'Git origin', 'origin-mismatch' and 'Retry Git
// Remote Update' no longer exist anywhere in the file.
//
// The Control tab still has a live update feature (the version check panel), so
// these tests were retargeted at that rather than deleted. It covers the same
// kind of surface: a GET-driven status read plus a button that refreshes it.

const VERSION_URL = '/api/admin/control/update/version';

/** Baseline GET handler for every endpoint SettingsPage touches on mount. */
const baseHandlers = (url) => {
  if (url.endsWith('/api/admin/settings/database')) return Promise.resolve({ data: { data: { host: '', port: 5432, user: '', database: '', ssl: false } } });
  if (url.endsWith('/api/admin/settings/telegram')) return Promise.resolve({ data: { data: { botToken: '********', defaultChatId: '', messageTemplate: '', notificationTime: '@daily', databaseBackup: false, loginNotification: false, enabled: true, settings_reload_seconds: 60 } } });
  if (url.endsWith('/api/admin/settings/remoteServer')) return Promise.resolve({ data: { data: { host: '', port: 22, username: '', authMethod: 'password' } } });
  if (url.endsWith('/api/admin/settings/general')) return Promise.resolve({ data: { data: { title: 'VChannel', theme: 'system', showTooltips: true, currency: 'USD', autoLogoutMinutes: 0 } } });
  if (url.endsWith('/internal/bot/status')) return Promise.resolve({ data: { ok: true, status: {} } });
  if (url.endsWith('/api/admin/db/status')) return Promise.resolve({ data: { database: 'testdb', host: 'localhost', tables: 0, counts: {}, version: '1', dbSize: { pretty: '0B' }, lastBackup: null, largestTables: [] } });
  if (url.endsWith('/api/admin/control/cert/status')) return Promise.resolve({ data: { ok: true } });
  if (url.endsWith('/api/admin/control/cert/config')) return Promise.resolve({ data: { config: { domain: 'localhost.test', email: 'admin@example.com', api_token: '********' } } });
  return Promise.resolve({ data: {} });
};

const outdated = {
  current: '1.9.29',
  latest: '1.9.30',
  isOutdated: true,
  checkedAt: '2025-01-01T00:00:00Z',
  lastAppliedAt: null,
};

const current = {
  current: '1.9.30',
  latest: '1.9.30',
  isOutdated: false,
  checkedAt: '2025-06-01T00:00:00Z',
  lastAppliedAt: null,
};

describe('SettingsPage Control Panel version check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.setItem('settings.lastTab', 'control'); } catch {}

    axios.get.mockImplementation((url) => {
      // The Control tab reads version info on mount.
      if (url.endsWith(VERSION_URL)) return Promise.resolve({ data: outdated });
      return baseHandlers(url);
    });

    axios.put.mockImplementation(() => Promise.resolve({ status: 200, data: { ok: true } }));
  });

  it('renders the current and latest versions from the status endpoint', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('1.9.29')).toBeInTheDocument();
    expect(await screen.findByText('1.9.30')).toBeInTheDocument();
    expect(screen.getByText('Current Version')).toBeInTheDocument();
    expect(screen.getByText('Latest Version')).toBeInTheDocument();
  });

  it('offers the Check for Update action on the Control tab', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('1.9.29')).toBeInTheDocument();
    // The rendered label is singular "Check for Update" (SettingsPage.jsx:1704).
    // Anchored with ^...$ so an added/plural "s" cannot slip through.
    expect(screen.getByRole('button', { name: /^Check for Update$/i })).toBeInTheDocument();
  });

  it('clicking Check for Update re-reads the status endpoint', async () => {
    render(<SettingsPage />);

    const checkBtn = await screen.findByRole('button', { name: /^Check for Update$/i });
    const countVersionCalls = () =>
      axios.get.mock.calls.filter(c => String(c[0]).endsWith(VERSION_URL)).length;

    const before = countVersionCalls();

    // Flip the response so a refetch is observable in the DOM.
    axios.get.mockImplementation((url) => {
      if (url.endsWith(VERSION_URL)) return Promise.resolve({ data: current });
      return baseHandlers(url);
    });

    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(countVersionCalls()).toBeGreaterThan(before);
    });

    // The refreshed values are rendered.
    expect(await screen.findByText('Current Version')).toBeInTheDocument();
  });

  it('falls back to an em dash when the status endpoint returns nothing', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith(VERSION_URL)) return Promise.resolve({ data: null });
      return baseHandlers(url);
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Current Version')).toBeInTheDocument();
    });
    // Current/Latest render an em dash rather than blank when unknown.
    expect(screen.getAllByText('\u2014').length).toBeGreaterThan(0);
  });
});