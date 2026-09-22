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
    /**
     * Measured with `npm run test:coverage`, never enforced.
     *
     * A threshold would turn a number nobody had looked at into a gate, and the honest first step
     * is to be able to see it at all — until now there was no way to answer "how much of this is
     * covered?" even though `coverage/` had been in `.gitignore`-adjacent lists since the start.
     * Generated data, config and the entry point are excluded because their coverage says nothing.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', '**/*.d.ts'],
    },
    // Only the app tests need a DOM. The planner, the pipeline and the generated-data checks are
    // node code, and paying for a jsdom per worker on them was a fifth of the run; four of them
    // were already opting out one file at a time with `@vitest-environment node`.
    projects: [
      { extends: true, test: { name: 'app', environment: 'jsdom', include: ['src/app/**/*.test.{ts,tsx}'] } },
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/core/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'] } },
    ],
  },
});
