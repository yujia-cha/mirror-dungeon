/**
 * Where the generated data lives.
 *
 * A Mirror Dungeon season replaces the gift pool rather than adding to it, so `gifts`, `packs`,
 * `rules` and `meta` belong to one season and live under `public/data/md{n}/`. `enums` and
 * `identities` look at no dungeon at all, so every season shares the copy at the root.
 */
import { join } from 'node:path';
import { readJsonIfExists, repoPath } from './io.ts';
import type { SeasonIndex } from '../../src/core/schema.ts';

export const OUT = repoPath('public/data');

/** Files one season owns. */
export const SEASON_FILES = ['meta', 'rules', 'gifts', 'packs'] as const;
/** Files every season shares. */
export const SHARED_FILES = ['enums', 'identities'] as const;

export type OutFile = (typeof SEASON_FILES)[number] | (typeof SHARED_FILES)[number];

export function readSeasonIndex(): SeasonIndex | null {
  return readJsonIfExists<SeasonIndex>(join(OUT, 'index.json'));
}

/** The season the app opens. Null when nothing has been built yet. */
export function defaultSeason(): number | null {
  return readSeasonIndex()?.default ?? null;
}

export function seasonDir(season: number): string {
  return join(OUT, `md${season}`);
}

/** Absolute path of a generated file, in the season's directory or at the shared root. */
export function outPath(name: OutFile, season: number): string {
  return (SEASON_FILES as readonly string[]).includes(name)
    ? join(seasonDir(season), `${name}.json`)
    : join(OUT, `${name}.json`);
}

/** Repo-relative path, for messages and `git show`. */
export function outRelPath(name: OutFile, season: number): string {
  return (SEASON_FILES as readonly string[]).includes(name)
    ? `public/data/md${season}/${name}.json`
    : `public/data/${name}.json`;
}
