/**
 * The load phase (M168): everything the build reads, in one place and before anything is derived.
 *
 * Which season to build is decided here too, with the refusals the script always had — missing
 * static data, a `--season` that is not an id, a season older than the snapshot — each a
 * `BuildError` rather than an exit, so nothing is written on the way out.
 */
import { readJson, readJsonIfExists, repoPath, rootIsOverridden } from '../io.ts';
import {
  listSeasons,
  readBattleKeywordNames,
  readBattlePassiveIds,
  readCommonData,
  readDropPool,
  readFactionNames,
  readGiftCategoryNames,
  readGiftStatics,
  readGiftTexts,
  readLocalizedPersonalitySkills,
  readLockedDescs,
  readObservationData,
  readPassiveTexts,
  readPersonalities,
  readPersonalitySkills,
  readPersonalityTexts,
  readSpecialVariants,
  readStages,
  readThemeNames,
  readThemePacks,
  staticDataPresent,
} from '../raw.ts';
import { frozenSeasonRefusal } from '../season-files.ts';
import { readLock } from '../lock.ts';
import { readCuratedGiftEffects } from '../parse-effects.ts';
import {
  derivedGiftAsRaw,
  derivedMdPresent,
  derivedPackAsRaw,
  readDerivedAvailability,
  readDerivedGifts,
  readDerivedPacks,
} from '../derived-md.ts';
import { readDerivedIdentities } from '../derived-source.ts';
import {
  curatedSeasonSchema,
  type Condition,
  type CuratedSeason,
  type Localized,
  type Rules,
} from '../../../src/core/schema.ts';
import { fail } from './errors.ts';
import type { BuildOptions } from './options.ts';
import { sortNums } from './util.ts';

// ---------------------------------------------------------------------------
// Curated overrides
// ---------------------------------------------------------------------------

export interface CuratedRules {
  deployment?: Rules['deployment'];
  giftObservation?: Rules['giftObservation'];
  generalGiftPackShare?: number;
  hiddenPack?: Rules['hiddenPack'];
  [key: string]: unknown;
}

/**
 * An identity the static data does not ship at all, written by hand.
 *
 * Only what cannot be derived: the name, the sinner and the id itself still come from the
 * localization, through the same code path every other identity takes. A field left out is
 * unknown, not empty-by-choice — see the `_source` each entry carries.
 */
export interface CuratedIdentity {
  _source?: string;
  keywords?: Record<string, { skills: number; specialSkills: number }>;
  rank?: number;
  season?: number;
  factions?: string[];
  traits?: string[];
  sins?: string[];
  attackTypes?: string[];
}

function readCurated() {
  return {
    rules: readJsonIfExists<CuratedRules>(repoPath('data/curated/rules.json')) ?? {},
    factions:
      readJsonIfExists<Record<string, { ko?: string; en?: string }>>(
        repoPath('data/curated/factions.json'),
      ) ?? {},
    identityKeywords:
      readJsonIfExists<
        Record<string, { keywords?: Record<string, { skills: number; specialSkills: number }> }>
      >(repoPath('data/curated/identity-keywords.json')) ?? {},
    identities:
      readJsonIfExists<Record<string, CuratedIdentity>>(repoPath('data/curated/identities.json')) ?? {},
    conditions:
      readJsonIfExists<Record<string, { conditions?: Condition[] }>>(
        repoPath('data/curated/conditions.json'),
      ) ?? {},
    names:
      readJsonIfExists<{
        gifts?: Record<string, Partial<Localized>>;
        packs?: Record<string, Partial<Localized>>;
        identities?: Record<string, Partial<Localized>>;
        keywords?: Record<string, Partial<Localized>>;
      }>(repoPath('data/curated/names-override.json')) ?? {},
    notes:
      readJsonIfExists<{ gifts?: Record<string, Localized>; packs?: Record<string, Localized> }>(
        repoPath('data/curated/notes.json'),
      ) ?? {},
  };
}

export type Curated = ReturnType<typeof readCurated>;

/** The screen tracker's layout (M103): parsed in the validate phase, excluded from `dataVersion`. */
export const CAPTURE_LAYOUT_CURATED = repoPath('data/curated/capture-layout.json');

// ---------------------------------------------------------------------------
// Load sources
// ---------------------------------------------------------------------------

