import { expect, test } from '@playwright/test';
import { shareHash } from './share.ts';

/**
 * The stage's pull gesture, on a phone-sized touch device. Unit tests cannot see this: it depends on
 * `touch-action`, layout and real pointer events.
 */
test('pulling the skip card down moves to the next floor', async ({ page }) => {
  await page.goto('./');
  const floor = page.getByTestId('stage-floor');
  await expect(floor).toBeVisible();
  const before = await floor.textContent();

  const card = page.getByTestId('other-entry-card');
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(40, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y + step * 12);
  await page.mouse.up();

  await expect(floor).not.toHaveText(before ?? '');
});

test('a short pull springs back and changes nothing', async ({ page }) => {
  await page.goto('./');
  const floor = page.getByTestId('stage-floor');
  const before = await floor.textContent();
  const box = (await page.getByTestId('other-entry-card').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(40, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 3 });
  await page.mouse.up();
  await expect(floor).toHaveText(before ?? '');
});

/**
 * M54: a real touch sequence (CDP `Input.dispatchTouchEvent`, not mouse emulation). The slots sit
 * above the chips, so the drag moves up — the direction the browser reads as a scroll.
 */
test('a long press picks a chip up and drops it on an observation slot', async ({ page }) => {
  await page.goto(`./${shareHash([9222])}`);
  await page.getByRole('button', { name: '덱' }).click();
  await page.getByRole('tab', { name: '기프트' }).click();
  const chip = page.getByTestId('gift-chip').first();
  const slot = page.getByTestId('observe-slot').first();
  await chip.scrollIntoViewIfNeeded();
  const to = (await slot.boundingBox())!;
  // Start on the icon itself: a long press on an image is the browser's own drag or callout
  // unless the image opts out (`draggable={false}`, `-webkit-user-drag`/`-touch-callout: none`).
  const icon = (await chip.locator('img').first().boundingBox())!;
  const start = { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });

  await touch('touchStart', start);
  await page.waitForTimeout(450);
  await expect(page.getByTestId('chip-ghost')).toBeVisible();
  for (let i = 1; i <= 8; i += 1) {
    await touch('touchMove', {
      x: start.x + ((end.x - start.x) * i) / 8,
      y: start.y + ((end.y - start.y) * i) / 8,
    });
  }
  await touch('touchEnd');

  await expect(page.getByTestId('chip-ghost')).toHaveCount(0);
  await expect(page.getByTestId('observe-slot').first()).toHaveAttribute('data-gift', '9222');
});

/**
 * The guide's cards are a scroll-snap track (M78): a swipe is the browser's own scroll, which jsdom
 * has no layout for. Scrolling the track one card over has to move the counter, and the device's
 * back has to close the sheet rather than leave the page.
 */
test('the guide turns its cards by scrolling and closes on back', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('guide-open').click();
  const live = page.getByTestId('guide-live');
  await expect(live).toHaveText('1 / 6 · 무엇을 해 주나');
  await page.getByTestId('guide-track').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 }));
  await expect(live).toHaveText('3 / 6 · 기프트');
  // No card spills past the viewport: the page itself never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await page.goBack();
  await expect(page.getByTestId('guide')).toHaveCount(0);
  await expect(page.getByTestId('stage-floor')).toBeVisible();
});

/**
 * M121: on a phone 「모두 보기」 is a page of its own, and it opens on 「추천 기프트」. Its tabs and the
 * filter row have to fit the width — the page never scrolls sideways — and the tabs are 44px tall
 * for a finger.
 */
test('the gift browser page opens on 추천 기프트 and its tabs and filters fit the phone', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: '덱' }).click();
  await page.getByRole('tab', { name: '기프트' }).click();
  await page.getByTestId('gift-browse-all').click();
  const browser = page.getByTestId('gift-browser');
  await expect(browser).toBeVisible();
  const recommended = browser.getByRole('tab', { name: '추천 기프트' });
  await expect(recommended).toHaveAttribute('aria-selected', 'true');
  await expect(browser.getByTestId('recommend-filters')).toBeVisible();
  expect((await recommended.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await browser.getByRole('tab', { name: '모든 기프트' }).click();
  await expect(browser.getByTestId('gift-filters')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await browser.getByRole('button', { name: '뒤로' }).click();
  await expect(browser).toHaveCount(0);
});

/**
 * A sinner's identity picker on a phone (M126): a bottom sheet across the screen rather than a
 * narrow popover inside the slot's column, so the field, the OR / AND buttons and each row's
 * keyword chips have the width they need, and the page never scrolls sideways.
 */
test('a sinner picker is a full-width bottom sheet on a phone', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '덱' }).click();
  const deckPage = page.getByTestId('page-left');
  await deckPage.getByRole('tab', { name: '덱' }).click();
  await deckPage.locator('li button[aria-haspopup="dialog"]').nth(1).click();
  const sheet = page.getByTestId('block-sheet');
  await expect(sheet.getByTestId('sinner-picker')).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  // The device's back closes the sheet, not the deck page under it.
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(deckPage).toBeVisible();
  await deckPage.locator('li button[aria-haspopup="dialog"]').nth(1).click();
  await sheet.getByRole('button', { name: '모두' }).click();
  await sheet.getByRole('combobox').fill('화상');
  await expect(sheet.getByRole('option')).toHaveCount(2);
  await sheet.getByRole('option').first().getByRole('button').click();
  await expect(sheet).toHaveCount(0);
  await expect(deckPage.getByText('LCE E.G.O:: 홍염살')).toBeVisible();
});

