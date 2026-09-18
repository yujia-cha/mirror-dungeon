/**
 * The Mirror Dungeon half of `eldritchtools/limbus-assets`, read as a check on the static data and
 * as the fallback for a season the static data never gets.
 *
 * OpenLethe's Mirror Dungeon capture is frozen at 2026-07-25, so the season after this one will
 * never arrive there. This source is the only living one — but it is a supplement, not a
 * replacement: it carries no per-pack general gift pool, no prices, no observation list and no
 * dungeon constants. What it does carry has been checked against the current season and agrees
 * exactly (floors 115/116, fusion 59/59, start pools 10/10); `tests/md-fallback.test.ts` pins that.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './io.ts';
import { DERIVED_DIR, KEYWORD_BY_EN } from './derived-source.ts';
import type { Sin, StatusKeyword } from '../../src/core/schema.ts';
import { SIN_BY_COLOR, type RawGift, type RawThemePack } from './raw.ts';

export interface DerivedPack {
  name?: string;
  category?: string[];
  tags?: string[];
  /** Pack-bound gifts. Clear rewards are mixed in here, so callers re-split them by pack id. */
  exclusive_gifts?: string[];
  eventPool?: number[];
  bossEncounters?: string[];
}

export interface DerivedGift {
  names?: string[];
  descs?: string[];
  tier?: string;
  keyword?: string;
  affinity?: string;
  /** Fixed recipes as ingredient id lists; the mixed recipe appears as an options object instead. */
  recipes?: (string | { count: number; options: string[] })[][];
  exclusiveTo?: string[];
  hardonly?: boolean;
  enhanceable?: boolean;
  hidden?: boolean;
  vestige?: boolean;
}

/**
 * Floors per difficulty, as the source writes them: `{"hard": {"1": [...], "6-10": [...]}}`.
 * Pack ids arrive as strings here even though they are numbers everywhere else.
 */
type FloorMap = Record<string, Record<string, (number | string)[]>>;

export interface PackAvailability {
  normal: number[];
  hard: number[];
  parallel: number[];
  extreme: number[];
}

const SIN_BY_AFFINITY: Record<string, Sin> = {
  wrath: 'WRATH',
  lust: 'LUST',
  sloth: 'SLOTH',
  gluttony: 'GLUTTONY',
  gloom: 'GLOOM',
  pride: 'PRIDE',
  envy: 'ENVY',
};

function file<T>(...parts: string[]): T | null {
  const path = join(DERIVED_DIR, ...parts);
  return existsSync(path) ? readJson<T>(path) : null;
}

export function derivedMdPresent(): boolean {
  return existsSync(join(DERIVED_DIR, 'data', 'md_theme_packs.json'));
}

export function readDerivedPacks(): Map<number, DerivedPack> {
  const raw = file<Record<string, DerivedPack>>('data', 'md_theme_packs.json') ?? {};
  return new Map(Object.entries(raw).map(([id, pack]) => [Number(id), pack]));
}

export function readDerivedGifts(): Map<number, DerivedGift> {
  const raw = file<Record<string, DerivedGift>>('data', 'gifts.json') ?? {};
  return new Map(Object.entries(raw).map(([id, gift]) => [Number(id), gift]));
}

function expandSpan(span: string): number[] {
  if (!span.includes('-')) return [Number(span)];
  const [from, to] = span.split('-').map(Number);
  return Array.from({ length: (to ?? 0) - (from ?? 0) + 1 }, (_, i) => (from ?? 0) + i);
}

/**
 * Which floors each pack can appear on, in the app's four buckets.
 *
 * The source only splits normal from hard, because the game does: 6-10 (평행중첩) and 11-15
 * (EXTREME) are hard-side floor bands rather than difficulties of their own, so the bucket comes
 * from the floor number.
 */
export function readDerivedAvailability(): Map<number, PackAvailability> {
  const raw = file<FloorMap>('data', 'md_floor_packs.json') ?? {};
  const out = new Map<number, PackAvailability>();
  for (const [difficulty, bands] of Object.entries(raw)) {
    for (const [span, ids] of Object.entries(bands)) {
      for (const raw of ids) {
        const id = Number(raw);
        if (!Number.isFinite(id)) continue;
        const entry = out.get(id) ?? { normal: [], hard: [], parallel: [], extreme: [] };
        for (const floor of expandSpan(span)) {
          const bucket = floor >= 11 ? 'extreme' : floor >= 6 ? 'parallel' : difficulty === 'normal' ? 'normal' : 'hard';
          if (!entry[bucket].includes(floor)) entry[bucket].push(floor);
        }
        out.set(id, entry);
      }
    }
  }
  for (const entry of out.values()) {
    for (const floors of Object.values(entry) as number[][]) floors.sort((a, b) => a - b);
  }
  return out;
}

