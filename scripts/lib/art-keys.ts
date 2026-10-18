/**
 * Which artwork keys are legal, across every season the app can open.
 *
 * `public/art/` is **one pool for all seasons**. Its keys (`Gift.icon`, `ThemePack.sprite`) are
 * game ids that do not change with the season, and many gifts and packs carry over — splitting the
 * folder per season would mean committing the same drawing twice. A frozen season stays committed
 * under `public/data/md{n}/` and in the public data, so its drawings can still be read after the
 * next season arrives (the walk is `across-seasons.ts`, shared with the gift icons and pack images). A key is therefore legal when **any** season in `index.json`
 * has it; judging against the current season alone made the first drawing of a gift the next
 * season drops block that season's turnover.
 */
import { poolsAcrossSeasons } from './across-seasons.ts';

export interface ArtKeys {
  /** icon → the seasons that have it, ascending. */
  gifts: Map<number, number[]>;
  /** sprite → the seasons that have it, ascending. */
  packs: Map<string, number[]>;
}

/** Collect the keys of every season `index.json` lists under `dataDir` (normally `public/data`). */
export function artKeysAcrossSeasons(dataDir: string): ArtKeys {
  const keys: ArtKeys = { gifts: new Map(), packs: new Map() };
  const add = <K>(map: Map<K, number[]>, key: K, season: number): void => {
    const list = map.get(key);
    if (!list) map.set(key, [season]);
    else if (!list.includes(season)) list.push(season);
  };
  for (const { season, gifts, packs } of poolsAcrossSeasons(dataDir)) {
    for (const gift of gifts) add(keys.gifts, gift.icon, season);
    for (const pack of packs) add(keys.packs, pack.sprite, season);
  }
  return keys;
}
