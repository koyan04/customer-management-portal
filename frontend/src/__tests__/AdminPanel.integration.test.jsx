import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPanelPage from '../pages/AdminPanelPage.jsx';
import { server } from './testServer';
import { rest } from 'msw';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';

// mock AuthContext hook to provide a token/user for the integration render
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: 'fake-token', user: { id: 1, username: 'admin', role: 'ADMIN' } })
}));

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AdminPanel integration', () => {
  it('clicking a card opens edit modal with prefilled fields', async () => {
    // Arrange: mock /api/admin/accounts to return one account
    server.use(rest.get('/api/admin/accounts', (req, res, ctx) => {
      return res(ctx.json([{ id: 42, display_name: 'Jane Doe', username: 'jdoe', role: 'VIEWER' }]));
    }));

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
