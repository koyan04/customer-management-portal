import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

// Mock AuthContext used by App
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: null, user: null, logout: () => {}, replaceToken: () => {}, refreshWithCookie: async () => null }) }));

import App from '../App.jsx';

describe('App footer shows version from /api/health', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch for both general settings and health
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if (u.endsWith('/api/admin/public/settings/general')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { title: 'VChannel', theme: 'system', autoLogoutMinutes: 0 } }), { status: 200 }));
      }
      if (u.endsWith('/api/health')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, versions: { appVersion: 'cmp ver 1.0' } }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
  });

  it('renders the app version in the footer', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/cmp ver 1\.0/i)).toBeInTheDocument();
    });
  });
});
