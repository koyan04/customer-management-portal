import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard } from '../lib/clipboard';

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for empty or null text', async () => {
    expect(await copyToClipboard('')).toBe(false);
    expect(await copyToClipboard(null)).toBe(false);
    expect(await copyToClipboard(undefined)).toBe(false);
  });

  it('uses navigator.clipboard.writeText when available and succeeding', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const res = await copyToClipboard('https://example.com/sub/token123');
    expect(res).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('https://example.com/sub/token123');
  });

  it('falls back to execCommand when navigator.clipboard.writeText throws', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    const res = await copyToClipboard('fallback-key-text');
    expect(res).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when navigator.clipboard is not available', async () => {
    const originalClipboard = navigator.clipboard;
    // @ts-ignore
    delete navigator.clipboard;

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    const res = await copyToClipboard('no-clipboard-api-text');
    expect(res).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith('copy');

    navigator.clipboard = originalClipboard;
  });
});
