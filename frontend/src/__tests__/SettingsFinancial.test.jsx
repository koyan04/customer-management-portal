import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsPage from '../pages/SettingsPage'

// Provide a fake auth context so the page can render in tests
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 'fake', user: { id: 1, role: 'ADMIN' } }) }));

// Mock axios to avoid real network calls
vi.mock('axios', () => ({ default: { get: vi.fn(async () => ({ data: { data: {} } })), put: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true } })) } }));

describe('Settings Financial view', () => {
  const origLS = global.localStorage;
  beforeEach(() => {
    const store = new Map();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, v),
        removeItem: (k) => store.delete(k)
      },
      configurable: true
    });
  });
  afterEach(() => {
    Object.defineProperty(window, 'localStorage', { value: origLS });
  });

  test('renders financial inputs in settings page', async () => {
    render(<SettingsPage />)
    // Switch to General tab so inputs are rendered by the component
    const genBtn = await screen.findByRole('tab', { name: /General/i });
  fireEvent.click(genBtn);
  // Expect the inputs to be present (labels used in the real page)
  expect(await screen.findByLabelText(/Price \(Mini\)/i)).toBeTruthy()
  expect(screen.getByLabelText(/Price \(Basic\)/i)).toBeTruthy()
  expect(screen.getByLabelText(/Price \(Unlimited\)/i)).toBeTruthy()
  expect(screen.getByLabelText(/Currency/i)).toBeTruthy()
  })
})