export function loadSources(options: BuildOptions) {
  const { lenient } = options;
  const curated = readCurated();

  if (rootIsOverridden) console.log(`root ${repoPath('')}`);

  const hasStatic = staticDataPresent();
  if (!hasStatic && !lenient) {
    fail('data/raw/static is missing. Run `npm run data:fetch`, or pass --lenient to build names only.');
  }

  const requestedSeason = options.season ? Number(options.season) : undefined;
  if (requestedSeason !== undefined && !Number.isInteger(requestedSeason)) {
    fail(`--season takes a dungeon id, not ${String(options.season)}.`);
  }
  const common = readCommonData(requestedSeason);
  if (!common && !lenient) {
    fail(
      requestedSeason === undefined
        ? 'mirror-dungeon-common-data is missing from data/raw/static.'
        : `data/raw/static has no mirror-dungeon-common-data for season ${requestedSeason}. ` +
            `On disk: ${listSeasons().join(', ') || 'none'}.`,
    );
  }
  /**
   * `data/raw/static` is one season's snapshot: its packs, floors and pools are the newest season's.
   * Building an older season from it would write that data under the frozen season's name
   * (M160, A14) — refused unless `--force-frozen` says that is meant.
   */
  const frozenRefusal = frozenSeasonRefusal(
    requestedSeason,
    readCommonData()?.data.currentDungeonId,
    options.forceFrozen,
  );
  if (frozenRefusal) fail(frozenRefusal);

  const dungeonId = common?.data.currentDungeonId ?? requestedSeason;
  if (dungeonId === undefined) {
    // Only reachable with --lenient and no snapshot: nothing says which season this is.
    fail('no mirror-dungeon-common-data on disk says which season to build. Pass --season <n>.');
  }

  /**
   * Per-season constants no source ships. The floors a season opens live here because they are a
   * game rule, not a derivation: Mirror Dungeon 8 is expected to open 1~5 before the rest. A season
   * with no file is a full 1~15 one built entirely from its own raw data.
   *
   * Parsed through `curatedSeasonSchema`, which is strict: an unknown key stops the build instead of
   * being ignored. The file used to be read as `{ [key: string]: unknown }`, so a typo — or a key
   * this pipeline never had, like a per-pack gift pool — did nothing at all and said nothing either.
   */
  const curatedSeasonPath = repoPath(`data/curated/seasons/md${dungeonId}/rules.json`);
  const curatedSeason = ((): CuratedSeason => {
    const raw = readJsonIfExists<unknown>(curatedSeasonPath);
    if (raw === null) return {};
    const parsed = curatedSeasonSchema.safeParse(raw);
    if (!parsed.success) {
      fail(
        `data/curated/seasons/md${dungeonId}/rules.json does not match curatedSeasonSchema:\n` +
          parsed.error.issues
            .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n'),
      );
    }
    return parsed.data;
  })();

  const combineTable = common?.data.egoGiftCombineFixedTable ?? {};
  const hardOnlyIds = new Set(combineTable.nonAcquireableInEasyIds ?? []);
  const dropPool = readDropPool(dungeonId);
  const stages = readStages();
  const observation = readObservationData(dungeonId);

  const staticPacks = readThemePacks();
  const staticGifts = readGiftStatics();

  /**
   * The owner's stand-in pool for a backfilled pack (`backfillAssumptions.generalPool`): every gift
   * some static pack drops as a general gift, i.e. in a general pool and exclusive to no pack.
   */
  function assumedGeneralPool(): number[] | null {
    if (curatedSeason.backfillAssumptions?.generalPool !== 'allGeneral') return null;
    const exclusive = new Set(staticPacks.flatMap((pack) => pack.specificEgoGiftPool ?? []));
    const general = new Set(staticPacks.flatMap((pack) => pack.egoGiftPool ?? []));
    return sortNums([...general].filter((id) => !exclusive.has(id)));
  }

  /**
   * Packs and gifts the static data has not shipped, synthesised from the derived mirror.
   *
   * OpenLethe's Mirror Dungeon capture is frozen, so a new season will never reach it. Rather than
   * plan a season the game no longer runs, the build takes what the living source knows and shapes it
   * like the static records, so every step below is unchanged. The hidden pack is skipped: it cannot
   * be chosen or observed, so putting it in the roster would invent a route nobody can take.
   *
   * What this cannot supply is each pack's *general* gift pool. Nothing is guessed — the pack simply
   * has no pool, and `validate-data` refuses to let that pass quietly.
   */
  const backfilledPacks = (() => {
    if (!derivedMdPresent()) return [] as ReturnType<typeof derivedPackAsRaw>[];
    const known = new Set(staticPacks.map((pack) => pack.id));
    const hiddenPackId = (curated.rules.hiddenPack as { id?: number } | undefined)?.id;
    const derived = readDerivedPacks();
    const assumedPool = assumedGeneralPool();
    return [...readDerivedAvailability()]
      .filter(([id]) => !known.has(id) && id !== hiddenPackId)
      .map(([id, floors]) => ({
        ...derivedPackAsRaw(id, derived.get(id) ?? {}, floors),
        ...(assumedPool ? { egoGiftPool: assumedPool } : {}),
      }));
  })();

  const rawPacks = [...staticPacks, ...backfilledPacks];

  /** English names for backfilled content, used only where the localization has nothing yet. */
  const derivedPackNames = derivedMdPresent() ? readDerivedPacks() : new Map();
  const derivedGiftNames = derivedMdPresent() ? readDerivedGifts() : new Map();
  const derivedPackName = (id: number): string | undefined => derivedPackNames.get(id)?.name;
  const derivedGiftName = (id: number): string | undefined => derivedGiftNames.get(id)?.names?.[0];

  const backfilledGiftIds = new Set(backfilledPacks.flatMap((pack) => pack.specificEgoGiftPool ?? []));
  const backfilledGifts = (() => {
    if (backfilledGiftIds.size === 0) return [] as ReturnType<typeof derivedGiftAsRaw>[];
    const known = new Set(staticGifts.map((gift) => gift.id));
    const derived = readDerivedGifts();
    return [...backfilledGiftIds]
      .filter((id) => !known.has(id) && derived.has(id))
      .map((id) => derivedGiftAsRaw(id, derived.get(id)!));
  })();

  const rawGifts = [...staticGifts, ...backfilledGifts];
  if (backfilledPacks.length > 0) {
    console.log(
      `  backfilled from the derived mirror: ${backfilledPacks.length} pack(s), ${backfilledGifts.length} gift(s)`,
    );
  }
  const rawPersonalities = readPersonalities();
  const skills = readPersonalitySkills();

  const giftTextKo = readGiftTexts('KR');
  const giftTextEn = readGiftTexts('EN');
  const themeNameKo = readThemeNames('KR');
  const themeNameEn = readThemeNames('EN');
  const personalityKo = readPersonalityTexts('KR');
  const personalityEn = readPersonalityTexts('EN');
  const factionKo = readFactionNames('KR');
  const factionEn = readFactionNames('EN');
  const categoryKo = readGiftCategoryNames('KR');
  const categoryEn = readGiftCategoryNames('EN');
  const lockedDesc = readLockedDescs();

  /** Korean skill text, the only place a consumed keyword (혈찬) is stated. */
  const localizedSkills = readLocalizedPersonalitySkills('KR');
  /** 특수 variant buff ids (생체 재료 → 특수 충전 …), read off the game's own buff descriptions. */
  const specialVariants = readSpecialVariants();
  /** Buff names, for `buffs` (M129: a text id counts only when the game names it) and the enums. */
  const battleKeywordKo = readBattleKeywordNames('KR');
  // 탄환 has no gift category row, so its name comes from the battle keywords instead.
  const battleKeywordEn = readBattleKeywordNames('EN');
  const knownBuffIds = new Set(battleKeywordKo.keys());
  const passiveTexts = readPassiveTexts();
  const battlePassiveIds = readBattlePassiveIds();
  /** The community mirror's identity rows, for the ones the static data does not ship. */
  const derivedIdentitySource = readDerivedIdentities();

  const lock = readLock();
  // Read from the raw text, before the buff ids are written out as names: an `identityBuff` stores ids.
  const curatedEffects = readCuratedGiftEffects(repoPath('data/curated/gift-effects.json'));
  if (curatedEffects.errors.length > 0)
    fail(`data/curated/gift-effects.json: ${curatedEffects.errors.join(' | ')}`);
  const captureLayout = readJson<unknown>(CAPTURE_LAYOUT_CURATED);

  return {
    options,
    curated,
    hasStatic,
    common,
    dungeonId,
    curatedSeason,
    combineTable,
    hardOnlyIds,
    dropPool,
    stages,
    observation,
    staticPacks,
    staticGifts,
    backfilledPacks,
    rawPacks,
    derivedPackName,
    derivedGiftName,
    backfilledGiftIds,
    backfilledGifts,
    rawGifts,
    rawPersonalities,
    skills,
    giftTextKo,
    giftTextEn,
    themeNameKo,
    themeNameEn,
    personalityKo,
    personalityEn,
    factionKo,
    factionEn,
    categoryKo,
    categoryEn,
    lockedDesc,
    localizedSkills,
    specialVariants,
    battleKeywordKo,
    battleKeywordEn,
    knownBuffIds,
    passiveTexts,
    battlePassiveIds,
    derivedIdentitySource,
    lock,
    curatedEffects,
    captureLayout,
  };
}

export type Sources = ReturnType<typeof loadSources>;