/**
 * M124: 「모두 보기」 is a page over the items page, and both ways out — its ← and the device back —
 * land on the items tab as it was left. It used to close the items page and open its own in one
 * commit, a `history.back()` right before a `pushState`; Chrome let that back undo the new entry,
 * so the next back left the app. Each step waits for the history to stand as deep as the open
 * layers (the marker `usePageHistory` writes) before pressing back, as a person would.
 */
test('「모두 보기」 closes onto the items page by ← and by back, with or without a sheet, never leaving the app', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByTestId('stage-floor')).toBeVisible();
  const home = page.url();
  const depth = () => page.evaluate(() => (history.state as { layer?: number } | null)?.layer ?? 0);
  const back = async (layers: number) => {
    await expect.poll(depth).toBe(layers);
    await page.goBack();
  };
  const items = page.getByTestId('page-left');
  const search = items.getByRole('textbox', { name: '기프트 검색' });
  const browser = page.getByTestId('gift-browser');
  const expectOnItems = async () => {
    await expect(browser).toHaveCount(0);
    await expect(items).toBeVisible();
    await expect(items.getByRole('tab', { name: '기프트', selected: true })).toBeVisible();
    await expect(search).toHaveValue('진혼');
    expect(page.url()).toBe(home);
  };

  await page.getByRole('button', { name: '덱' }).click();
  await page.getByRole('tab', { name: '기프트' }).click();
  await search.fill('진혼');

  // The device back.
  await items.getByRole('button', { name: '모두 보기' }).click();
  await expect(browser).toBeVisible();
  await expect(items).toBeHidden();
  expect(page.url()).toBe(home);
  await back(2);
  await expectOnItems();

  // The page's own ←, which hands focus back to the >> it came from.
  await items.getByRole('button', { name: '모두 보기' }).click();
  await browser.getByRole('button', { name: '뒤로' }).click();
  await expectOnItems();
  await expect(items.getByRole('button', { name: '모두 보기' })).toBeFocused();

  // A gift sheet opened from the browser: one back closes the sheet, the next the browser.
  await items.getByRole('button', { name: '모두 보기' }).click();
  // The browser opens on 「추천 기프트」 (M121); the gift is on the all-gifts tab.
  await browser.getByRole('tab', { name: '모든 기프트' }).click();
  await browser.getByRole('button', { name: '진혼 자세히' }).first().click();
  await expect(page.getByTestId('gift-detail')).toBeVisible();
  await back(3);
  await expect(page.getByTestId('gift-detail')).toHaveCount(0);
  await expect(browser).toBeVisible();
  await back(2);
  await expectOnItems();

  // The sheet closed by its own button, then the browser by ←.
  await items.getByRole('button', { name: '모두 보기' }).click();
  // The browser opens on 「추천 기프트」 (M121); the gift is on the all-gifts tab.
  await browser.getByRole('tab', { name: '모든 기프트' }).click();
  await browser.getByRole('button', { name: '진혼 자세히' }).first().click();
  await page.getByTestId('block-sheet').getByRole('button', { name: '닫기' }).click();
  await browser.getByRole('button', { name: '뒤로' }).click();
  await expectOnItems();

  // The next back is the items page's own, and the app is still there after it.
  await back(1);
  await expect(items).toHaveCount(0);
  await expect(page.getByTestId('stage-floor')).toBeVisible();
  expect(page.url()).toBe(home);
});

test('the route page hands its entry to the items page it opens, so one back closes that page in the app', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByTestId('stage-floor')).toBeVisible();
  const home = page.url();
  await page.getByRole('button', { name: '전체 루트' }).click();
  await page.getByTestId('route-empty').getByRole('button', { name: '기프트' }).click();
  await expect(page.getByTestId('page-left')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (history.state as { layer?: number } | null)?.layer ?? 0))
    .toBe(1);
  await page.goBack();
  await expect(page.getByTestId('page-left')).toHaveCount(0);
  await expect(page.getByTestId('stage-floor')).toBeVisible();
  expect(page.url()).toBe(home);
});
