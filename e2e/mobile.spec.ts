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
  await page.getByRole('tab', { name: '아이템' }).click();
  const chip = page.getByTestId('gift-chip').first();
  const slot = page.getByTestId('observe-slot').first();
  await chip.scrollIntoViewIfNeeded();
  const from = (await chip.boundingBox())!;
  const to = (await slot.boundingBox())!;
  const start = { x: from.x + 10, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });

  await touch('touchStart', start);
  await page.waitForTimeout(450);
  await expect(page.getByTestId('chip-ghost')).toBeVisible();
  for (let i = 1; i <= 8; i += 1) {
    await touch('touchMove', { x: start.x + ((end.x - start.x) * i) / 8, y: start.y + ((end.y - start.y) * i) / 8 });
  }
  await touch('touchEnd');

  await expect(page.getByTestId('chip-ghost')).toHaveCount(0);
  await expect(page.getByTestId('observe-slot').first()).toHaveAttribute('data-gift', '9222');
});
