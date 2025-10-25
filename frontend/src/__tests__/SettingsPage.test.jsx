import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPage from '../pages/SettingsPage.jsx';
// using Vitest globals per config

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 'fake', user: { id: 1, role: 'ADMIN' } }) }));

// Mock axios to avoid real calls
vi.mock('axios', () => ({ default: { get: vi.fn(async () => ({ data: { data: {} } })), put: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true } })) } }));

describe('SettingsPage basic', () => {
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

  it('renders file inputs and persists last tab', async () => {
    render(<SettingsPage />);

    // default tab database should render restore inputs
    const cfgInput = await screen.findByLabelText(/Restore Config/i);
    const dbInput = await screen.findByLabelText(/Restore Database/i);
    expect(cfgInput).toBeTruthy();
    expect(dbInput).toBeTruthy();

    // switch to Telegram, ensure lastTab is stored
    const telBtn = await screen.findByRole('tab', { name: /Telegram Bot/i });
    fireEvent.click(telBtn);
    expect(window.localStorage.getItem('settings.lastTab')).toBe('telegram');
  });

  it('renders financial inputs and allows editing', async () => {
    render(<SettingsPage />);
    // Switch to General tab
    const genBtn = await screen.findByRole('tab', { name: /General/i });
    fireEvent.click(genBtn);
    // Wait for price inputs
    const priceMini = await screen.findByLabelText(/Price \(Mini\)/i);
    const priceBasic = await screen.findByLabelText(/Price \(Basic\)/i);
    const priceUnl = await screen.findByLabelText(/Price \(Unlimited\)/i);
    const currency = await screen.findByLabelText(/Currency/i);

    expect(priceMini).toBeTruthy();
  fireEvent.change(priceMini, { target: { value: '3.50' } });
  // value may stringify differently; compare as Number
  expect(Number(priceMini.value)).toBeCloseTo(3.5);

  fireEvent.change(priceBasic, { target: { value: '4.00' } });
  expect(Number(priceBasic.value)).toBeCloseTo(4.0);

  fireEvent.change(priceUnl, { target: { value: '0' } });
  expect(Number(priceUnl.value)).toBeCloseTo(0);

  fireEvent.change(currency, { target: { value: 'eur' } });
  expect(currency.value).toBe('eur');
  });
});
