import { expect, test } from './lib/test.ts';
import { shareHash } from './share.ts';

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

/**
 * The run start in the overlay (M138): the window lists the start gifts and observations the plan
 * expects, all on. A press in the PiP window reaches React (it listens on the portal's container):
 * turning one off and confirming records only the rest, settles and closes the start, and
 * 「다시 고르기」 opens it again.
 */
test('confirms the run start from the overlay window, recording only what is left on', async ({
  page,
  context,
}) => {
  await page.goto(`./${shareHash([9191, 9809], 8)}`);
  await page.getByTestId('capture-open').click();
  if (!(await page.evaluate(() => 'documentPictureInPicture' in window))) test.skip();
  const [pip] = await Promise.all([context.waitForEvent('page'), page.getByTestId('overlay-toggle').click()]);

  const section = pip.getByTestId('overlay-start');
  await expect(section).toBeVisible();
  const rows = section.getByTestId('overlay-start-gift');
  const ids = (await rows.evaluateAll((all) =>
    all.map((row) => Number(row.getAttribute('data-gift'))),
  )) as number[];
  expect(ids.length).toBeGreaterThan(0);
  for (const row of await rows.all()) await expect(row).toHaveAttribute('aria-pressed', 'true');

  // The last one did not come.
  const dropped = ids[ids.length - 1]!;
  await rows.last().click();
  await expect(rows.last()).toHaveAttribute('aria-pressed', 'false');
  await section.getByTestId('overlay-start-confirm').click();

  const saved = () =>
    page.evaluate((all) => {
      const state = JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state ?? {};
      return {
        status: all.map((id) => state.run?.giftStatus?.[id] ?? null),
        startDone: state.run?.startDone ?? false,
      };
    }, ids);
  await expect
    .poll(saved)
    .toEqual({ status: ids.map((id) => (id === dropped ? null : 'got')), startDone: true });
  await expect(section).toHaveCount(0);
  await expect(pip.getByTestId('overlay-start-done')).toContainText(`획득 ${ids.length - 1}`);

  // 「다시 고르기」 opens the start again; what was collected stays collected (M140).
  await pip.getByTestId('overlay-start-reopen').click();
  await expect
    .poll(saved)
    .toEqual({ status: ids.map((id) => (id === dropped ? null : 'got')), startDone: false });
  await expect(pip.getByTestId('overlay-start')).toBeVisible();
});
