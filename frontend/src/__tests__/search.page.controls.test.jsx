import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SearchPage from '../pages/SearchPage.jsx';

// Mock axios
import axios from 'axios';
vi.mock('axios');

// Mock AuthContext used by SearchPage to simulate an ADMIN with a token
vi.mock('../context/AuthContext', () => {
  return {
    useAuth: () => ({ token: 'test-token', user: { role: 'ADMIN' } })
  };
});

function Wrapper({ children }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SearchPage controls', () => {
  test('sends fuzzy=1 when fuzzy toggle is enabled', async () => {
    // First search response (without fuzzy)
    axios.get.mockResolvedValueOnce({ status: 200, data: [] });
    // Second search response (with fuzzy)
    axios.get.mockResolvedValueOnce({ status: 200, data: [] });

    render(<SearchPage />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(/search account name/i);
    fireEvent.change(input, { target: { value: 'jo' } });

    // Wait for first request (no fuzzy param expected)
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    // Toggle fuzzy and expect another request with fuzzy=1 param
    const fuzzyToggle = screen.getByLabelText(/enable fuzzy matching/i);
    fireEvent.click(fuzzyToggle);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    const lastCall = axios.get.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    const [, config] = lastCall;
    expect(config).toBeTruthy();
    expect(config.params).toBeTruthy();
    expect(config.params.q).toBe('jo');
    expect(config.params.fuzzy).toBe('1');
  });

  test('bulk extend (+1M) triggers sequential PUTs for selected users', async () => {
    const users = [
      { id: 1, account_name: 'alpha', service_type: 'Mini', contact: 'a', expire_date: '2025-01-15', total_devices: 1, data_limit_gb: 10, remark: '', display_pos: 1, server_id: 10, server_name: 'S1', status: 'active' },
      { id: 2, account_name: 'beta', service_type: 'Basic', contact: 'b', expire_date: '2025-01-20', total_devices: 2, data_limit_gb: 20, remark: '', display_pos: 2, server_id: 11, server_name: 'S2', status: 'soon' }
    ];

    axios.get.mockResolvedValueOnce({ status: 200, data: users });
    axios.put.mockResolvedValue({ status: 200, data: {} });

    render(<SearchPage />, { wrapper: Wrapper });

    const input = screen.getByPlaceholderText(/search account name/i);
    fireEvent.change(input, { target: { value: 'a' } });

    // Minimum length is 2, so update to 2+ chars
    fireEvent.change(input, { target: { value: 'al' } });

    // Wait for rows
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeTruthy();
      expect(screen.getByText('beta')).toBeTruthy();
    });

    // Select all
    const selectAll = screen.getByLabelText(/select all/i);
    fireEvent.click(selectAll);

    // Bulk button should appear with count
    await waitFor(() => {
      expect(screen.getByTitle(/extend selected users by 1 month/i)).toHaveTextContent('+1M (2)');
    });

    // Click bulk extend
    fireEvent.click(screen.getByTitle(/extend selected users by 1 month/i));

    // Expect two sequential PUTs
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledTimes(2);
    });

    const firstPut = axios.put.mock.calls[0];
    const secondPut = axios.put.mock.calls[1];

    // URLs should end with /api/users/{id}
    expect(firstPut[0]).toMatch(/\/api\/users\/1$/);
    expect(secondPut[0]).toMatch(/\/api\/users\/2$/);

    // Payloads should have expire_date + 1 month
  const firstPayload = firstPut[1];
  const secondPayload = secondPut[1];
  // Compute expected next-month dates using same logic (Date parsing + setMonth + toISOString)
  const d1 = new Date('2025-01-15'); d1.setHours(0,0,0,0); d1.setMonth(d1.getMonth() + 1);
  const d2 = new Date('2025-01-20'); d2.setHours(0,0,0,0); d2.setMonth(d2.getMonth() + 1);
  expect(firstPayload.expire_date).toBe(d1.toISOString().slice(0,10));
  expect(secondPayload.expire_date).toBe(d2.toISOString().slice(0,10));

    // After completion, the bulk button should disappear (selection cleared)
    await waitFor(() => {
      expect(screen.queryByTitle(/extend selected users by 1 month/i)).toBeNull();
    });
  });
});
