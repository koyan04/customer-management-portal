import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import IdleToast from '../components/IdleToast.jsx';
import { vi } from 'vitest';

// Mock a simple AuthContext provider to supply replaceToken and refreshWithCookie
const MockAuthProvider = ({ children, refreshWithCookie }) => {
  const ctx = { replaceToken: vi.fn(), refreshWithCookie };
  return (
    <div data-testid="mock-auth-provider" data-ctx>{children}</div>
  );
};

test('clicking Extend calls refreshWithCookie and closes the toast', async () => {
  // Mock refreshWithCookie to return a token
  const refreshMock = vi.fn(async () => 'new.token.value');
  const replaceMock = vi.fn();

  render(
    <MockAuthProvider refreshWithCookie={refreshMock}>
      <IdleToast isOpen={true} remainingMs={30000} onExtend={async () => {
        await refreshMock();
      }} onClose={() => {}} />
    </MockAuthProvider>
  );

  // Ensure the Extend button is present
  const extendBtn = screen.getByText(/Extend/i);
  expect(extendBtn).toBeInTheDocument();

  // Click the Extend button
  fireEvent.click(extendBtn);

  await waitFor(() => {
    expect(refreshMock).toHaveBeenCalled();
  });
});
