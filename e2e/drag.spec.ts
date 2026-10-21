import { type Locator } from '@playwright/test';
import { expect, test } from './lib/test.ts';
import { shareHash } from './share.ts';

/**
 * Drags that start on a picture (M111 follow-up). A browser starts its own drag of an `<img>` on a
 * press and move, which takes the pointer away from the app's gestures: pulling a pack card by its
 * art, or picking a goal tile up by its icon, did nothing. These start exactly on the picture.
 */
async function centreOf(selector: Locator) {
  await selector.scrollIntoViewIfNeeded();
  const box = (await selector.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('pulling a pack card down by its art enters the pack', async ({ page }) => {
  // More floor-1-only pack goals than three observations can cover: floor 1 gets a route pack.
  await page.goto(`./${shareHash([9403, 9404, 9413, 9414, 9431, 9432])}`);
  const art = page.getByTestId('stage-pack').first().locator('[data-testid="pack-image"] img');
  await expect(art).toBeVisible();
  const { x, y } = await centreOf(art);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y + step * 12);
  await page.mouse.up();
  await expect(page.getByTestId('entered-pack')).toBeVisible();
});

test('dragging a goal tile by its icon onto an observation slot pins it', async ({ page }) => {
  await page.goto(`./${shareHash([9222])}`);
  const icon = page.getByTestId('gift-chip').first().locator('img').first();
  await expect(icon).toBeVisible();
  const start = await centreOf(icon);
  const end = await centreOf(page.getByTestId('observe-slot').first());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1)
    await page.mouse.move(start.x + ((end.x - start.x) * i) / 10, start.y + ((end.y - start.y) * i) / 10);
  await page.mouse.up();
  await expect(page.getByTestId('observe-slot').first()).toHaveAttribute('data-gift', '9222');
});
