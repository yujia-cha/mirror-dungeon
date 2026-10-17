/**
 * `<link rel="preload">` tags for the data the app fetches on every open (M58).
 *
 * Without them the order is: HTML → the app's JavaScript (~500 kB with vendors) → parse and run →
 * `data/index.json` → the season's files. The data waits for the whole bundle. The build already
 * knows the default season, so the HTML can ask for all of it at once, in parallel with the scripts.
 *
 * `as="fetch"` with `crossorigin` is what makes the browser hand the preloaded response to the
 * app's `fetch()` (a same-origin fetch runs in CORS mode with same-origin credentials, which is what
 * `crossorigin="anonymous"` means for a same-origin URL). Without the attribute the preload is
 * fetched twice and Chrome warns that it was unused. Relative URLs, like every other link in
 * `index.html`, so they resolve under the Pages sub-path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `skill-gifts` (M129) is optional for a frozen season, so it is preloaded only when it is there.
const SEASON_FILES = ['meta', 'rules', 'gifts', 'packs'];
const OPTIONAL_SEASON_FILES = ['skill-gifts'];
const SHARED_FILES = ['enums', 'identities'];

export function dataPreloadPaths(dataDir: string): string[] {
  const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8')) as { default: number };
  return [
    'data/index.json',
    ...SEASON_FILES.map((name) => `data/md${index.default}/${name}.json`),
    ...OPTIONAL_SEASON_FILES.map((name) => `data/md${index.default}/${name}.json`).filter((path) =>
      existsSync(join(dataDir, '..', path)),
    ),
    ...SHARED_FILES.map((name) => `data/${name}.json`),
  ];
}

export function preloadTags(paths: string[]): string {
  return paths
    .map((path) => `<link rel="preload" href="./${path}" as="fetch" crossorigin="anonymous" />`)
    .join('\n    ');
}
