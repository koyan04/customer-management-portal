import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// mocks (must be declared before importing the component)
vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ status: 200, data: {
      year: 2025,
      months: [
        { month: '2025-07', revenue_cents: 50000, counts: { Mini: 3, Basic: 2, Unlimited: 0 }, prices: { price_mini_cents: 25000, price_basic_cents: 37500, price_unlimited_cents: 0 }, rawAudit: { currency: 'MMK' }, currentApp: { currency: 'MMK' } },
        { month: '2025-08', revenue_cents: 110000, counts: { Mini: 2, Basic: 1, Unlimited: 0 }, prices: { price_mini_cents: 35000, price_basic_cents: 40000, price_unlimited_cents: 0 }, rawAudit: { currency: 'MMK' }, currentApp: { currency: 'MMK' } },
        { month: '2025-09', revenue_cents: 270000, counts: { Mini: 3, Basic: 3, Unlimited: 0 }, prices: { price_mini_cents: 40000, price_basic_cents: 50000, price_unlimited_cents: 0 }, rawAudit: { currency: 'MMK' }, currentApp: { currency: 'MMK' } }
      ],
      yearTotals: { revenue_cents: 430000, counts: { Mini: 8, Basic: 6, Unlimited: 0 } }
    } }))
  }
}));

vi.mock('react-chartjs-2', () => ({
  Bar: (props) => <div data-testid="mock-bar">chart</div>
}));

// mock the same module path FinancialPage imports (src/context/AuthContext)
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));

import FinancialPage from '../FinancialPage';

describe('FinancialPage UI', () => {
  test('renders stat banners and chart with fetched data', async () => {
    render(<FinancialPage />);

    // wait for data load
    await waitFor(() => expect(screen.getByText(/Year: 2025/)).toBeInTheDocument());

  // stat banners (use getAllByText for labels that may appear elsewhere)
  expect(screen.getAllByText(/This month/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Last 6 months/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/All time total/).length).toBeGreaterThan(0);

    // chart placeholder
    expect(screen.getByTestId('mock-bar')).toBeInTheDocument();
  });
});
