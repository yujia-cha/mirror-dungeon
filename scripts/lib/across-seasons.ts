/**
 * The gifts and packs of every season the app can open, read from the generated data.
 *
 * Artwork (`public/art/`), gift icons and pack images are **one pool for all seasons**: their keys
 * (`Gift.icon`, `ThemePack.sprite`) are game ids that do not change with the season, and many
 * gifts and packs carry over. A frozen season stays committed under `public/data/md{n}/`, so a
 * key is legal — and its icon wanted — when **any** season in `index.json` has it. This is the one
 * walk over those seasons; `art-keys.ts`, `fetch-icons.ts` and `validate-data.ts` read it.
 */
import { join } from 'node:path';
import type { Gift, SeasonIndex, ThemePack } from '../../src/core/schema.ts';
import { readJsonIfExists } from './io.ts';

export interface SeasonPool {
  season: number;
  gifts: Pick<Gift, 'id' | 'icon'>[];
  packs: Pick<ThemePack, 'id' | 'sprite'>[];
}

/**
 * Every season `index.json` lists under `dataDir` (normally `public/data`), ascending, each once.
 * A season whose files are missing contributes nothing rather than throwing — the validator
 * reports a missing file on its own, and this is not the place to say it twice.
 */
export function poolsAcrossSeasons(dataDir: string): SeasonPool[] {
  const index = readJsonIfExists<SeasonIndex>(join(dataDir, 'index.json'));
  const seasons = [...new Set((index?.seasons ?? []).map((s) => s.id))].sort((a, b) => a - b);
  return seasons.map((season) => ({
    season,
    gifts: (readJsonIfExists<Gift[]>(join(dataDir, `md${season}`, 'gifts.json')) ?? []).map((g) => ({
      id: g.id,
      icon: g.icon,
    })),
    packs: (readJsonIfExists<ThemePack[]>(join(dataDir, `md${season}`, 'packs.json')) ?? []).map((p) => ({
      id: p.id,
      sprite: p.sprite,
    })),
  }));
}

/** Every gift of every season (`poolsAcrossSeasons`), a gift carried over listed once a season. */
export function giftsAcrossSeasons(dataDir: string): Pick<Gift, 'id' | 'icon'>[] {
  return poolsAcrossSeasons(dataDir).flatMap((s) => s.gifts);
}

/** Every pack of every season (`poolsAcrossSeasons`), a pack carried over listed once a season. */
export function packsAcrossSeasons(dataDir: string): Pick<ThemePack, 'id' | 'sprite'>[] {
  return poolsAcrossSeasons(dataDir).flatMap((s) => s.packs);
}
