import { expect, test } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { BASE_PATH } from '../playwright.config.ts';

/**
 * M55: one online visit is enough to open the app offline.
 *
 * The server really goes away. Neither `context.setOffline` nor `context.route` reaches a service
 * worker's own `fetch` in Chromium — both were tried, and both passed against a worker that could
 * not open the app offline — so this test runs its own `vite preview` over the build the config's
 * web server made, and closes it between the two loads.
 */
let server: PreviewServer;

test.beforeEach(async () => {
  server = await preview({ base: BASE_PATH, preview: { port: 0, strictPort: false }, logLevel: 'silent' });
});

test.afterEach(async () => {
  await server.close().catch(() => {});
});

test('after one online visit, the app opens with the server gone', async ({ page, context }) => {
  // Browser HTTP cache off, so only the service worker can answer the second load.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await page.goto(`http://localhost:${port}${BASE_PATH}`);
  await expect(page.getByTestId('run-stage')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await server.close();
  await page.reload();
  await expect(page.getByTestId('run-stage')).toBeVisible();
  await expect(page.getByTestId('stage-floor')).toBeVisible();
});
