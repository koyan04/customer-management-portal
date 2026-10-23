import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SubscriptionToast from '../components/SubscriptionToast.jsx';

describe('SubscriptionToast', () => {
  it('renders subscription url and filename', () => {
    render(<SubscriptionToast url="http://example.com/sub/token123?key=secret" filename="vchannel-test.yaml" />);
    expect(screen.getByText(/Saved as/i)).toBeDefined();
    expect(screen.getByText('vchannel-test.yaml')).toBeDefined();
    const input = screen.getByDisplayValue('http://example.com/sub/token123?key=secret');
    expect(input).toBeDefined();
  });

  it('clicking copy button copies URL to clipboard and updates label', async () => {
    const writeTextMock = vi.fn().mockResolvedValue();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<SubscriptionToast url="http://example.com/sub/token123?key=secret" filename="vchannel-test.yaml" />);
    const copyBtn = screen.getByRole('button', { name: /Copy subscription link/i });
    expect(copyBtn).toBeDefined();

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('http://example.com/sub/token123?key=secret');
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeDefined();
    });
  });
});
