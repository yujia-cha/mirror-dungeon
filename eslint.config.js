import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'data/raw', 'public/data', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // The route planner must stay framework-free so it can run in tests and the CLI.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'zustand', '@/app/*'],
              message: 'src/core must stay pure TypeScript (no UI deps).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /*
       * v7 grew this preset from 2 rules to 16 by adding the React Compiler set. Fourteen of them
       * this codebase already satisfied, and `refs` was fixed by `useLatest`. `set-state-in-effect`
       * is the one still owed: nine sites, listed in docs/review/M34.md. They are not a config
       * problem — they are real 「effect writes state」 patterns that need restructuring (deriving
       * during render, or a `key`), and several sit in the data-loading and run-stage paths. That
       * is its own piece of work, not a dependency bump, so it is off with a receipt rather than
       * silently dropped.
       */
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
