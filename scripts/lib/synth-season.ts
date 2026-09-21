/**
 * A synthetic "next season", built from the season already on disk.
 *
 * `npm run data:import` is the one path in this pipeline that has never been walked: it needs a
 * game client's extracted `static-data`, and the day it is needed is the day a new Mirror Dungeon
 * lands and nothing else works. `docs/deploy-checklist.md` calls that the project's biggest open
 * risk. This makes a folder shaped like that extraction so the path can be walked today.
 *
 * Nothing is committed. The fixture is derived at run time from the real `data/raw`, for three
 * reasons: `data/raw/**` is not hand-written, a committed copy of Project Moon's data with the
 * ids changed is a second redistribution the NOTICE does not cover, and — the useful one — a
 * generator that reads "the season on disk" turns into an md9 rehearsal by itself the day md8
 * lands. It cannot go stale. `tests/md-fallback.test.ts` keeps the fallback honest the same way.
 *
 * Determinism: no clock, no randomness. Donors are taken from the front of a sorted list, so the
 * same `data/raw` always produces byte-identical output.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJson, repoPath } from './io.ts';
import { LOCALIZE_DIR, STATIC_DIR, type RawGift, type RawThemePack } from './raw.ts';
import { familyOf, renameToSeason, seasonOf } from './season-files.ts';

/**
 * What the extraction looks like when it arrives.
 *
 * - `full` — everything. The season builds, validates clean and becomes the default.
 * - `partial` — the drop pool and the observation list never made it. The most dangerous shape:
 *   see `partialSymptoms` below.
 * - `derived-only` — nothing was extracted; only the living community mirror knows the season.
 *   The fallback in `derived-md.ts` backfills packs, floors and exclusives, but cannot supply a
 *   general gift pool, so the season can only ship as `provisional`.
 */
export type SynthVariant = 'full' | 'partial' | 'derived-only';

/**
 * Why `partial` is the variant worth building.
 *
 * `build-data.ts` reads the drop pool and the observation list with `readDropPool()` /
 * `readObservationData()`, both of which return `null` when the file is absent. Nothing downstream
 * treats that as an error: every gift silently becomes unobservable, no gift is classed as
 * `event`, and `validate-data`'s `globalExcludeEgoGifts` cross-check skips itself entirely. The
 * season has a general pool — it came from the static data — so it is not `provisional` either,
 * and it becomes `index.default`.
 */
export const PARTIAL_SYMPTOMS = [
  'no gift is classified as `event` (the drop pool is what says so)',
  'every gift is unobservable (the observation list is what says otherwise)',
  'the dungeon name is empty when the localization is missing too',
] as const;

export interface SynthSeason {
  /** Folder shaped like an extracted `static-data`, for `npm run data:import`. */
  staticDir: string;
  /** Localization files, as `npm run data:fetch` would have left them. Null when the variant has none. */
  localizeDir: string | null;
  /** Derived-mirror files, for the `derived-only` variant. Null otherwise. */
  derivedDir: string | null;
  from: number;
  to: number;
  variant: SynthVariant;
  newPackIds: number[];
  newGiftIds: number[];
  /** Paths written, relative to `outDir`, sorted. */
  written: string[];
}

/** New content the synthetic season adds, so the rehearsal proves more than a rename. */
const NEW_KEYWORD_PACKS = [1415, 1416] as const;
const NEW_LONG_BATTLE_PACKS = [1521, 1522] as const;
const NEW_GIFT_BASE = 9900;
const GIFTS_PER_PACK = 2;
/**
 * A pack in a tier file the lock does not list. It is never imported — that is the point: a season
 * that adds a pack tier arrives as a file no rule predicts, and `data:lock-next-season` says so
 * rather than inventing a `t7`. Its id is also past 1599, where `groupForPackId` reads `hidden`.
 */
const UNLISTED_TIER_PACK = 1601;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function listOf<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const record = raw as { list?: T[]; dataList?: T[] } | null;
  return record?.list ?? record?.dataList ?? [];
}

/** Rebuild a file in the wrapper shape it arrived in, so readers see what they expect. */
function reWrap(original: unknown, items: unknown[]): unknown {
  if (Array.isArray(original)) return items;
  const record = original as Record<string, unknown>;
  if (Array.isArray(record['list'])) return { ...record, list: items };
  if (Array.isArray(record['dataList'])) return { ...record, dataList: items };
  return { list: items };
}

interface LockSource {
  localPrefix: string;
  files: (string | { path: string })[];
}

