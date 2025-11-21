import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

// Strict config: identical to base but with errors for no-unused-vars/no-empty
const languageOptions = {
  ecmaVersion: 2020,
  globals: globals.browser,
  parserOptions: {
    ecmaVersion: 'latest',
    ecmaFeatures: { jsx: true },
    sourceType: 'module',
  },
}

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
    languageOptions,
    rules: {
      // Ensure JSX identifiers mark variables as used
      'react/jsx-uses-vars': 'error',
      // Elevate to errors in strict mode, but do not flag unused catch params
      'no-unused-vars': ['error', { varsIgnorePattern: '^(React|e|err|type|motion|[A-Z_])$', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Keep as error but allow empty catch blocks (widely used in codebase)
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/__tests__/**/*.{js,jsx}'],
    languageOptions,
    rules: {
      'no-unused-vars': 'off',
    },
  },
])
