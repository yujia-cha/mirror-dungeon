import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dataFingerprint, injectPrecache, precacheList } from './precache.ts';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function touch(path: string, body = ''): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

describe('precacheList', () => {
  it('takes the shell, the shared data and the default season, and leaves fonts and drawings', () => {
    dir = mkdtempSync(join(tmpdir(), 'precache-'));
    for (const file of [
      'index.html',
      'favicon.svg',
      'manifest.webmanifest',
      'sw.js',
      'og.png',
      'assets/index-AAAAAAAA.js',
      'assets/index-BBBBBBBB.css',
      'assets/planner.worker-CCCCCCCC.js',
      'assets/PretendardVariable.subset.0-DDDDDDDD.woff2',
      'data/enums.json',
      'data/identities.json',
      'data/md7/gifts.json',
      'data/md8/gifts.json',
      'art/manifest.json',
      'art/gifts/9088.png',
    ]) {
      touch(join(dir, file));
    }
    touch(join(dir, 'data/index.json'), JSON.stringify({ default: 7 }));

    expect(precacheList(dir)).toEqual([
      './',
      'favicon.svg',
      'manifest.webmanifest',
      'data/index.json',
      'data/enums.json',
      'data/identities.json',
      'art/manifest.json',
      'assets/index-AAAAAAAA.js',
      'assets/index-BBBBBBBB.css',
      'assets/planner.worker-CCCCCCCC.js',
      'data/md7/gifts.json',
    ]);
  });
});

describe('injectPrecache', () => {
  const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

  it('fills the real worker source, and the version follows the list', () => {
    const a = injectPrecache(source, ['./', 'assets/a-11111111.js']);
    const b = injectPrecache(source, ['./', 'assets/a-22222222.js']);
    expect(a).toContain('const PRECACHE = ["./","assets/a-11111111.js"];');
    expect(a).not.toContain("const VERSION = 'dev';");
    expect(a.match(/const VERSION = '([0-9a-f]+)'/)![1]).not.toBe(
      b.match(/const VERSION = '([0-9a-f]+)'/)![1],
    );
  });

  it('refuses a source whose markers were edited away', () => {
    expect(() => injectPrecache('const PRECACHE = ["x"];', [])).toThrow(/markers/);
  });
});

describe('dataFingerprint (M160, C9)', () => {
  /** A built output folder with the data files a deploy carries. */
  const built = (giftsBody: string, metaBody: string, layoutBody = '{}'): string => {
    const out = mkdtempSync(join(tmpdir(), 'precache-fp-'));
    touch(join(out, 'data/index.json'), JSON.stringify({ default: 8 }));
    touch(join(out, 'data/enums.json'), '{}');
    touch(join(out, 'data/capture-layout.json'), layoutBody);
    touch(join(out, 'data/md8/meta.json'), metaBody);
    touch(join(out, 'data/md8/gifts.json'), giftsBody);
    touch(join(out, 'assets/index-AAAAAAAA.js'), 'app');
    return out;
  };
  const cleanup = (...dirs: string[]): void => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  };

  it('is the same for the same bytes and changes with a season meta or a shared file', () => {
    const a = built('[1]', '{"dataVersion":"aaaa"}');
    const same = built('[1]', '{"dataVersion":"aaaa"}');
    const newMeta = built('[1]', '{"dataVersion":"bbbb"}');
    const newLayout = built('[1]', '{"dataVersion":"aaaa"}', '{"moved":true}');
    try {
      expect(dataFingerprint(a)).toBe(dataFingerprint(same));
      expect(dataFingerprint(a)).not.toBe(dataFingerprint(newMeta));
      expect(dataFingerprint(a)).not.toBe(dataFingerprint(newLayout));
    } finally {
      cleanup(a, same, newMeta, newLayout);
    }
  });

  it("changes the worker's VERSION when only a data file's content changed", () => {
    const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    const before = built('[1]', '{"dataVersion":"aaaa"}');
    const after = built('[1,2]', '{"dataVersion":"bbbb"}');
    try {
      // The precache list is the same: the same file names in the same place.
      expect(precacheList(before)).toEqual(precacheList(after));
      const version = (out: string): string =>
        injectPrecache(source, precacheList(out), dataFingerprint(out)).match(
          /const VERSION = '([0-9a-f]+)'/,
        )![1]!;
      expect(version(before)).not.toBe(version(after));
    } finally {
      cleanup(before, after);
    }
  });

  it('is empty for a folder without data, so the list alone names the cache', () => {
    dir = mkdtempSync(join(tmpdir(), 'precache-fp-'));
    expect(dataFingerprint(dir)).toBe('');
  });
});