function lockFiles(localPrefix: string): string[] {
  const lock = readJson<{ sources: Record<string, LockSource> }>(repoPath('data/sources.lock.json'));
  const source = Object.values(lock.sources).find((entry) => entry.localPrefix === localPrefix);
  return (source?.files ?? []).map((file) => (typeof file === 'string' ? file : file.path));
}

/** Donor packs, ascending by id, so the choice does not move when the data does. */
function donorPack(packs: RawThemePack[], group: 'keyword' | 'longBattle'): RawThemePack {
  const range = group === 'keyword' ? [1401, 1499] : [1501, 1599];
  const donor = packs
    .filter((pack) => pack.id >= range[0]! && pack.id <= range[1]!)
    .sort((a, b) => a.id - b.id)[0];
  if (!donor) throw new Error(`no ${group} pack on disk to copy from`);
  return donor;
}

export interface SynthOptions {
  outDir: string;
  from: number;
  to: number;
  variant: SynthVariant;
}

export function synthesiseSeason({ outDir, from, to, variant }: SynthOptions): SynthSeason {
  const written: string[] = [];
  const record = (path: string): void => {
    written.push(path.slice(outDir.length + 1));
  };

  const staticOut = join(outDir, 'static');
  const localizeOut = join(outDir, 'localize');
  const derivedOut = join(outDir, 'derived');

  const newGiftIds = Array.from(
    { length: (NEW_KEYWORD_PACKS.length + NEW_LONG_BATTLE_PACKS.length) * GIFTS_PER_PACK },
    (_, i) => NEW_GIFT_BASE + i,
  );
  const newPackIds = [...NEW_KEYWORD_PACKS, ...NEW_LONG_BATTLE_PACKS];
  const giftsOfPack = new Map<number, number[]>(
    newPackIds.map((packId, index) => [
      packId,
      newGiftIds.slice(index * GIFTS_PER_PACK, (index + 1) * GIFTS_PER_PACK),
    ]),
  );

  if (variant === 'derived-only') {
    writeDerivedOnly({ derivedOut, newPackIds, giftsOfPack, record });
    return {
      staticDir: staticOut,
      localizeDir: null,
      derivedDir: derivedOut,
      from,
      to,
      variant,
      newPackIds,
      newGiftIds,
      written: written.sort(),
    };
  }

  // -------------------------------------------------------------------------
  // Static data
  // -------------------------------------------------------------------------

  const wantDropPool = variant === 'full';
  const wantObservation = variant === 'full';

  for (const file of lockFiles('data/raw/static')) {
    if (seasonOf(file) !== from) continue;
    const family = familyOf(file)!;
    if (family === 'droppool' && !wantDropPool) continue;
    if (family === 'observation' && !wantObservation) continue;
    const src = join(STATIC_DIR, file);
    if (!existsSync(src)) continue;
    const dst = join(staticOut, renameToSeason(file, to)!);
    mkdirSync(dirname(dst), { recursive: true });

    if (family === 'ego-gift' && /ego-gift-mirrordungeon\d+\.json$/.test(file)) {
      // The new season's own gift file: only the gifts it introduces. Copying md7's would
      // re-declare ids that are already on disk under their own name.
      const donors = listOf<RawGift>(readJson(src)).sort((a, b) => a.id - b.id);
      const gifts = newGiftIds.map((id, index) => {
        const donor = donors[index % donors.length]!;
        return {
          ...donor,
          id,
          upgradeDataList: (donor.upgradeDataList ?? []).map((entry) => ({ ...entry, localizeID: id })),
        };
      });
      writeJson(dst, reWrap(readJson(src), gifts));
      record(dst);
      continue;
    }

    const raw = readJson<Record<string, unknown>>(src);
    if (family === 'common-data') {
      const items = listOf<Record<string, unknown>>(raw);
      if (items.length > 0) {
        writeJson(dst, reWrap(raw, items.map((item) => ({ ...item, currentDungeonId: to }))));
      } else {
        writeJson(dst, { ...raw, currentDungeonId: to });
      }
    } else if (family === 'droppool') {
      const items = listOf<Record<string, unknown>>(raw);
      writeJson(dst, reWrap(raw, items.map((item) => ({ ...item, dungeonId: to }))));
    } else if (family === 'observation') {
      const items = listOf<Record<string, unknown>>(raw).map((item) => ({ ...item, mirrordungeonId: to }));
      // The new pack-bound gifts are observable, like every other pack-limited gift.
      const first = items[0] as { observationEgoGiftDataList?: { egogiftIdList?: number[] }[] } | undefined;
      const bucket = first?.observationEgoGiftDataList?.[0];
      if (bucket) bucket.egogiftIdList = [...(bucket.egogiftIdList ?? []), ...newGiftIds];
      writeJson(dst, reWrap(raw, items));
    } else {
      copyFileSync(src, dst);
    }
    record(dst);
  }

  // Theme packs are not season-named — a new season replaces the same `t{k}` files. That is
  // exactly why an older season can never be rebuilt once md8 lands, and the rehearsal proves it.
  const themeDir = join(STATIC_DIR, 'mirrordungeon-theme-floor');
  const themeFiles = existsSync(themeDir) ? readdirSync(themeDir).filter((f) => f.endsWith('.json')).sort() : [];
  const allPacks = themeFiles.flatMap((f) => listOf<RawThemePack>(readJson(join(themeDir, f))));
  for (const name of themeFiles) {
    const src = join(themeDir, name);
    const raw = readJson(src);
    const packs = listOf<RawThemePack>(raw);
    const additions: RawThemePack[] = [];
    if (/-t5\.json$/.test(name)) {
      additions.push(...NEW_KEYWORD_PACKS.map((id) => clonePack(donorPack(allPacks, 'keyword'), id, giftsOfPack)));
    }
    if (/-t6\.json$/.test(name)) {
      additions.push(
        ...NEW_LONG_BATTLE_PACKS.map((id) => clonePack(donorPack(allPacks, 'longBattle'), id, giftsOfPack)),
      );
    }
    const dst = join(staticOut, 'mirrordungeon-theme-floor', name);
    writeJson(dst, reWrap(raw, [...packs, ...additions]));
    record(dst);
  }
  // The tier file the lock has never heard of; `data:import` must leave it alone.
  const unlisted = join(staticOut, 'mirrordungeon-theme-floor', 'mirrordungeon-theme-floor-t7.json');
  writeJson(unlisted, { list: [clonePack(donorPack(allPacks, 'longBattle'), UNLISTED_TIER_PACK, new Map())] });
  record(unlisted);

  // -------------------------------------------------------------------------
  // Localization — what `data:fetch` would have brought down
  // -------------------------------------------------------------------------

  if (variant === 'partial') {
    return {
      staticDir: staticOut,
      localizeDir: null,
      derivedDir: null,
      from,
      to,
      variant,
      newPackIds,
      newGiftIds,
      written: written.sort(),
    };
  }

  for (const lang of ['KR', 'EN'] as const) {
    for (const file of lockFiles('data/raw/localize')) {
      if (seasonOf(file) !== from) continue;
      const src = join(LOCALIZE_DIR, lang, file);
      if (!existsSync(src)) continue;
      const dst = join(localizeOut, lang, renameToSeason(file, to)!);
      const family = familyOf(file)!;
      const raw = readJson(src);

      if (family === 'localize-gift-text') {
        writeJson(
          dst,
          reWrap(
            raw,
            newGiftIds.map((id) => ({
              id,
              name: lang === 'KR' ? `합성 기프트 ${id}` : `Synthetic Gift ${id}`,
              desc: lang === 'KR' ? '리허설용으로 만들어진 기프트입니다.' : 'A gift made for the rehearsal.',
            })),
          ),
        );
      } else if (family === 'localize-ui') {
        const items = listOf<{ id: string; content?: string }>(raw).map((entry) =>
          entry.id === `mirror_dungeon_progress_text_${from}`
            ? {
                ...entry,
                id: `mirror_dungeon_progress_text_${to}`,
                content: lang === 'KR' ? `리허설의 거울 {0}층` : 'Rehearsal Mirror Floor {0}',
              }
            : entry,
        );
        writeJson(dst, reWrap(raw, items));
      } else {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
      record(dst);
    }

    // Pack names live in a file that is not season-named, so the new season rewrites it in place.
    const themeName = 'MirrorDungeonTheme-1.json';
    const themeSrc = join(LOCALIZE_DIR, lang, themeName);
    if (existsSync(themeSrc)) {
      const raw = readJson(themeSrc);
      const items = listOf<{ id: number | string; name?: string }>(raw);
      const added = [
        ...newPackIds.map((id) => ({
          id,
          name: lang === 'KR' ? `합성 테마팩 ${id}` : `Synthetic Pack ${id}`,
        })),
      ];
      const dst = join(localizeOut, lang, themeName);
      writeJson(dst, reWrap(raw, [...items, ...added]));
      record(dst);
    }
  }

  return {
    staticDir: staticOut,
    localizeDir: localizeOut,
    derivedDir: null,
    from,
    to,
    variant,
    newPackIds,
    newGiftIds,
    written: written.sort(),
  };
}

/** A copy of `donor` under a new id, carrying the new season's own exclusive gifts. */
function clonePack(donor: RawThemePack, id: number, giftsOfPack: Map<number, number[]>): RawThemePack {
  return {
    ...donor,
    id,
    // `desc` is the dev name, and `affinitiesFromDevName` reads the pack's keyword and sin out of
    // it — renaming it to something tidy is what made the first rehearsal fail validation.
    desc: donor.desc,
    specificEgoGiftPool: giftsOfPack.get(id) ?? [],
    // `egoGiftPool` is kept from the donor on purpose: a season with a general pool is one the
    // build may ship as the default, which is the case worth rehearsing.
  };
}

/**
 * The season only the community mirror knows.
 *
 * The derived files are keyed by id-as-string and carry names, tiers and floors — no general
 * pool, which is precisely the gap `validate-data` refuses to paper over.
 */
function writeDerivedOnly({
  derivedOut,
  newPackIds,
  giftsOfPack,
  record,
}: {
  derivedOut: string;
  newPackIds: number[];
  giftsOfPack: Map<number, number[]>;
  record: (path: string) => void;
}): void {
  const derivedRoot = repoPath('data/raw/derived/eldritchtools');
  // Start from the vendored mirror so every other pack and gift stays exactly as it is.
  copyTree(derivedRoot, derivedOut, record);

  const packsPath = join(derivedOut, 'data', 'md_theme_packs.json');
  const packs = readJson<Record<string, unknown>>(packsPath);
  for (const id of newPackIds) {
    packs[String(id)] = {
      name: `Synthetic Pack ${id}`,
      image: 'Synthetic',
      category: ['Synthetic'],
      tags: ['Synthetic'],
      exclusive_gifts: (giftsOfPack.get(id) ?? []).map(String),
    };
  }
  writeJson(packsPath, packs);

  const giftsPath = join(derivedOut, 'data', 'gifts.json');
  const gifts = readJson<Record<string, unknown>>(giftsPath);
  for (const [packId, ids] of giftsOfPack) {
    for (const id of ids) {
      gifts[String(id)] = {
        names: [`Synthetic Gift ${id}`],
        descs: ['A gift made for the rehearsal.'],
        tier: '4',
        keyword: 'None',
        exclusiveTo: [String(packId)],
      };
    }
  }
  writeJson(giftsPath, gifts);

  const floorsPath = join(derivedOut, 'data', 'md_floor_packs.json');
  const floors = readJson<Record<string, Record<string, string[]>>>(floorsPath);
  // Keyword packs ride floors 4-5, long-battle packs the EXTREME band — where their donors sit.
  floors['hard'] ??= {};
  floors['hard']['4'] = [...(floors['hard']['4'] ?? []), ...NEW_KEYWORD_PACKS.map(String)];
  floors['hard']['5'] = [...(floors['hard']['5'] ?? []), ...NEW_KEYWORD_PACKS.map(String)];
  floors['hard']['11-15'] = [...(floors['hard']['11-15'] ?? []), ...NEW_LONG_BATTLE_PACKS.map(String)];
  writeJson(floorsPath, floors);
}

function copyTree(from: string, to: string, record: (path: string) => void): void {
  for (const entry of readdirSync(from).sort()) {
    const src = join(from, entry);
    const dst = join(to, entry);
    if (statSync(src).isDirectory()) {
      copyTree(src, dst, record);
      continue;
    }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    record(dst);
  }
}

/**
 * Copy a tree keeping mtimes.
 *
 * `validate-data`'s freshness check compares input mtimes against the built season's, and a plain
 * copy stamps every file with "now" — which would make the sandbox warn `[stale]` on every run
 * for a reason that has nothing to do with the season.
 */
export function copyTreePreservingTimes(from: string, to: string): void {
  for (const entry of readdirSync(from).sort()) {
    const src = join(from, entry);
    const dst = join(to, entry);
    const stat = statSync(src);
    if (stat.isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyTreePreservingTimes(src, dst);
      utimesSync(dst, stat.atime, stat.mtime);
      continue;
    }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    utimesSync(dst, stat.atime, stat.mtime);
  }
}
