import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    // Only the app tests need a DOM. The planner, the pipeline and the generated-data checks are
    // node code, and paying for a jsdom per worker on them was a fifth of the run; four of them
    // were already opting out one file at a time with `@vitest-environment node`.
    projects: [
      { extends: true, test: { name: 'app', environment: 'jsdom', include: ['src/app/**/*.test.{ts,tsx}'] } },
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/core/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'] } },
    ],
  },
});
