import { expect, test } from '@playwright/test';
import { shareHash } from './share.ts';

/** Six clear-reward gifts that cannot all fit one run: the route has alternatives to offer. */
const CONFLICTING = [9250, 9251, 9252, 9253, 9254, 9255];

test('opens under the Pages sub-path with its data', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('run-stage')).toBeVisible();
  // No 404 anywhere — not the worker chunk, not the art manifest, not a data file.
  expect(failed).toEqual([]);
});

test('plans off the render thread, and the alternatives follow the route', async ({ page }) => {
  const workerChunk = page.waitForResponse((response) => /planner\.worker-[^/]*\.js$/.test(response.url()));
  await page.goto(`./${shareHash(CONFLICTING)}`);
  expect((await workerChunk).status()).toBe(200);

  // On desktop both panels start open; the right one shows the route tab.
  await page.getByRole('tab', { name: '전체 루트' }).click();
  const plan = page.getByTestId('route-plan');
  await expect(plan).toBeVisible();
  await expect(page.getByTestId('route-pending')).toHaveCount(0);
  // The worker answered, not the inline fallback: the variants tab strip comes from its second answer.
  await expect(page.getByTestId('variants')).toBeVisible();
});

test('a share link survives the round trip', async ({ page }) => {
  await page.goto(`./${shareHash([9250, 9251])}`);
  await page.getByRole('tab', { name: '아이템' }).click();
  await expect(page.getByTestId('gift-chip')).toHaveCount(2);
});

test('registers a service worker scoped to the sub-path', async ({ page }) => {
  await page.goto('./');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/mirror-dungeon/');
});

test('the data preloads are the fetches the app makes, not a second copy (M58)', async ({ page }) => {
  const dataRequests = new Map<string, number>();
  const warnings: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/data/')) dataRequests.set(path, (dataRequests.get(path) ?? 0) + 1);
  });
  page.on('console', (message) => {
    if (/preload/i.test(message.text())) warnings.push(message.text());
  });
  await page.goto('./');
  await expect(page.getByTestId('run-stage')).toBeVisible();
  // Chrome reports an unmatched preload ("preloaded ... but not used") after a few seconds.
  await page.waitForTimeout(3500);
  expect(warnings).toEqual([]);
  expect([...dataRequests.values()].every((count) => count === 1)).toBe(true);
  expect(dataRequests.size).toBe(7);
});
