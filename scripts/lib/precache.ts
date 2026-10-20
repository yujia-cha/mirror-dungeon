/**
 * The precache list for `public/sw.js`, written into the built copy by the `precache` plugin in
 * `vite.config.ts` (M55).
 *
 * Why: the service worker takes control only *after* the first load, so everything that load
 * fetched — the page, its scripts, `data/index.json` — went around it and was never cached, and an
 * offline open failed after one online visit. Precaching the shell at install closes that.
 *
 * What goes in is what opening the app needs, and nothing that would make a first visit heavy:
 * - the page (`./`), every script and stylesheet under `assets/`, the icons and the web manifest;
 * - the shared data and the **default season's** data (another season is a choice made online);
 * - the art manifest, but not the drawings — they are decoration, cached as they are seen.
 * - Not the 92 font subsets (3 MB): the browser fetches the few a page needs and the runtime cache
 *   keeps those; offline, a missing subset falls back to a system font, never to a broken page.
 *
 * Paths are relative to the worker's own URL, which is the app's base, so the list is the same
 * under `/` and under the Pages sub-path.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SHELL_FILES = ['favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest'];
const SHARED_DATA = ['data/index.json', 'data/enums.json', 'data/identities.json'];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function precacheList(outDir: string): string[] {
  const rel = (path: string): string => relative(outDir, path).split(sep).join('/');
  const assets = walk(join(outDir, 'assets'))
    .filter((path) => /\.(js|css)$/.test(path))
    .map(rel);
  const index = JSON.parse(readFileSync(join(outDir, 'data/index.json'), 'utf8')) as { default: number };
  const season = walk(join(outDir, `data/md${index.default}`))
    .filter((path) => path.endsWith('.json'))
    .map(rel);
  const present = (path: string): boolean => existsSync(join(outDir, path));
  return [
    './',
    ...[...SHELL_FILES, ...SHARED_DATA, 'art/manifest.json'].filter(present),
    ...assets.sort(),
    ...season.sort(),
  ];
}

/**
 * A hash of the data files' content (M160): the shared JSON at `data/` (`index.json`,
 * `enums.json`, `identities.json`, `capture-layout.json`, …) and every season's `meta.json` — whose
 * `dataVersion` already fingerprints that season's files. The worker's cache is named after this
 * with the list, so a deploy that changed only the data still drops the old cache on activation;
 * before, the version hashed file *names* only, and `data/md8/gifts.json` kept its name while its
 * content moved. Deterministic: paths sorted, the same bytes giving the same hash.
 */
export function dataFingerprint(outDir: string): string {
  const data = join(outDir, 'data');
  if (!existsSync(data)) return '';
  const rel = (path: string): string => relative(outDir, path).split(sep).join('/');
  const files = walk(data)
    .filter((path) => {
      const name = rel(path);
      return /^data\/[^/]+\.json$/.test(name) || /^data\/md\d+\/meta\.json$/.test(name);
    })
    .map(rel)
    .sort();
  const hash = createHash('sha256');
  for (const name of files) {
    hash.update(name);
    hash.update('\0');
    hash.update(readFileSync(join(outDir, name)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const LIST_MARKER = 'const PRECACHE = [];';
const VERSION_MARKER = "const VERSION = 'dev';";

/**
 * Put the list and a version derived from it — and from `fingerprint`, the data files' content —
 * into the worker's source. The version names the cache, so a deploy that changes any file name or
 * any data file gets a fresh cache and the old one is dropped on activation. A missing marker
 * throws: a build that silently shipped an empty list would bring back exactly the bug this exists
 * to fix.
 */
export function injectPrecache(source: string, list: string[], fingerprint = ''): string {
  if (!source.includes(LIST_MARKER) || !source.includes(VERSION_MARKER)) {
    throw new Error(
      "sw.js: precache markers not found — `const PRECACHE = [];` and `const VERSION = 'dev';` must stay verbatim",
    );
  }
  const version = createHash('sha256')
    .update(list.join('\n'))
    .update('\n')
    .update(fingerprint)
    .digest('hex')
    .slice(0, 12);
  return source
    .replace(LIST_MARKER, `const PRECACHE = ${JSON.stringify(list)};`)
    .replace(VERSION_MARKER, `const VERSION = '${version}';`);
}
