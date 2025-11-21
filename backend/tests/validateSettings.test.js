const { validateSettings } = require('../lib/validateSettings');

describe('validateSettings general pricing', () => {
  test('accepts valid numeric pricing and currency', () => {
    const body = { price_mini: 1.5, price_basic: '2.00', price_unlimited: '0', currency: 'usd', title: 'Site' };
    const { ok, errors, cleaned } = validateSettings('general', body);
    expect(ok).toBe(true);
    expect(errors.length).toBe(0);
    expect(cleaned.price_mini_cents).toBe(150);
    expect(cleaned.price_basic_cents).toBe(200);
    expect(cleaned.price_unlimited_cents).toBe(0);
    expect(cleaned.currency).toBe('USD');
    expect(cleaned.title).toBe('Site');
  });

  test('rejects negative pricing and empty currency', () => {
    const body = { price_mini: -1, price_basic: 'abc', price_unlimited: null, currency: '' };
    const { ok, errors } = validateSettings('general', body);
    expect(ok).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('price_mini'), expect.stringContaining('price_basic')]));
  });

  test('accepts integer-cent fields directly and prefers them', () => {
    const body = { price_mini_cents: 250, price_basic_cents: '300', price_unlimited: 1.5, currency: 'USD' };
    const { ok, errors, cleaned } = validateSettings('general', body);
    expect(ok).toBe(true);
    expect(errors.length).toBe(0);
    expect(cleaned.price_mini_cents).toBe(250);
    expect(cleaned.price_basic_cents).toBe(300);
    // price_unlimited provided as decimal should be converted
    expect(cleaned.price_unlimited_cents).toBe(150);
  });
});
