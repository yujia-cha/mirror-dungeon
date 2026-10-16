/**
 * Before/after screenshots of the app's main states, for a person to compare (M128). The layout
 * audit in `npm run e2e` catches the geometry it knows how to name; this is for everything else a
 * UI change can move — a colour, a gap, a line that wraps differently.
 *
 *   npm run dev                                              (in another shell)
 *   npm run layout:shots -- --label before                   (before the change)
 *   npm run layout:shots -- --label after --compare before   (after it)
 *
 * The states are the audit's own (`e2e/lib/layout-states.ts`): a desktop (1280×800) and a phone
 * (390×844, touch), each at text size 보통 and 아주 크게. The PNGs land in
 * `local-fixtures/layout/<label>/` — gitignored, never committed: they show the game's gift icons
 * and pack art. With `--compare <baseline>` each picture is compared pixel by pixel with the
 * baseline's; the diff images (changed pixels in red over a faded copy) and `summary.md` go to
 * `local-fixtures/layout/<label>/diff-<baseline>/`, and the states that changed are listed, most
 * changed first, with the box the change sits in — those are the ones to look at. Two runs of the
 * same build draw identical pixels, so by default any change is listed; `--threshold` (a share of
 * the pixels, e.g. 0.001 = 0.1%) hides the smaller ones.
 *
 * Flags: --url (the app, default http://localhost:5173/), --label (default `now`),
 *        --compare <label>, --threshold <0..1>, --only <substring of a shot name>.
 * Chromium comes from `PW_CHROMIUM` when it is set (this container's is at `/opt/pw-browsers/chromium`).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  DEVICES,
  TEXT_SCALES,
  startWithTextScale,
  walkLayoutStates,
  type Device,
} from '../e2e/lib/layout-states.ts';
import { flagValue } from './lib/io.ts';

const url = (flagValue('--url') ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const label = flagValue('--label') ?? 'now';
const baseline = flagValue('--compare');
const threshold = Number(flagValue('--threshold') ?? '0');
const only = flagValue('--only');
const root = join('local-fixtures', 'layout');
const out = join(root, label);
if (!/^[\w.-]+$/.test(label)) throw new Error(`--label must be a plain name, got ${label}`);
if (baseline === label) throw new Error('--compare names the label being taken; pick another --label');
if (baseline !== undefined && !existsSync(join(root, baseline))) {
  throw new Error(`no baseline at ${join(root, baseline)} — take it first with --label ${baseline}`);
}

/** Wait until the fonts and every image on screen have arrived, so two runs draw the same pixels. */
async function settle(page: Page): Promise<void> {
  // No named function inside: tsx would wrap it in a `__name` helper the page does not have.
  await page.evaluate(async () => {
    await document.fonts.ready;
    const deadline = Date.now() + 3000;
    while (
      Date.now() < deadline &&
      [...document.images].some((img) => {
        const r = img.getBoundingClientRect();
        // `checkVisibility`: a lazy image in a closed <details> keeps a box but never loads.
        return r.bottom > 0 && r.top < innerHeight && r.width > 0 && !img.complete && img.checkVisibility();
      })
    ) {
      await new Promise((done) => setTimeout(done, 50));
    }
  });
  await page.waitForTimeout(250);
}

async function shoot(): Promise<void> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  );
  for (const device of ['desktop', 'phone'] as Device[]) {
    for (const { step } of TEXT_SCALES) {
      // No service worker: a cached build would photograph the old app after the change.
      const context = await browser.newContext({
        ...DEVICES[device],
        baseURL: url,
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await startWithTextScale(page, step);
      let index = 0;
      await walkLayoutStates(page, device, async (state) => {
        index += 1;
        const name = `${device}-${step}-${String(index).padStart(2, '0')}-${state.id}`;
        if (only && !name.includes(only)) return;
        await settle(page);
        await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled', caret: 'hide' });
        console.log(`shot ${name} — ${state.title}`);
      });
      await context.close();
    }
  }
  await browser.close();
}

/** Pixels differing by more than this in any channel count as changed (absorbs antialiasing noise). */
const CHANNEL_TOLERANCE = 24;

function compare(against: string): void {
  const before = join(root, against);
  const diffDir = join(out, `diff-${against}`);
  mkdirSync(diffDir, { recursive: true });
  const names = [...new Set([...readdirSync(before), ...readdirSync(out)])]
    .filter((name) => name.endsWith('.png'))
    .sort();
  const rows: Array<{ name: string; share: number; note: string }> = [];
  for (const name of names) {
    const a = join(before, name);
    const b = join(out, name);
    if (!existsSync(a) || !existsSync(b)) {
      rows.push({ name, share: 1, note: existsSync(a) ? 'missing now' : 'new state' });
      continue;
    }
    const pa = PNG.sync.read(readFileSync(a));
    const pb = PNG.sync.read(readFileSync(b));
    if (pa.width !== pb.width || pa.height !== pb.height) {
      rows.push({ name, share: 1, note: `size ${pa.width}×${pa.height} → ${pb.width}×${pb.height}` });
      continue;
    }
    const diff = new PNG({ width: pa.width, height: pa.height });
    let changed = 0;
    const box = { left: pa.width, top: pa.height, right: -1, bottom: -1 };
    for (let i = 0; i < pa.data.length; i += 4) {
      const delta = Math.max(
        Math.abs(pa.data[i]! - pb.data[i]!),
        Math.abs(pa.data[i + 1]! - pb.data[i + 1]!),
        Math.abs(pa.data[i + 2]! - pb.data[i + 2]!),
      );
      if (delta > CHANNEL_TOLERANCE) {
        changed += 1;
        const x = (i / 4) % pa.width;
        const y = Math.floor(i / 4 / pa.width);
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        box.right = Math.max(box.right, x);
        box.bottom = Math.max(box.bottom, y);
        diff.data.set([255, 0, 0, 255], i);
      } else {
        // The after picture, faded to grey, so the red reads against where it sits.
        const grey = Math.round((pb.data[i]! + pb.data[i + 1]! + pb.data[i + 2]!) / 3);
        const faded = Math.round(255 - (255 - grey) * 0.25);
        diff.data.set([faded, faded, faded, 255], i);
      }
    }
    const share = changed / (pa.width * pa.height);
    if (changed > 0) writeFileSync(join(diffDir, name), PNG.sync.write(diff));
    rows.push({
      name,
      share,
      note:
        changed > 0
          ? `${changed} px, within x ${box.left}–${box.right} · y ${box.top}–${box.bottom} (image px)`
          : '',
    });
  }
  rows.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  const over = rows.filter((row) => row.share > threshold);
  const percent = (share: number): string => `${(share * 100).toFixed(share > 0 && share < 0.0001 ? 4 : 2)}%`;
  const headline = `${over.length} of ${rows.length} states changed${threshold > 0 ? ` more than ${percent(threshold)} of their pixels` : ''}.`;
  const lines = [
    `# layout:shots — ${label} against ${against}`,
    '',
    headline,
    '',
    '| state | changed | where |',
    '|---|---:|---|',
    ...rows.map(
      (row) =>
        `| ${row.share > threshold ? `**${row.name}**` : row.name} | ${percent(row.share)} | ${row.note} |`,
    ),
    '',
  ];
  writeFileSync(join(diffDir, 'summary.md'), lines.join('\n'));
  console.log(`\n${headline}`);
  for (const row of over) console.log(`  ${row.name}  ${percent(row.share)}  ${row.note}`);
  console.log(`diff images and summary: ${diffDir}`);
}

await shoot();
if (baseline !== undefined) compare(baseline);
