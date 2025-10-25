import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPanelPage from '../pages/AdminPanelPage.jsx';
import { server } from './testServer';

// mock AuthContext hook to provide a token
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: 'fake-token', user: { id: 1, username: 'admin', role: 'ADMIN' } })
}));

describe('AdminPanel header/actions', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('does not show change password toggle and shows add viewer + search', async () => {
    render(<AdminPanelPage />);

    // The old "Change My Password" button no longer exists
    const btn = screen.queryByRole('button', { name: /Change My Password/i });
    expect(btn).toBeNull();

    // Add viewer icon button should be present (ADMIN)
  const addBtn = await screen.findByRole('button', { name: /Add viewer/i });
    expect(addBtn).toBeTruthy();

    // Search input should be present
    const search = await screen.findByPlaceholderText(/Search by name or username/i);
    expect(search).toBeTruthy();
  });
});
