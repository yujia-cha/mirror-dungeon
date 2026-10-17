/**
 * What the screen reader costs the page in a real browser, per read interval (M108).
 *
 *   npm run capture:bench:browser -- --url http://localhost:4173/mirror-dungeon/
 *   npm run capture:bench:browser -- --url … --shots 30 --dwell 1000
 *
 * `capture:bench` replays the loop on a simulated clock with Node's OCR. This is the other half:
 * the app itself, in Chromium, with the share replaced by a canvas that shows the local shots one
 * after another (the gitignored `local-fixtures/capture/`, never committed). For each preset, and
 * once with the reader off as the baseline, it measures over the same sequence:
 *
 * - main-thread time — Chrome's own `TaskDuration` (DevTools protocol), as a share of wall time;
 * - long tasks (over 50ms) — count and total, from a `PerformanceObserver`;
 * - what the run recorded — entries and gifts marked got, from the saved run.
 *
 * OCR runs in Tesseract's own worker, which is not the page's thread: its cost shows in
 * `capture:bench`, not here. Drawing the shots onto the canvas is the same in every row, the
 * baseline included.
 *
 * Needs a running app (`npm run build && VITE_BASE=/mirror-dungeon/ npx vite preview`, or `npm run
 * dev`). Chromium comes from `PW_CHROMIUM` when it is set.
 *
 * Flags: --url (required), --dir (default local-fixtures/capture), --shots (default 30, from the
 *        start), --dwell (ms per shot, default 1000).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { READ_INTERVALS, type ReadIntervalPreset } from '../src/app/capture/loop.ts';
import { flagValue } from './lib/io.ts';

const url = flagValue('--url');
if (!url) {
  console.error('capture-bench-browser: --url is required (a running app)');
  process.exit(1);
}
const dir = resolve(flagValue('--dir') ?? 'local-fixtures/capture');
const shotCount = Number(flagValue('--shots') ?? 30);
const dwellMs = Number(flagValue('--dwell') ?? 1000);
const files = readdirSync(dir)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .sort()
  .slice(0, shotCount);
const shots = files.map(
  (f) =>
    `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(resolve(dir, f)).toString('base64')}`,
);

interface Row {
  label: string;
  mainPct: number;
  longTasks: number;
  longMs: number;
  entries: number;
  got: number;
}

/** The share is a canvas the test fills; `__load` decodes the shots, `__show(i)` puts one up. */
async function fakeShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1009;
    const ctx = canvas.getContext('2d')!;
    let bitmaps: ImageBitmap[] = [];
    const w = window as unknown as Record<string, unknown>;
    w.__load = async (urls: string[]) => {
      bitmaps = await Promise.all(urls.map(async (u) => createImageBitmap(await (await fetch(u)).blob())));
    };
    w.__show = (i: number) => ctx.drawImage(bitmaps[i]!, 0, 0, canvas.width, canvas.height);
    w.__long = { count: 0, ms: 0 };
    new PerformanceObserver((list) => {
      const long = w.__long as { count: number; ms: number };
      for (const entry of list.getEntries()) {
        long.count += 1;
        long.ms += entry.duration;
      }
    }).observe({ type: 'longtask', buffered: false });
    navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(8);
  });
}

async function measure(preset: ReadIntervalPreset | null): Promise<Row> {
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  );
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await fakeShare(page);
    await page.goto(url!);
    await page.evaluate(
      (urls) => (window as unknown as { __load: (u: string[]) => Promise<void> }).__load(urls),
      shots,
    );
    await page.evaluate(() => (window as unknown as { __show: (i: number) => void }).__show(0));
    if (preset) {
      // The controls live in the header's popover since M111.
      await page.getByTestId('capture-open').click();
      await page.getByTestId('capture-interval').selectOption(preset);
      await page.getByTestId('capture-start').click();
      // A run left by an earlier preset asks first (M143): each measure reads a fresh run.
      await page
        .getByRole('button', { name: '새 런으로 시작' })
        .click({ timeout: 1000 })
        .catch(() => undefined);
      await page
        .locator('[data-testid="capture-status"][data-status="running"]')
        .waitFor({ timeout: 60_000 });
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async (name: string) =>
      ((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
    await page.evaluate(() => {
      (window as unknown as { __long: { count: number; ms: number } }).__long = { count: 0, ms: 0 };
    });
    const startTask = await metric('TaskDuration');
    const started = Date.now();
    for (let i = 0; i < shots.length; i++) {
      await page.evaluate((n) => (window as unknown as { __show: (i: number) => void }).__show(n), i);
      await page.waitForTimeout(dwellMs);
    }
    const wall = Date.now() - started;
    const task = (await metric('TaskDuration')) - startTask;
    const long = await page.evaluate(
      () => (window as unknown as { __long: { count: number; ms: number } }).__long,
    );
    const run = await page.evaluate(
      () => JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state?.run ?? {},
    );
    return {
      label: preset ? `${preset} (${READ_INTERVALS[preset]}ms)` : 'off',
      mainPct: (100 * task) / wall,
      longTasks: long.count,
      longMs: long.ms,
      entries: Object.keys(run.visits ?? {}).length,
      got: Object.values(run.giftStatus ?? {}).filter((s) => s === 'got').length,
    };
  } finally {
    await browser.close();
  }
}

const rows: Row[] = [];
for (const preset of [null, ...(Object.keys(READ_INTERVALS) as ReadIntervalPreset[])]) {
  process.stderr.write(`measuring ${preset ?? 'off'}…\n`);
  rows.push(await measure(preset));
}
console.log(`# capture:bench:browser — ${shots.length} shots × ${dwellMs}ms`);
console.log('');
console.log('| reader | main thread | long tasks | long-task time | entries | gifts got |');
console.log('|---|---|---|---|---|---|');
for (const r of rows)
  console.log(
    `| ${r.label} | ${r.mainPct.toFixed(1)}% | ${r.longTasks} | ${Math.round(r.longMs)}ms | ${r.entries} | ${r.got} |`,
  );
