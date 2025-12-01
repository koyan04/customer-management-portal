import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Dev port dynamic override removed; using default 5173

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  }
  ,
  // Vitest configuration: ensure tests run with a browser-like environment
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: 'src/test.setup.js',
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**']
  }
})
