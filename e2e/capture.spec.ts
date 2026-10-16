import { expect, test, type Page } from '@playwright/test';

/**
 * The screen reader end to end (M107): the shared window is a canvas the test paints — drawn text in
 * the layout's regions, never a game image — so the real OCR engine, the change detection and the
 * tracker all run on it in a real browser, and the run records what it read.
 *
 * Coordinates are the layout's fractions of the 1920×1009 reference (`capture-layout.json`).
 */
const W = 1920;
const H = 1009;

type Paint = { text: string; region: [number, number, number, number]; size: number }[];

/** Replace the share with a canvas the page can repaint through `window.__paint`. */
async function fakeShare(page: Page): Promise<void> {
  await page.addInitScript(
    ({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const paint = async (items: Paint) => {
        // Pretendard ships split by unicode-range: load the subsets these glyphs live in first.
        await Promise.all(items.map((i) => document.fonts.load(`700 ${i.size}px Pretendard`, i.text)));
        ctx.fillStyle = '#16120f';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#f4efe6';
        ctx.textBaseline = 'middle';
        for (const { text, region, size } of items) {
          const [x, y, w, h] = region;
          ctx.font = `700 ${size}px Pretendard`;
          ctx.textAlign = 'center';
          ctx.fillText(text, (x + w / 2) * width, (y + h / 2) * height);
        }
      };
      (window as unknown as { __paint: typeof paint }).__paint = paint;
      void paint([]);
      navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(8);
    },
    { width: W, height: H },
  );
}

const paint = (page: Page, items: Paint) =>
  page.evaluate((all) => (window as unknown as { __paint: (p: Paint) => Promise<void> }).__paint(all), items);

test('reads an entry and a gift off the shared window, and takes them back', async ({ page }) => {
  test.setTimeout(90_000);
  await fakeShare(page);
  await page.goto('./');
  const panel = page.getByTestId('capture-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('capture-start').click();
  const status = panel.getByTestId('capture-status');
  // The OCR engine loads from our own origin; the models are a few MB.
  await expect(status).toHaveAttribute('data-status', 'running', { timeout: 45_000 });

  // The map header: 「1층 탐사 중」 over the pack's name.
  await paint(page, [
    { text: '1층 탐사 중', region: [0.01, 0.13, 0.17, 0.045], size: 34 },
    { text: '헬스치킨', region: [0.01, 0.175, 0.17, 0.045], size: 34 },
  ]);
  const log = panel.getByTestId('capture-log');
  await expect(log).toContainText('1층 입장 · 헬스치킨', { timeout: 20_000 });
  await expect(page.getByTestId('entered-pack')).toBeVisible();

  // An acquired popup: the banner title and the gift's name on its button.
  await paint(page, [
    { text: 'E.G.O 기프트를 획득했습니다.', region: [0.333, 0.205, 0.34, 0.07], size: 40 },
    { text: '커피와 종이학', region: [0.2526, 0.56, 0.138, 0.1338], size: 30 },
  ]);
  await expect(log).toContainText('획득 · 커피와 종이학', { timeout: 20_000 });
  const got = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state?.run?.giftStatus?.['9006'] ?? null,
    );
  await expect.poll(got).toBe('got');

  // Undo takes the gift back out of the run.
  await log.locator('li', { hasText: '커피와 종이학' }).getByRole('button', { name: '되돌리기' }).click();
  await expect.poll(got).toBe(null);
  await expect(log.locator('li', { hasText: '커피와 종이학' })).toContainText('되돌림');

  await panel.getByTestId('capture-stop').click();
  await expect(status).toHaveAttribute('data-status', 'idle');
});
