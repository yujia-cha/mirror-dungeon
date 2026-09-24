import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPath } from './io.ts';
import { dataPreloadPaths, preloadTags } from './preload.ts';

describe('data preload', () => {
  it('names exactly the files the app fetches on open, and every one exists', () => {
    // The same set `loadSeasonIndex` + `loadGameData` ask for; a name that drifted would be fetched
    // twice (once preloaded, unused) and Chrome would warn about it.
    const paths = dataPreloadPaths(repoPath('public/data'));
    expect(paths[0]).toBe('data/index.json');
    expect(paths).toHaveLength(7);
    for (const path of paths) expect(existsSync(repoPath('public', path))).toBe(true);
  });

  it('writes relative fetch preloads with crossorigin, so the app’s fetch() reuses them', () => {
    expect(preloadTags(['data/index.json'])).toBe('<link rel="preload" href="./data/index.json" as="fetch" crossorigin="anonymous" />');
  });
});
