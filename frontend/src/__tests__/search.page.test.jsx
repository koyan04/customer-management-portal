import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SearchPage from '../pages/SearchPage.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';

// Mock axios
import axios from 'axios';
vi.mock('axios');

function Wrapper({ children }) {
  return (
    <MemoryRouter>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

describe('SearchPage', () => {
  test('renders and enforces min length', async () => {
    render(<SearchPage />, { wrapper: Wrapper });
    const input = screen.getByPlaceholderText(/search account name/i);
    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => {
      expect(screen.queryByText(/Enter at least 2 characters/i)).toBeTruthy();
    });
  });

  test('shows results from API', async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: [ { id: 1, account_name: 'john_doe', service_type: 'Mini', server_name: 'Alpha', expire_date: '2025-12-01', server_id: 10 } ] });
    render(<SearchPage />, { wrapper: Wrapper });
    const input = screen.getByPlaceholderText(/search account name/i);
    fireEvent.change(input, { target: { value: 'john' } });
    await waitFor(() => screen.getByText('john_doe'));
    expect(screen.getByText('john_doe')).toBeTruthy();
  });
});
