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
  // A gift tile draws the game icon (M94) from under the sub-path, and it actually decodes. The
  // items tab lists gifts only for a query since M121, so it asks for one.
  await page.getByTestId('panel-left').getByRole('textbox', { name: '기프트 검색' }).fill('진혼');
  const icon = page.getByTestId('panel-left').locator('[data-testid="gift-icon"] img').first();
  await expect(icon).toBeVisible();
  expect(await icon.getAttribute('src')).toMatch(/\/mirror-dungeon\/icons\/gifts\/\d+\.webp$/);
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // The keyword badge is the game's keyword icon (M99), from the same sub-path. The tracker lists
  // keyword gifts, so it has badges to look at.
  await page.getByRole('tab', { name: '추적기' }).click();
  const badge = page.locator('[data-testid^="tracker-"] [data-testid="gift-keyword"] img').first();
  await expect(badge).toBeVisible();
  expect(await badge.getAttribute('src')).toMatch(/\/mirror-dungeon\/icons\/keywords\/[A-Za-z]+\.webp$/);
  await expect.poll(() => badge.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // The pack cards draw the game's pack art (M100), shrunk by data:icons, from the same sub-path.
  await page.getByText('다른 팩').first().click();
  const art = page.locator('[data-testid="pack-image"] img').first();
  await expect(art).toBeVisible();
  expect(await art.getAttribute('src')).toMatch(/\/mirror-dungeon\/icons\/packs\/[^/]+\.webp$/);
  await expect.poll(() => art.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256);
  // No 404 anywhere — not the worker chunk, not a manifest, not a data file, not an icon.
  expect(failed).toEqual([]);
});

test('plans off the render thread, and the drop analysis follows the route', async ({ page }) => {
  const workerChunk = page.waitForResponse((response) => /planner\.worker-[^/]*\.js$/.test(response.url()));
  await page.goto(`./${shareHash(CONFLICTING)}`);
  expect((await workerChunk).status()).toBe(200);

  // On desktop both panels start open; the right one shows the route tab.
  await page.getByRole('tab', { name: '전체 루트' }).click();
  const plan = page.getByTestId('route-plan');
  await expect(plan).toBeVisible();
  await expect(page.getByTestId('route-pending')).toHaveCount(0);
  // The worker answered, not the inline fallback: the ways to fit and the drop bars come from its
  // second answer (the bars under 「자세히」, M144).
  await expect(page.getByTestId('resolution').first()).toBeVisible();
  await page.getByTestId('drop-details').locator('summary').click();
  await expect(page.getByTestId('drop-effect').first()).toBeVisible();
  // M115: the card names both sides — a trade-off line and the bars' roles.
  await expect(page.getByTestId('drop-tradeoff').first()).toBeVisible();
  await expect(page.getByTestId('drop-role').first()).toBeVisible();
});

test('a share link survives the round trip', async ({ page }) => {
  await page.goto(`./${shareHash([9250, 9251])}`);
  await page.getByRole('tab', { name: '기프트' }).click();
  await expect(page.getByTestId('gift-chip')).toHaveCount(2);
});

