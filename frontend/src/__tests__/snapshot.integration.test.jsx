import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { server } from './testServer';
import SettingsPage from '../pages/SettingsPage.jsx';

// Provide a simple auth mock; MSW handlers don't require Authorization
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 'fake' }) }));

describe('Snapshot integration (download only)', () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it('downloads Telegram snapshot (JSON) and shows confirmation (merged)', async () => {
		render(<SettingsPage />);
		// Navigate to Database tab if not default; default is 'database'
		const btn = await screen.findByRole('button', { name: /Download Telegram backup \(JSON\)/i });
		await userEvent.click(btn);
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Download started/i));
		// NOTE: Upload flow covered in SettingsSnapshot.msw.test.jsx; keeping only download here.
	});
});
