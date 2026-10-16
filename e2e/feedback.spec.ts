/**
 * M127: 「피드백 보내기」 in a real browser — the form opens a prefilled GitHub issue (window.open
 * is stubbed, so nothing reaches github.com), and 「앱 화면을 클립보드에 복사」 draws the app to a
 * PNG without a single request off the page's origin.
 */
import { expect, test } from '@playwright/test';

test('opens a prefilled issue on the public repo with the message and the plan', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.goto('./');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByTestId('header-menu').getByRole('button', { name: '피드백 보내기' }).click();
  const sheet = page.getByRole('dialog', { name: '피드백 보내기' });
  await expect(sheet.getByTestId('feedback-privacy')).toContainText('이슈는 공개됩니다');
  await sheet.getByLabel('내용').fill('노선도가 6층에서 끊겨 보입니다');
  await sheet.getByRole('button', { name: 'GitHub에서 이슈 열기' }).click();
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  const url = new URL(opened[0]!);
  expect(`${url.origin}${url.pathname}`).toBe('https://github.com/yujia-cha/mirror-dungeon/issues/new');
  expect(opened[0]!.length).toBeLessThanOrEqual(8000);
  const body = url.searchParams.get('body')!;
  expect(body).toContain('노선도가 6층에서 끊겨 보입니다');
  expect(body).toContain('/mirror-dungeon/#s=');
  expect(body).toContain('```md-feedback');
});

test('draws the app screen to a PNG on the clipboard without leaving the origin', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const offOrigin: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) offOrigin.push(url);
  });
  await page.goto('./');
  await expect(page.getByTestId('run-stage')).toBeVisible();
  await page.getByRole('button', { name: '더 보기' }).click();
  await page.getByTestId('header-menu').getByRole('button', { name: '피드백 보내기' }).click();
  const sheet = page.getByRole('dialog', { name: '피드백 보내기' });
  await sheet.getByRole('button', { name: '앱 화면을 클립보드에 복사' }).click();
  await expect(sheet.getByTestId('feedback-status')).toContainText('앱 화면을 복사했습니다', {
    // Well under the library's 30 s wait: a lazy picture off screen used to hold it that long.
    timeout: 10_000,
  });
  const png = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]!.getType('image/png');
    const bitmap = await createImageBitmap(blob);
    return { size: blob.size, width: bitmap.width, height: bitmap.height };
  });
  expect(png.size).toBeGreaterThan(10_000);
  expect(png.width).toBeGreaterThan(500);
  expect(png.height).toBeGreaterThan(300);
  expect(offOrigin).toEqual([]);
});
