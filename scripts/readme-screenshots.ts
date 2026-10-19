/**
 * App screenshots and the example share link, taken from a running copy of the app — raw material
 * for the guide's and the README's pictures.
 *
 *   npm run dev                                   (in another shell)
 *   npm run shots -- --url http://localhost:5173/
 *
 * Flags: --url (the app, default http://localhost:5173/), --out (default local-fixtures/shots),
 *        --dry (print the example link and stop).
 *
 * Since M157 the pictures in `public/guide/` are the owner's own captures of the app, put there by
 * hand and named by the 「# 안내」 cards of `docs/copy.md`. So this writes elsewhere by default
 * (gitignored): a picture worth keeping is copied into `public/guide/` and given a `- 그림:` line —
 * the copy generator warns about any file there that no card uses. The shots are WebP, encoded by
 * the same Chromium (canvas `toBlob('image/webp')`), so no image codec is added.
 *
 * The example is one plan — a burn deck and six goals: a two-level fusion (진혼) and five gifts
 * that only a theme pack gives — so the pictures and the link show the same route. It is opened
 * through a share link rather than clicked together, which makes the shots repeatable after any
 * UI change. These are app screens only: the game images they show are the gift and keyword
 * icons and pack art the owner already allowed (M92/M99/M100); a game-client screen never goes
 * in the guide. Chromium comes from `PW_CHROMIUM` when it is set (this container's is at
 * `/opt/pw-browsers/chromium`).
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { appDefaultOptions, encodeShared, PERSIST_VERSION } from '../src/app/store.ts';
import { flagValue, hasFlag } from './lib/io.ts';

const SITE = 'https://yujia-cha.github.io/mirror-dungeon/';
/** 화상 덱 — the same twelve the app's tests call `BURN_DECK`, the first seven deployed. */
const DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
/** 진혼 (fusion) · 달궈진 놋쇠 · 붉은색 넥타이 · 뜨거운 육즙 다리살 · 부화하지 않은 불씨 · 점화 장갑. */
const WANTED = [9088, 9267, 9215, 9701, 9756, 9772];
/** How far the desktop shots walk the run: to the first floor the route enters a pack on. */
const SKIP_TO_FLOOR = 6;

const index = JSON.parse(readFileSync('public/data/index.json', 'utf8')) as { default: number };
const hash = encodeShared({
  season: index.default,
  deck: DECK,
  deployed: DECK.slice(0, 7),
  wanted: WANTED,
  fusionGoal: {},
  options: appDefaultOptions(),
});
console.log(`example link: ${SITE}${hash}`);
if (hasFlag('--dry')) process.exit(0);

const url = (flagValue('--url') ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const out = flagValue('--out') ?? join('local-fixtures', 'shots');
/** WebP quality: screenshots of flat UI stay sharp at 0.8 and land well under the 300 KB limit. */
const QUALITY = 0.8;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

async function open(
  viewport: { width: number; height: number },
  dark: boolean,
  mobile: boolean,
): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    colorScheme: dark ? 'dark' : 'light',
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  const page = await context.newPage();
  // A first visit is always dark (M122), so the light pictures come from a saved choice, as a
  // returning player's 「테마 변경」 would leave it.
  await page.addInitScript(
    ({ isDark, version }) => {
      window.localStorage.setItem('md-route-planner', JSON.stringify({ state: { dark: isDark }, version }));
    },
    { isDark: dark, version: PERSIST_VERSION },
  );
  await page.goto(url + hash);
  await page.getByTestId('floor-strip').waitFor();
  return page;
}

/** Screenshot the page and write it as WebP, re-encoded through a canvas in the same page. */
async function shoot(page: Page, name: string): Promise<void> {
  const png = await page.screenshot();
  const webp = await page.evaluate(
    async ({ data, quality }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', quality));
      if (!blob) throw new Error('this browser cannot encode WebP');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const b of bytes) text += String.fromCharCode(b);
      return btoa(text);
    },
    { data: png.toString('base64'), quality: QUALITY },
  );
  const file = join(out, `${name}.webp`);
  writeFileSync(file, Buffer.from(webp, 'base64'));
  console.log(`wrote ${file} (${Math.round(statSync(file).size / 1024)} KB)`);
}

/** The route is on screen once its summary counts what it collects. */
async function routeReady(page: Page): Promise<void> {
  await page.getByText(/^획득/).first().waitFor();
}

/** Walk the stage forward by pressing 「다음 층」, as a player skipping the free floors would. */
async function skipTo(page: Page, floor: number): Promise<void> {
  for (let f = 1; f < floor; f++) {
    await page.getByRole('button', { name: '다음 층' }).last().click();
    await page
      .getByTestId('stage-floor')
      .filter({ hasText: String(f + 1) })
      .waitFor();
  }
}

for (const dark of [false, true]) {
  const page = await open({ width: 1440, height: 900 }, dark, false);
  await routeReady(page);
  await skipTo(page, SKIP_TO_FLOOR);
  await page.waitForTimeout(400);
  await shoot(page, `desktop-${dark ? 'dark' : 'light'}`);
  await page.context().close();
}

{
  // A phone opens on the stage; the route is the right-hand page.
  const page = await open({ width: 390, height: 844 }, false, true);
  await page.getByTestId('toggle-panel-right').click();
  await page.getByTestId('page-right').waitFor();
  await routeReady(page);
  await page.waitForTimeout(400);
  await shoot(page, 'mobile-route');
  await page.context().close();
}

await browser.close();