/**
 * The attack types, which `KEYWORD_BY_EN` does not cover: it maps the seven status keywords an
 * identity can inflict, while the start pools are keyed by all ten gift affinities.
 */
const ATTACK_TYPE_BY_EN: Record<string, string> = { Slash: 'Slash', Pierce: 'Penetrate', Blunt: 'Hit' };

/** The three starting gifts per keyword, keyed by the app's keyword ids. */
export function readDerivedStartPools(): Map<string, number[]> {
  const raw = file<{ startGiftPool?: Record<string, number[]> }>('data', 'md', 'details.json');
  const out = new Map<string, number[]>();
  for (const [name, ids] of Object.entries(raw?.startGiftPool ?? {})) {
    const keyword = KEYWORD_BY_EN[name] ?? ATTACK_TYPE_BY_EN[name] ?? name;
    out.set(keyword, [...ids].sort((a, b) => a - b));
  }
  return out;
}

/** Fixed recipes only, as sorted ingredient-id lists. The mixed recipe is shaped differently. */
export function derivedFixedRecipes(gift: DerivedGift): number[][] {
  return (gift.recipes ?? [])
    .filter((recipe): recipe is string[] => recipe.every((part) => typeof part === 'string'))
    .map((recipe) => recipe.map(Number).sort((a, b) => a - b));
}

export function derivedTier(gift: DerivedGift): number | 'EX' | null {
  if (!gift.tier) return null;
  return gift.tier === 'EX' ? 'EX' : Number(gift.tier);
}

export function derivedKeyword(gift: DerivedGift): StatusKeyword | null {
  const keyword = gift.keyword ? KEYWORD_BY_EN[gift.keyword] : undefined;
  return keyword && keyword !== 'Bullet' ? (keyword as StatusKeyword) : null;
}

export function derivedSin(gift: DerivedGift): Sin | null {
  return gift.affinity ? (SIN_BY_AFFINITY[gift.affinity] ?? null) : null;
}

/** `dungeonIdx` for each of the app's four floor buckets, as the static data encodes them. */
const DUNGEON_IDX: Record<keyof PackAvailability, number> = { normal: 0, hard: 1, parallel: 2, extreme: 3 };

const COLOR_BY_SIN = new Map<Sin, string>(
  Object.entries(SIN_BY_COLOR).map(([color, sin]) => [sin, color] as const),
);

/**
 * A pack the static data has not shipped, shaped as if it had.
 *
 * Synthesising the *raw* record rather than the finished one means every downstream step — floor
 * availability, gift pools, acquisition classes, conflict groups — keeps running unchanged, and the
 * fallback cannot drift away from the real path. `tests/md-fallback.test.ts` rebuilds the current
 * season this way to prove the encoding is right.
 *
 * `egoGiftPool` is left undefined on purpose: this source has no per-pack general pool, and there
 * is no honest way to guess one. Validation says so out loud rather than letting the planner quietly
 * believe the pack drops nothing.
 */
export function derivedPackAsRaw(id: number, pack: DerivedPack, floors: PackAvailability): RawThemePack {
  const exceptionConditions = (Object.keys(DUNGEON_IDX) as (keyof PackAvailability)[])
    .filter((bucket) => floors[bucket].length > 0)
    .map((bucket) => ({
      dungeonIdx: DUNGEON_IDX[bucket],
      selectableFloors: floors[bucket].map((floor) => floor - 1),
    }));
  return {
    id,
    exceptionConditions,
    // Clear rewards are folded into this list upstream; a backfilled EXTREME pack therefore reads
    // them as ordinary exclusives until the static data arrives.
    specificEgoGiftPool: (pack.exclusive_gifts ?? []).map(Number).filter(Number.isFinite),
    mapGenOption: pack.bossEncounters ? {} : undefined,
  };
}

/** A gift the static data has not shipped, shaped as if it had. Price is unknown, so it is omitted. */
export function derivedGiftAsRaw(id: number, gift: DerivedGift): RawGift {
  const tier = derivedTier(gift);
  const sin = derivedSin(gift);
  const keyword = derivedKeyword(gift);
  return {
    id,
    ...(keyword ? { keyword } : {}),
    ...(sin ? { attributeType: COLOR_BY_SIN.get(sin) } : {}),
    tag: tier === null ? [] : [tier === 'EX' ? 'TIER_EX' : `TIER_${tier}`],
    // `upgradeLevels` counts entries minus one, so two entries mean a single `+` step. The source
    // only says whether a gift is enhanceable at all, so the finer 1-vs-2 split is lost.
    upgradeDataList: gift.enhanceable ? [{ upgradeLevel: 0, localizeID: id }, { upgradeLevel: 1, localizeID: id }] : null,
  };
}
