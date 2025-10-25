import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
// using Vitest globals per config

// Mock axios to avoid real HTTP calls and msw/node dependency
vi.mock('axios', () => {
  const mock = {
    get: vi.fn(async (url) => {
      // default empty lists
      if (url.includes('/api/admin/accounts')) return { data: [] };
      if (url.includes('/api/servers')) return { data: [] };
      return { data: [] };
    }),
  };
  return { default: mock };
});
import axios from 'axios';

// mock AuthContext hook to provide a token/user for the integration render
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: 'fake-token', user: { id: 1, username: 'admin', role: 'ADMIN' } })
}));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.clearAllMocks(); });

describe('AdminPanel integration', () => {
  it('clicking a card opens edit modal with prefilled fields', async () => {
    // Arrange: first GET /api/admin/accounts returns one account, second GET /api/servers returns empty
    axios.get
      .mockResolvedValueOnce({ data: [{ id: 42, display_name: 'Jane Doe', username: 'jdoe', role: 'VIEWER' }] })
      .mockResolvedValueOnce({ data: [] });

  const AdminPanelPage = (await import('../pages/AdminPanelPage.jsx')).default;
  render(<AdminPanelPage />);

    // Wait for the account card to render by finding the element that displays the account name
    const displayNode = await screen.findByText('Jane Doe', { selector: '.account-display' });
    const card = displayNode.closest('.account-card');
    expect(card).toBeTruthy();

    // Act: click the card
    fireEvent.click(card);

    // Assert: the modal should open and show the editing form with display_name prefilled
    const input = await screen.findByDisplayValue('Jane Doe');
    expect(input).toBeTruthy();
  });
});
