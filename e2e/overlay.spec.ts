import { expect, test } from '@playwright/test';

/**
 * The overlay window (M132): Document Picture-in-Picture opened from the 「화면 인식」 popover. The
 * container's Chromium has the API on a secure origin (localhost is one) and Playwright sees the
 * window as a new page; a browser without it must draw no button at all.
 */
test('opens the overlay window from the screen reader popover and mirrors the page into it', async ({
  page,
  context,
}) => {
  await page.goto('./');
  await page.getByTestId('capture-open').click();
  await expect(page.getByTestId('capture-panel')).toBeVisible();
  const toggle = page.getByTestId('overlay-toggle');
  const hasApi = await page.evaluate(() => 'documentPictureInPicture' in window);
  if (!hasApi) {
    await expect(toggle).toHaveCount(0);
    return;
  }

  // No share needed: the window opens with the reader off.
  await expect(toggle).toHaveText('오버레이 창 열기');
  const [pip] = await Promise.all([context.waitForEvent('page'), toggle.click()]);
  const overlay = pip.getByTestId('overlay');
  await expect(overlay).toBeVisible();
  await expect(pip.getByTestId('overlay-status')).toHaveText('화면 인식 꺼짐');
  await expect(pip.getByTestId('overlay-floor')).toContainText('1');
  await expect(pip.getByTestId('overlay-next')).toBeVisible();
  await expect(pip.getByTestId('overlay-remaining')).toContainText('아직 입장한 팩이 없습니다');
  await expect(pip.getByTestId('overlay-recent')).toBeVisible();
  expect(await pip.title()).toBe('거울 던전 오버레이');
  // The page's look came along: its stylesheet paints the window's body with the same ground.
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await pip.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(ground);

  // The popover closing does not close the window.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('capture-panel')).toHaveCount(0);
  await expect(overlay).toBeVisible();

  // The largest text size follows into the window and still fits its width.
  await page.evaluate(() => document.documentElement.setAttribute('data-text-scale', 'xl'));
  await expect(pip.locator('html')).toHaveAttribute('data-text-scale', 'xl');
  const fits = await pip.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);

  // A step on the stage shows up in the window: skipping floor 1 moves the floor and logs it.
  await page.getByRole('button', { name: '다음 층' }).first().click();
  await expect(pip.getByTestId('overlay-floor')).toContainText('2');
  await expect(pip.getByTestId('overlay-recent').getByRole('listitem').first()).toBeVisible();

  // Closing from the popover closes the window.
  await page.getByTestId('capture-open').click();
  await page.getByTestId('overlay-toggle').click();
  await expect(page.getByTestId('overlay-toggle')).toHaveText('오버레이 창 열기');
  await expect.poll(() => pip.isClosed()).toBe(true);
});
