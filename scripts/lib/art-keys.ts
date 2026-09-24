/**
 * Which artwork keys are legal, across every season the app can open.
 *
 * `public/art/` is **one pool for all seasons**. Its keys (`Gift.icon`, `ThemePack.sprite`) are
 * game ids that do not change with the season, and many gifts and packs carry over — splitting the
 * folder per season would mean committing the same drawing twice. A frozen season stays committed
 * under `public/data/md{n}/` and stays selectable in the footer, so its drawings are still read
 * after the next season arrives. A key is therefore legal when **any** season in `index.json`
 * has it; judging against the current season alone made the first drawing of a gift the next
 * season drops block that season's turnover.
 */
import { join } from 'node:path';
import type { Gift, SeasonIndex, ThemePack } from '../../src/core/schema.ts';
import { readJsonIfExists } from './io.ts';

export interface ArtKeys {
  /** icon → the seasons that have it, ascending. */
  gifts: Map<number, number[]>;
  /** sprite → the seasons that have it, ascending. */
  packs: Map<string, number[]>;
}

/**
 * Collect the keys of every season `index.json` lists under `dataDir` (normally `public/data`).
 * A season whose files are missing contributes nothing rather than throwing — the validator
 * reports a missing file on its own, and this is not the place to say it twice.
 */
export function artKeysAcrossSeasons(dataDir: string): ArtKeys {
  const index = readJsonIfExists<SeasonIndex>(join(dataDir, 'index.json'));
  const seasons = [...new Set((index?.seasons ?? []).map((s) => s.id))].sort((a, b) => a - b);
  const keys: ArtKeys = { gifts: new Map(), packs: new Map() };
  const add = <K>(map: Map<K, number[]>, key: K, season: number): void => {
    const list = map.get(key);
    if (!list) map.set(key, [season]);
    else if (!list.includes(season)) list.push(season);
  };
  for (const season of seasons) {
    const gifts = readJsonIfExists<Gift[]>(join(dataDir, `md${season}`, 'gifts.json')) ?? [];
    const packs = readJsonIfExists<ThemePack[]>(join(dataDir, `md${season}`, 'packs.json')) ?? [];
    for (const gift of gifts) add(keys.gifts, gift.icon, season);
    for (const pack of packs) add(keys.packs, pack.sprite, season);
  }
  return keys;
}