// M145: the app always opens the default season. A link made in MD7 still opens — in MD8, with its
// goals — and the footer names the season without offering a choice.
test('an MD7 share link opens in the default season', async ({ page }) => {
  await page.goto(`./${shareHash([9250, 9251], 7)}`);
  await page.getByRole('tab', { name: '기프트' }).click();
  await expect(page.getByTestId('gift-chip')).toHaveCount(2);
  await expect(page.getByTestId('season-name')).toHaveText('시지프의 거울');
  await expect(page.getByRole('contentinfo').locator('select')).toHaveCount(0);
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
  // index · enums · identities · md7 meta · rules · gifts · packs · skill-gifts (M129).
  expect(dataRequests.size).toBe(8);
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

test('a sinner picker opens as a sheet the panel cannot clip, at any panel width (M63, M126)', async ({
  page,
}) => {
  // M63: it floated under its slot at 340px, and a right-column slot ran past the panel's edge so
  // the panel body clipped the search field. M126 made it a sheet portaled to the body: whatever the
  // panel width, it lies inside the viewport, its field takes focus, Escape closes it, and focus
  // goes back to the slot.
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
    const slots = panel.locator('li button[aria-haspopup="dialog"]');
    await expect(slots.first()).toBeVisible();
    const viewport = page.viewportSize()!;
    // Every slot, so whichever column ends up rightmost at this width is covered.
    const count = await slots.count();
    for (let i = 0; i < count; i++) {
      await slots.nth(i).click();
      const picker = page.getByTestId('sinner-picker');
      await expect(picker).toBeVisible();
      const sheet = page.getByTestId('block-sheet');
      const box = (await sheet.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      // Not inside the panel: the panel cannot clip what is not in it.
      expect(await panel.locator('[data-testid="sinner-picker"]').count()).toBe(0);
      await expect(picker.getByRole('combobox')).toBeFocused();
      await expect(picker.getByRole('group', { name: '검색어 조합' })).toBeVisible();
      // Focusing the field must not scroll the panel body sideways either.
      expect(await body.evaluate((el) => el.scrollLeft)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);
      await expect(slots.nth(i)).toBeFocused();
    }
  }
});

test('the >> beside the gift search opens 「모두 보기」 over the stage with the query, and a tile picked there is a goal (M71)', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('tab', { name: '기프트' }).click();
  // The tab has no filters and no 「기타」 any more; the >> at the end of its search row is the door.
  await page.getByTestId('panel-left').getByRole('textbox', { name: '기프트 검색' }).fill('진혼');
  await page.getByRole('button', { name: '모두 보기', exact: true }).click();
  const browser = page.getByTestId('gift-browser');
  await expect(browser).toBeVisible();
  // It takes the stage's column: the panels stay on either side, and the stage is not on screen.
  await expect(page.getByTestId('panel-left')).toBeVisible();
  await expect(page.getByTestId('panel-right')).toBeVisible();
  await expect(page.getByTestId('run-stage')).toBeHidden();
  // Two search boxes exist (the tab's and the browser's); the browser's opened on the tab's query.
  await expect(browser.getByRole('textbox', { name: '기프트 검색' })).toHaveValue('진혼');
  // It opens on 「추천 기프트」 (M121); the default deck deploys nobody, so 진혼 is in 「모든 기프트」.
  await expect(browser.getByRole('tab', { name: '추천 기프트' })).toHaveAttribute('aria-selected', 'true');
  await browser.getByRole('tab', { name: '모든 기프트' }).click();
  await browser.getByRole('button', { name: '진혼', exact: true }).click();
  await expect(page.getByTestId('gift-chip')).toHaveCount(1);
  await browser.getByRole('button', { name: '닫기' }).click();
  await expect(browser).toHaveCount(0);
  await expect(page.getByTestId('run-stage')).toBeVisible();
  // The same door closes it: while it is open the >> reads << (M77).
  await page.getByRole('button', { name: '모두 보기', exact: true }).click();
  await expect(browser).toBeVisible();
  await page.getByRole('button', { name: '모두 보기 닫기' }).click();
  await expect(browser).toHaveCount(0);
  await expect(page.getByTestId('run-stage')).toBeVisible();
  await expect(page.getByRole('button', { name: '모두 보기', exact: true })).toBeVisible();
});

test('every row of the 「⋯」 menu spans the menu, at every text size (M122)', async ({ page }) => {
  // The menu is as wide as its widest section; a section sized to its own content left the four
  // actions shorter than the size steps below them. Measured in a real layout, so it catches any
  // section that stops stretching — whatever is added to the menu next.
  await page.goto('./');
  await expect(page.getByTestId('run-stage')).toBeVisible();
  await page.getByRole('button', { name: '더 보기' }).click();
  const popover = page.getByTestId('block-popover');
  for (const step of ['작게', '보통', '크게', '아주 크게']) {
    await page.getByTestId('type-size').getByRole('button', { name: step, exact: true }).click();
    const widths = await popover.evaluate((root) => {
      const inner = root.clientWidth - parseFloat(getComputedStyle(root).paddingLeft) * 2;
      const rows = [
        ...root.querySelectorAll('[data-testid="header-menu"] button'),
        ...root.querySelectorAll('[role="group"]'),
      ].map((el) => el.getBoundingClientRect().width);
      return { inner, rows };
    });
    for (const width of widths.rows) expect(Math.abs(width - widths.inner)).toBeLessThanOrEqual(1);
  }
});

test('「글자 크기」 scales the type roles, survives a reload, and fits (M123)', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('run-stage')).toBeVisible();
  const bodySize = () => page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(await bodySize()).toBe('13px');

  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByTestId('type-size').getByRole('button', { name: '아주 크게' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-scale', 'xl');
  expect(await bodySize()).toBe('16.9px'); // 13 × 1.3
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByTestId('run-stage')).toBeVisible();
  expect(await bodySize()).toBe('16.9px');
  // At the largest step the page still does not scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test('the saved 「글자 크기」 is on the page before any app script runs (M123)', async ({
  browser,
  baseURL,
}) => {
  // No service worker, so every script request reaches the route below.
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.localStorage.setItem(
      'md-route-planner',
      JSON.stringify({ state: { ui: { textScale: 'lg' } }, version: 7 }),
    );
  });
  // Only `index.html`'s inline pre-paint script may run: the app bundle never arrives.
  await context.route(/\.(js|tsx?)(\?.*)?$/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-text-scale', 'lg');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('14.95px'); // 13 × 1.15
  await context.close();
});
