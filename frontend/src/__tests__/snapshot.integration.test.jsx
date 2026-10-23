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
		// Backup/restore controls live on the Database tab (the default tab).
		// The button was relabelled from "Download Telegram backup (JSON)" to
		// "Telegram snapshot" during the settings rewrite.
		const btn = await screen.findByRole('button', { name: /Telegram snapshot/i });
		await userEvent.click(btn);
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Download started/i));
		// NOTE: Upload flow covered in SettingsSnapshot.msw.test.jsx; keeping only download here.
	});
});
