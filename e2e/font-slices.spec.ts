/**
 * The gift grids fetch their Pretendard slices when they open, not while they scroll (M133).
 *
 * Its own file because tracing has to be off, and `trace` can only be set per file: a trace
 * snapshot serializes the whole DOM, which shapes every `content-visibility: auto` tile and fetches
 * every slice up front — with tracing on, this test could not fail.
 */
import { expect, test } from '@playwright/test';

test.use({ trace: 'off' });

test('scrolling 「모든 기프트」 to the end fetches no font slice — the grid asked for its glyphs when it opened (M133)', async ({
  page,
}) => {
  // Tiles are `content-visibility: auto`, so the browser shapes a name — and requests its
  // Pretendard `unicode-range` slice — only as the scroll brings it near. Each slice arriving
  // mid-scroll re-drew the text: the periodic flicker. The grid preloads its own text instead.
  const fonts: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.woff2')) fonts.push(request.url());
  });
  await page.goto('./');
  await page.getByRole('tab', { name: '기프트' }).click();
  await page.getByRole('button', { name: '모두 보기', exact: true }).click();
  const browser = page.getByTestId('gift-browser');
  await browser.getByRole('tab', { name: '모든 기프트' }).click();
  await expect(browser.getByTestId('gift-tile').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  const before = fonts.length;
  expect(before).toBeGreaterThan(0);
  const scroller = await browser.evaluateHandle((root) =>
    [root, ...root.querySelectorAll('*')].find(
      (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 50,
    ),
  );
  let atEnd = false;
  for (let step = 0; step < 400 && !atEnd; step++) {
    atEnd = await scroller.evaluate((el) => {
      if (!el) throw new Error('the browser has no scrolling grid');
      el.scrollBy(0, 300);
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  }
  expect(atEnd).toBe(true);
  await page.waitForLoadState('networkidle');
  expect(fonts.slice(before)).toEqual([]);
});
