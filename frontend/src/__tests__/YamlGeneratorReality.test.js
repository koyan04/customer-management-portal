import { describe, it, expect, vi } from 'vitest';

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: null })
}));

import { safeDecodePassword } from '../pages/YamlGeneratorPage.jsx';

describe('YAML Generator REALITY sanitization', () => {
  it('safeDecodePassword correctly handles decoded values', () => {
    expect(safeDecodePassword('testpass')).toBe('testpass');
    expect(safeDecodePassword('DC2vJc4y1bHWbciVbQ9zJRCJjye5xHlidFoj6GaGn%2BE%3D')).toBe('DC2vJc4y1bHWbciVbQ9zJRCJjye5xHlidFoj6GaGn+E=');
  });
});
