import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/backup/**']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Mark vars used in JSX as referenced so no-unused-vars doesn't flag them
      'react/jsx-uses-vars': 'warn',
      // Permit throwaway identifiers commonly used in try/catch and quick branching
      'no-unused-vars': ['warn', { varsIgnorePattern: '^(e|err|type|motion|[A-Z_])$', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Avoid blocking CI on empty blocks during refactors
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Loosen react-refresh-only-exports in main.jsx/AuthContext.jsx to avoid false positives
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/__tests__/**/*.{js,jsx}'],
    rules: {
      // Tests often import helpers for clarity; don't error on unused in tests
      'no-unused-vars': 'off',
    },
  },
])
