/**
 * Which gift icon files to take from eldritchtools/limbus-assets, and under which name.
 *
 * The screen tracker matches fusion ingredients by their icon, so the app ships the game's gift
 * icons (the owner's decision, M92 — the one exception to "no game images", recorded in NOTICE).
 * They come from the same derived source the pipeline already pins, not from a client extraction.
 *
 * Its `assets/gifts/` folder names files two ways — by number for newer gifts (`9207.webp`), by
 * English name for older ones (`Bell of Truth.webp`, typos and old names included: `Lightening
 * Axe`, `Prosthetic Join Servos`). Guessing from names would go wrong; the source's own
 * `data/gifts.json` says which file is which gift in `srcPath`, keyed by gift id. We save each file
 * under the gift's `icon` key — the same key `public/art/` uses, which is not always the id.
 */
import { join } from 'node:path';
import type { Gift, SeasonIndex } from '../../src/core/schema.ts';
import { readJsonIfExists } from './io.ts';

/** Where the icons live, one `{icon}.webp` per key, plus `manifest.json`. */
export const GIFT_ICON_DIR = 'public/icons/gifts';
/** Upstream folder inside the eldritchtools repository. */
export const UPSTREAM_GIFT_DIR = 'assets/gifts';
/** A gift icon is ~5–35 KB; anything this large is not one. */
export const MAX_ICON_BYTES = 256 * 1024;

/** The slice of an eldritchtools gift entry this file reads. */
export interface DerivedGiftEntry {
  srcPath?: string;
}

export interface IconPlan {
  /** One download per icon key, ascending by key. */
  downloads: { icon: number; remote: string }[];
  /** Icon keys no gift of theirs has a `srcPath` for, ascending. */
  unmapped: number[];
}

/**
 * Match every icon key to its upstream file. Gifts that share an icon key need it once; the first
 * gift (by id) that has a `srcPath` names the file.
 */
export function planGiftIcons(
  gifts: readonly Pick<Gift, 'id' | 'icon'>[],
  derived: Readonly<Record<string, DerivedGiftEntry>>,
): IconPlan {
  const byIcon = new Map<number, string | null>();
  for (const gift of [...gifts].sort((a, b) => a.id - b.id)) {
    if (byIcon.get(gift.icon)) continue;
    byIcon.set(gift.icon, derived[String(gift.id)]?.srcPath ?? null);
  }
  const downloads: IconPlan['downloads'] = [];
  const unmapped: number[] = [];
  for (const [icon, srcPath] of [...byIcon].sort((a, b) => a[0] - b[0])) {
    if (srcPath) downloads.push({ icon, remote: `${UPSTREAM_GIFT_DIR}/${srcPath}.webp` });
    else unmapped.push(icon);
  }
  return { downloads, unmapped };
}

/** True for a RIFF container of type WEBP — the only format the icons ship in. */
export function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}

/**
 * Every gift of every season `index.json` lists — icons are one pool across seasons, for the same
 * reason `public/art/` is (`art-keys.ts`): a frozen season is still selectable.
 */
export function giftsAcrossSeasons(dataDir: string): Pick<Gift, 'id' | 'icon'>[] {
  const index = readJsonIfExists<SeasonIndex>(join(dataDir, 'index.json'));
  const gifts: Pick<Gift, 'id' | 'icon'>[] = [];
  for (const season of index?.seasons ?? []) {
    for (const gift of readJsonIfExists<Gift[]>(join(dataDir, `md${season.id}`, 'gifts.json')) ?? []) {
      gifts.push({ id: gift.id, icon: gift.icon });
    }
  }
  return gifts;
}
