/**
 * Browser smoke tests (`npm run e2e`). Unit tests run in jsdom, which has no Worker, no service
 * worker and no layout — so the three things M49 shipped could only be checked by hand. These run
 * the production build under the Pages sub-path, the way the site is actually served.
 *
 * Not part of `npm run check`: it needs a browser. CI runs it as its own job.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
export const BASE_PATH = '/mirror-dungeon/';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    // The container ships a Chromium at a fixed path; CI installs Playwright's own.
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `VITE_BASE=${BASE_PATH} npm run build && VITE_BASE=${BASE_PATH} npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
