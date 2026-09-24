import { expect, test } from '@playwright/test';

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
