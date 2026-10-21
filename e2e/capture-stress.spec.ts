import { type Page } from '@playwright/test';
import { expect, test } from './lib/test.ts';

/**
 * The screen reader on a slow machine with a poor share (M142): Chromium's CPU throttled four
 * times over (DevTools Protocol `Emulation.setCPUThrottlingRate`), and the shared window a canvas
 * whose frames the page pushes by hand (`captureStream(0)` + `requestFrame`) at an irregular
 * 4.5–12 frames a second — never the rate the session asks for. Popups are clicked through over a
 * map, drawn text in the layout's regions (no game image), and the real OCR reads them. Every one
 * must be recorded.
 *
 * Desktop project only (`playwright.config.ts`). Each popup stands 700 ms, so every one is on at
 * least two frames; what this pins is that slow reads and a share that does not keep time lose
 * nothing — the backlog, fast ticks and the load ladder at work in a real browser.
 */
const W = 1920;
const H = 1009;

type Region = [number, number, number, number];
type Item = { text: string; region: Region; size: number };
/** One screen of the sequence and how long it stays, ms. */
type Step = { items: Item[]; ms: number };

const MAP: Item[] = [
  { text: '1층 탐사 중', region: [0.01, 0.13, 0.17, 0.045], size: 34 },
  { text: '헬스치킨', region: [0.01, 0.175, 0.17, 0.045], size: 34 },
];
const popup = (name: string): Item[] => [
  { text: 'E.G.O 기프트를 획득했습니다.', region: [0.333, 0.205, 0.34, 0.07], size: 40 },
  { text: name, region: [0.2526, 0.56, 0.138, 0.1338], size: 30 },
];
const GIFTS = ['커피와 종이학', '장미 면류관', '내일의 운세', '야간투시경', '복주머니'];

/** A share the page paints and pushes frames of by hand, irregularly. */
async function handPushedShare(page: Page): Promise<void> {
  await page.addInitScript(
    ({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      let items: Item[] = [];
      const draw = () => {
        ctx.fillStyle = '#16120f';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#f4efe6';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        for (const { text, region, size } of items) {
          const [x, y, w, h] = region;
          ctx.font = `700 ${size}px Pretendard`;
          ctx.fillText(text, (x + w / 2) * width, (y + h / 2) * height);
        }
      };
      // A deterministic, irregular frame clock: 80–220 ms between frames.
      let seed = 42;
      const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return 80 + (seed % 141);
      };
      let frames = 0;
      const pump = () => {
        draw();
        track.requestFrame();
        frames += 1;
        setTimeout(pump, next());
      };
      pump();
      const api = {
        /** Load the glyphs first, so painting a step is synchronous. */
        fonts: (texts: string[]) =>
          Promise.all(texts.map((t) => document.fonts.load(`700 40px Pretendard`, t))),
        show: (next: Item[]) => {
          items = next;
        },
        /** Play steps back to back on the page's clock. */
        play: async (steps: Step[]) => {
          for (const step of steps) {
            items = step.items;
            await new Promise((resolve) => setTimeout(resolve, step.ms));
          }
        },
        frames: () => frames,
      };
      (window as unknown as { __share: typeof api }).__share = api;
      navigator.mediaDevices.getDisplayMedia = async () => stream;
    },
    { width: W, height: H },
  );
}

test('records every popup of a click-through on a 4× slower CPU with an irregular share (M142)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await handPushedShare(page);
  await page.goto('./');
  await page.evaluate(
    (texts) =>
      (window as unknown as { __share: { fonts: (t: string[]) => Promise<unknown> } }).__share.fonts(texts),
    [...GIFTS, 'E.G.O 기프트를 획득했습니다.', '1층 탐사 중', '헬스치킨'],
  );
  await page.getByTestId('capture-open').click();
  const panel = page.getByTestId('capture-panel');
  await panel.getByTestId('capture-start').click();
  await expect(panel.getByTestId('capture-status')).toHaveAttribute('data-status', 'running', {
    timeout: 60_000,
  });

  // The slow machine, from here on.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // The map first, so the run has its entry, then the popups clicked through with blinks of map.
  const steps: Step[] = [{ items: MAP, ms: 4000 }];
  for (const name of GIFTS) steps.push({ items: popup(name), ms: 700 }, { items: MAP, ms: 300 });
  steps.push({ items: MAP, ms: 3000 });
  await page.evaluate(
    (all) => (window as unknown as { __share: { play: (s: Step[]) => Promise<void> } }).__share.play(all),
    steps,
  );

  const log = panel.getByTestId('capture-log');
  await expect(log).toContainText('1층 입장 · 헬스치킨', { timeout: 60_000 });
  for (const name of GIFTS) await expect(log).toContainText(`획득 · ${name}`, { timeout: 60_000 });
  // Each recorded once.
  for (const name of GIFTS) await expect(log.locator('li', { hasText: `획득 · ${name}` })).toHaveCount(1);
  // The share really was poor: far fewer frames than the 30 a second the reader asks for in a burst.
  const frames = await page.evaluate(() =>
    (window as unknown as { __share: { frames: () => number } }).__share.frames(),
  );
  expect(frames).toBeLessThan(15 * 20);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await panel.getByTestId('capture-stop').click();
});
