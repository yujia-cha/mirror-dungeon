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
     * Measured with `npm run test:coverage`, and since M58 **a floor, not a target**.
     *
     * M48 held off because a threshold would turn a number nobody had looked at into a gate. It has
     * now been looked at three times and only ever went up (statements 65.65 → 65.91 → 66.32%). The
     * floor sits just under the last measurement, so it catches a change that removes tests or adds
     * a block of untested code, not the ordinary wobble of a refactor. Raise it when the numbers do;
     * never lower it to get a change through. CI runs this; `npm run check` stays fast and does not.
     * Generated data, config and the entry point are excluded because their coverage says nothing.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', '**/*.d.ts'],
      // Measured at M58: 66.32 / 59.76 / 72.38 / 67.75.
      thresholds: { statements: 65.5, branches: 59, functions: 71.5, lines: 67 },
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
