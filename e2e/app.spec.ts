import { expect, test } from '@playwright/test';
import { FormationDeckCode, createFormationDetailInfo } from 'limbus-formation-deck';
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

test('a formation code imports in the browser (M62)', async ({ page }) => {
  // The old decoder used Node's `Buffer`, so every code failed here while unit tests under Node passed.
  const deployed = new Map([
    [10101, 1],
    [10301, 2],
    [10501, 3],
  ]);
  const code = FormationDeckCode.encode(
    [10101, 10201, 10301, 10401, 10501].map((personalityId, index) =>
      createFormationDetailInfo({
        slot: index + 1,
        personalityId,
        slotType: deployed.get(personalityId) ?? 0,
      }),
    ),
  );
  await page.goto('./');
  await page.getByRole('tab', { name: '덱' }).click();
  await page.getByRole('button', { name: '코드 가져오기' }).click();
  await page.getByLabel('편성 코드를 붙여넣으세요').fill(code);
  await page.getByRole('button', { name: '불러오기' }).click();
  await expect(page.getByText('편성 코드를 읽을 수 없습니다')).toHaveCount(0);
  await expect(page.getByLabel('편성 코드를 붙여넣으세요')).toHaveCount(0);
  const state = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state as {
        deck: number[];
        deployed: number[];
      },
  );
  expect(state.deck).toEqual([10101, 10201, 10301, 10401, 10501]);
  expect(state.deployed).toEqual([10101, 10301, 10501]);
});

test('a sinner picker opened from the right column stays inside the panel (M63)', async ({ page }) => {
  // It was pinned to the slot's left edge at 340px, so a right-column slot ran past the panel's
  // right edge and the panel body clipped the search field.
  for (const width of [420, 490, 560]) {
    await page.addInitScript((w) => {
      localStorage.setItem(
        'md-route-planner',
        JSON.stringify({ state: { ui: { leftOpen: true, leftTab: 'deck', leftWidth: w } }, version: 7 }),
      );
    }, width);
    await page.goto('./');
    const panel = page.getByTestId('panel-left');
    const body = panel.locator('.\\@container').first();
    const slots = panel.locator('li button[aria-expanded]');
    await expect(slots.first()).toBeVisible();
    // Every slot, so whichever column ends up rightmost at this width is covered.
    const count = await slots.count();
    for (let i = 0; i < count; i++) {
      await slots.nth(i).click();
      const picker = page.getByTestId('sinner-picker');
      await expect(picker).toBeVisible();
      const [box, bounds] = [await picker.boundingBox(), await body.boundingBox()];
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      await expect(picker.getByRole('combobox')).toBeFocused();
      // Focusing the field must not scroll the panel body sideways either.
      expect(await body.evaluate((el) => el.scrollLeft)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);
    }
  }
});
