import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test.setup.js'],
    globalSetup: ['./vitest.global-setup.js'],
    // Restrict test discovery to our source tests and explicitly ignore library/internal test files.
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'src/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}'
    ],
    exclude: [
      'node_modules/**',
      // Ignore build and config artifacts
      'dist/**', 'coverage/**',
      // Exclude flaky duplicate integration test; covered by MSW suite for now
      'src/pages/__tests__/SettingsSnapshot.integration.test.jsx'
    ]
  }
});
