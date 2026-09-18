/**
 * data/raw + data/curated  ->  public/data
 *
 *   npm run data:build
 *   npm run data:build -- --season 7  build that season instead of the newest on disk
 *   npm run data:build -- --lenient   tolerate missing static data (names only, tiers null)
 *
 * The output is split by what a Mirror Dungeon season owns. `gifts`, `packs`, `rules` and `meta`
 * go to `public/data/md{n}/`, because a season replaces the gift pool rather than adding to it.
 * `identities` and `enums` stay at the root: neither looks at the dungeon, so every season shares
 * them and they keep getting new identities without rebuilding a frozen season.
 *
 * Only the season the vendored raw data describes is rebuilt. Older seasons stay on disk exactly
 * as committed — OpenLethe's capture moves on and cannot produce them again — and `index.json`
 * lists whatever is there.
 *
 * Output is deterministic: object keys are sorted on write and every array is sorted explicitly,
 * so regenerating without an input change produces no diff. CI enforces that.
 */
import { createHash } from 'node:crypto';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { flagValue, hasFlag, readJson, readJsonIfExists, repoPath, writeJsonStable } from './lib/io.ts';
import { localizeBuffTokens } from './lib/battle-keywords.ts';
import {
  SIN_BY_COLOR,
  listSeasons,
  readCommonData,
  readDropPool,
  readFactionNames,
  readGiftCategoryNames,
  readGiftStatics,
  readGiftTexts,
  readLockedDescs,
  readObservationData,
  readPersonalities,
  readPersonalitySkills,
  readBattleKeywordNames,
  readPersonalityTexts,
  readLocalizedPersonalitySkills,
  readSpecialVariants,
  readStages,
  readThemeNames,
  readThemePacks,
  staticDataPresent,
  LOCALIZE_DIR,
  STATIC_DIR,
} from './lib/raw.ts';
import {
  affinitiesFromDevName,
  availabilityFor,
  cleanFactionName,
  deriveIdentityKeywords,
  groupForPackId,
  sinnerIdFromIdentityId,
  tierFromTags,
  deriveUpgradeOf,
} from './lib/derive.ts';
import { OUT, seasonDir } from './lib/out.ts';
import { parseConditions } from './lib/parse-conditions.ts';
import { deriveIdentityKeywordsFromText, skillsOfIdentity } from './lib/derive-text.ts';
import { DERIVED_DIR } from './lib/derived-source.ts';
import {
  derivedGiftAsRaw,
  derivedMdPresent,
  derivedPackAsRaw,
  readDerivedAvailability,
  readDerivedGifts,
  readDerivedPacks,
} from './lib/derived-md.ts';
import {
  derivedAttackTypes,
  derivedFactions,
  derivedAttackSkillIds,
  derivedSins,
  readDerivedIdentities,
} from './lib/derived-source.ts';
import {
  IDENTITY_KEYWORDS,
  KEYWORDS,
  STATUS_KEYWORDS,
  SINS,
  type AcquisitionKind,
  type Condition,
  type Enums,
  type Gift,
  type Identity,
  type Localized,
  type Meta,
  metaSchema,
  rulesSchema,
  type Rules,
  type SeasonEntry,
  type Sin,
  type ThemePack,
} from '../src/core/schema.ts';

const lenient = hasFlag('--lenient');

function fail(message: string): never {
  console.error(`build-data: ${message}`);
  process.exit(1);
}

function loc(ko: string | undefined, en: string | undefined): Localized {
  return { ko: (ko ?? '').trim(), en: (en ?? '').trim() };
}

function sortNums(xs: Iterable<number>): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Curated overrides
// ---------------------------------------------------------------------------

interface CuratedRules {
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
interface CuratedIdentity {
  _source?: string;
  keywords?: Record<string, { skills: number; specialSkills: number }>;
  rank?: number;
  season?: number;
  factions?: string[];
  traits?: string[];
  sins?: string[];
  attackTypes?: string[];
}

const curated = {
  rules: readJsonIfExists<CuratedRules>(repoPath('data/curated/rules.json')) ?? {},
  factions:
    readJsonIfExists<Record<string, { ko?: string; en?: string }>>(repoPath('data/curated/factions.json')) ??
    {},
  identityKeywords:
    readJsonIfExists<Record<string, { keywords?: Record<string, { skills: number; specialSkills: number }> }>>(
      repoPath('data/curated/identity-keywords.json'),
    ) ?? {},
  identities: readJsonIfExists<Record<string, CuratedIdentity>>(repoPath('data/curated/identities.json')) ?? {},
  conditions:
    readJsonIfExists<Record<string, { conditions?: Condition[] }>>(
      repoPath('data/curated/conditions.json'),
    ) ?? {},
  names:
    readJsonIfExists<{
      gifts?: Record<string, Partial<Localized>>;
      packs?: Record<string, Partial<Localized>>;
      identities?: Record<string, Partial<Localized>>;
    }>(repoPath('data/curated/names-override.json')) ?? {},
  notes:
    readJsonIfExists<{ gifts?: Record<string, Localized>; packs?: Record<string, Localized> }>(
      repoPath('data/curated/notes.json'),
    ) ?? {},
};

/** Curated files use `_`-prefixed keys for comments and examples; they are never data. */
function curatedEntries<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).filter(([key]) => !key.startsWith('_'));
}

function applyNameOverride(base: Localized, override: Partial<Localized> | undefined): Localized {
  if (!override) return base;
  return { ko: override.ko ?? base.ko, en: override.en ?? base.en };
}

// ---------------------------------------------------------------------------
// Load sources
// ---------------------------------------------------------------------------

const hasStatic = staticDataPresent();
if (!hasStatic && !lenient) {
  fail('data/raw/static is missing. Run `npm run data:fetch`, or pass --lenient to build names only.');
}

const requestedSeason = flagValue('--season') ? Number(flagValue('--season')) : undefined;
if (requestedSeason !== undefined && !Number.isInteger(requestedSeason)) {
  fail(`--season takes a dungeon id, not ${String(flagValue('--season'))}.`);
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

const dungeonId = common?.data.currentDungeonId ?? requestedSeason ?? 7;

/**
 * Per-season constants no source ships. The floors a season opens live here because they are a
 * game rule, not a derivation: Mirror Dungeon 8 is expected to open 1~5 before the rest. A season
 * with no file is a full 1~15 one built entirely from its own raw data.
 */
interface CuratedSeason {
  floors?: Rules['floors'];
  provisional?: boolean;
  [key: string]: unknown;
}
const curatedSeason =
  readJsonIfExists<CuratedSeason>(repoPath(`data/curated/seasons/md${dungeonId}/rules.json`)) ?? {};

/** What a Mirror Dungeon has opened since MD5, used when a season records nothing of its own. */
const DEFAULT_FLOORS: Rules['floors'] = {
  normal: [1, 2, 3, 4, 5],
  hard: [1, 2, 3, 4, 5],
  parallel: [6, 7, 8, 9, 10],
  extreme: [11, 12, 13, 14, 15],
};

const combineTable = common?.data.egoGiftCombineFixedTable ?? {};
const hardOnlyIds = new Set(combineTable.nonAcquireableInEasyIds ?? []);
const dropPool = readDropPool(dungeonId);
const stages = readStages();
const observation = readObservationData(dungeonId);

const staticPacks = readThemePacks();
const staticGifts = readGiftStatics();

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
  return [...readDerivedAvailability()]
    .filter(([id]) => !known.has(id) && id !== hiddenPackId)
    .map(([id, floors]) => derivedPackAsRaw(id, derived.get(id) ?? {}, floors));
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

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

const factionIds = new Set<string>();
for (const p of rawPersonalities) for (const id of p.associationList ?? []) factionIds.add(id);
for (const [id] of curatedEntries(curated.factions)) factionIds.add(id);

const factionNameById = new Map<string, Localized>();
const factionDeprecated = new Set<string>();
const unnamedFactions: string[] = [];

for (const id of [...factionIds].sort()) {
  const override = curated.factions[id];
  const rawKo = factionKo.get(id);
  const rawEn = factionEn.get(id);
  const ko = override?.ko ?? (rawKo ? cleanFactionName(rawKo).name : '');
  const en = override?.en ?? (rawEn ? cleanFactionName(rawEn).name : '');
  if (rawKo && cleanFactionName(rawKo).deprecated) factionDeprecated.add(id);
  if (!ko) unnamedFactions.push(id);
  factionNameById.set(id, { ko: ko || id, en: en || ko || id });
}

/** Korean display name -> faction id, for the condition parser. Longest names win on collision. */
const factionIdByName = new Map<string, string>();
for (const [id, name] of [...factionNameById].sort((a, b) => b[1].ko.length - a[1].ko.length)) {
  if (name.ko && !factionIdByName.has(name.ko)) factionIdByName.set(name.ko, id);
}
// Trait-only names (엄지, 거미집 …) also appear in condition text, so accept them too.
for (const [id, raw] of factionKo) {
  const { name } = cleanFactionName(raw);
  if (name && !factionIdByName.has(name)) factionIdByName.set(name, id);
}

// ---------------------------------------------------------------------------
// Theme packs
// ---------------------------------------------------------------------------

const packs: ThemePack[] = rawPacks
  .map((raw): ThemePack => {
    const devName = (raw.desc ?? '').trim();
    const availability = availabilityFor(raw);
    const exclusives = sortNums(raw.specificEgoGiftPool ?? []);
    const affinity = affinitiesFromDevName(devName);
    const group = groupForPackId(raw.id);
    const notes = curated.notes.packs?.[String(raw.id)];
    return {
      id: raw.id,
      // A pack the static data has not shipped may also be missing from the localization for a few
      // days after a patch; the derived source's English name keeps it from being nameless.
      name: applyNameOverride(
        loc(
          themeNameKo.get(raw.id) ?? derivedPackName(raw.id) ?? devName,
          themeNameEn.get(raw.id) ?? derivedPackName(raw.id) ?? devName,
        ),
        curated.names.packs?.[String(raw.id)],
      ),
      devName,
      group,
      availability,
      selectable: Object.values(availability).some((floors) => floors.length > 0),
      // The in-game pool is the union: `specificEgoGiftPool` entries are not repeated in `egoGiftPool`.
      giftPool: sortNums([...(raw.egoGiftPool ?? []), ...exclusives]),
      exclusiveGifts: exclusives,
      keywordAffinity: group === 'keyword' ? affinity.keyword : null,
      sinAffinity: group === 'sin' ? affinity.sin : null,
      attackTypeAffinity: group === 'attackType' ? affinity.attackType : null,
      bossIds: sortNums(raw.mapGenOption?.bossPool ?? []),
      sprite: raw.uiConfigs?.packSpriteId ?? String(raw.id),
      ...(notes ? { notes } : {}),
    };
  })
  .sort((a, b) => a.id - b.id);

const selectablePacks = packs.filter((p) => p.selectable);

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

const packsByGift = new Map<number, number[]>();
const exclusiveByGift = new Map<number, number[]>();
for (const pack of selectablePacks) {
  for (const giftId of pack.giftPool) {
    const list = packsByGift.get(giftId) ?? [];
    list.push(pack.id);
    packsByGift.set(giftId, list);
  }
  for (const giftId of pack.exclusiveGifts) {
    const list = exclusiveByGift.get(giftId) ?? [];
    list.push(pack.id);
    exclusiveByGift.set(giftId, list);
  }
}

/** Fixed recipes, keyed by result. `requiredEgoGiftIds` is the real ingredient list. */
const recipesByResult = new Map<number, number[][]>();
for (const entry of combineTable.combineFixed ?? []) {
  const ingredients = [...(entry.requiredEgoGiftIds ?? [])].sort((a, b) => a - b);
  if (ingredients.length < 2) continue;
  const list = recipesByResult.get(entry.resultEgoGiftId) ?? [];
  if (!list.some((existing) => existing.join(',') === ingredients.join(','))) list.push(ingredients);
  recipesByResult.set(entry.resultEgoGiftId, list);
}

const mixedByResult = new Map<number, Gift['fusion']>();
for (const entry of combineTable.combineMixed ?? []) {
  mixedByResult.set(entry.resultEgoGiftId, {
    recipes: [],
    mixed: {
      aPool: sortNums(entry.aEgoGiftIds),
      aCount: entry.aEgoGiftRequiredNum,
      bPool: sortNums(entry.bEgoGiftIds),
      bCount: entry.bEgoGiftRequiredNum,
    },
  });
}

const startKeywordByGift = new Map<number, string>();
for (const pool of common?.data.startEgoGiftPools ?? []) {
  for (const giftId of [...(pool.normalpool ?? []), ...(pool.buffpool ?? [])]) {
    if (!startKeywordByGift.has(giftId)) startKeywordByGift.set(giftId, pool.keyword);
  }
}

/** Gift ids a stage's boss hands out on clear (`rewardList` entries of type EGO_GIFT). */
function stageRewardGifts(stageId: number): number[] {
  return sortNums(
    (stages.get(stageId)?.rewardList ?? [])
      .filter((r) => r.type === 'EGO_GIFT' && typeof r.rewardId === 'number')
      .map((r) => r.rewardId as number),
  );
}

/**
 * 클리어 보상: an EXTREME pack's boss stage (`mapGenOption.bossPool`) drops a fixed gift. The link
 * only exists through the stage files, so it is derived here rather than read off the gift.
 * Rewards without any text (993005 on the N사 boss-rush packs) are placeholders and skipped.
 */
const clearRewardPackByGift = new Map<number, number>();
for (const pack of selectablePacks) {
  if (pack.availability.extreme.length === 0) continue;
  for (const stageId of pack.bossIds) {
    for (const giftId of stageRewardGifts(stageId)) {
      if (!giftTextKo.has(giftId)) continue;
      if (!clearRewardPackByGift.has(giftId)) clearRewardPackByGift.set(giftId, pack.id);
    }
  }
}

/** 히든 전투: a random battle on EXTREME floors whose stages drop their own gifts. */
const hiddenBattleInfo = common?.data.hiddenBattleInfo;
const hiddenBattleGifts = new Set(
  (hiddenBattleInfo?.pool ?? []).flatMap((stageId) => stageRewardGifts(stageId)).filter((id) => giftTextKo.has(id)),
);

/** What 기프트 관측 can offer this season; the data lists eligible gifts explicitly. */
const observableIds = new Set(
  (observation?.observationEgoGiftDataList ?? []).flatMap((entry) => entry.egogiftIdList ?? []),
);
for (const id of observation?.unobservableEgoGiftIds ?? []) observableIds.delete(id);

/**
 * Everything the season can hand out. `excludeEgoGifts` does NOT mean unobtainable — it removes a
 * gift from the *generic* reward roll because it has its own path (pack-exclusive, fusion, or a
 * specific choice event), so the two sets are tracked separately.
 */
const dropPoolIds = new Set(dropPool?.egoGifts ?? []);
const materialIds = new Set(common?.data.pieceEgoGiftIds ?? []);

/** Gifts the game itself describes as shop-fusion-only, a cross-check on the recipe table. */
const fusionOnlyByLockedDesc = new Set(
  [...lockedDesc].filter(([, text]) => text.includes('합성')).map(([id]) => id),
);

const giftStaticById = new Map<number, (typeof rawGifts)[number]>();
for (const g of rawGifts) if (!giftStaticById.has(g.id)) giftStaticById.set(g.id, g);

/** Every gift the Mirror Dungeon can present this season, from any angle. */
const giftIds = new Set<number>([
  ...dropPoolIds,
  ...packsByGift.keys(),
  ...exclusiveByGift.keys(),
  ...recipesByResult.keys(),
  ...mixedByResult.keys(),
  ...startKeywordByGift.keys(),
  ...clearRewardPackByGift.keys(),
  ...hiddenBattleGifts,
  ...hardOnlyIds,
  ...(common?.data.pieceEgoGiftIds ?? []),
]);
for (const recipe of recipesByResult.values()) {
  for (const ingredients of recipe) for (const id of ingredients) giftIds.add(id);
}
for (const fusion of mixedByResult.values()) {
  for (const id of [...(fusion?.mixed?.aPool ?? []), ...(fusion?.mixed?.bPool ?? [])]) giftIds.add(id);
}

const generalShare = curated.rules.generalGiftPackShare ?? 0.6;

const missingText: number[] = [];
let unparsedConditionCount = 0;

const gifts: Gift[] = [...giftIds]
  .sort((a, b) => a - b)
  .map((id): Gift => {
    const stat = giftStaticById.get(id);
    const ko = giftTextKo.get(id);
    const en = giftTextEn.get(id);
    if (!ko) missingText.push(id);

    const tags = [...(stat?.tag ?? [])].sort();
    const packList = sortNums(packsByGift.get(id) ?? []);
    const exclusiveList = sortNums(exclusiveByGift.get(id) ?? []);
    const recipes = recipesByResult.get(id) ?? [];
    const mixed = mixedByResult.get(id);

    /**
     * The game's own taxonomy: a gift listed in some pack's `specificEgoGiftPool` is 테마 팩 한정,
     * anything else that drops from pack pools is a general drop, and a fixed-recipe result is
     * fusion-only (those never appear in a pool). The planner decides how hard a general gift is
     * to get from `acquisition.packs.length`, not from this label.
     */
    const clearRewardOf = clearRewardPackByGift.get(id) ?? null;
    let kind: AcquisitionKind;
    if (exclusiveList.length > 0) kind = 'packLimited';
    else if (clearRewardOf !== null) kind = 'clearReward';
    else if (packList.length > 0) kind = 'general';
    else if (recipes.length > 0 || mixed) kind = 'fusionOnly';
    // The game's own "획득 조건: 상점 「E.G.O 기프트 합성」" text catches fusion results whose
    // recipe we failed to read.
    else if (fusionOnlyByLockedDesc.has(id)) kind = 'fusionOnly';
    else if (startKeywordByGift.has(id)) kind = 'startOnly';
    else if (materialIds.has(id)) kind = 'material';
    else if (hiddenBattleGifts.has(id)) kind = 'hiddenBattle';
    else if (dropPoolIds.has(id)) kind = 'event';
    else kind = 'unknown';

    const desc = loc(ko?.desc, en?.desc);
    const curatedCondition = curated.conditions[String(id)];
    let conditions: Condition[];
    if (curatedCondition?.conditions) {
      conditions = curatedCondition.conditions;
    } else {
      const parsed = parseConditions(desc, { factionIdByName });
      conditions = parsed.conditions;
      unparsedConditionCount += parsed.unparsedCount;
    }

    const startKeyword = startKeywordByGift.get(id);
    const notes = curated.notes.gifts?.[String(id)];
    const rawKeyword = stat?.keyword;
    const keyword = (KEYWORDS as readonly string[]).includes(rawKeyword ?? '')
      ? (rawKeyword as Gift['keyword'])
      : 'None';

    return {
      id,
      name: applyNameOverride(
        loc(ko?.name ?? derivedGiftName(id), en?.name ?? ko?.name ?? derivedGiftName(id)),
        curated.names.gifts?.[String(id)],
      ),
      desc,
      keyword,
      tier: stat ? tierFromTags(tags) : null,
      sin: stat?.attributeType ? (SIN_BY_COLOR[stat.attributeType] ?? null) : null,
      price: typeof stat?.price === 'number' ? stat.price : null,
      upgradeLevels: Math.min(2, Math.max(0, (stat?.upgradeDataList?.length ?? 1) - 1)) as 0 | 1 | 2,
      tags,
      hardOnly: hardOnlyIds.has(id),
      obtainable:
        dropPoolIds.has(id) ||
        materialIds.has(id) ||
        recipes.length > 0 ||
        Boolean(mixed) ||
        clearRewardOf !== null ||
        hiddenBattleGifts.has(id),
      observable: observableIds.has(id),
      icon: stat?.iconId ?? id,
      acquisition: {
        kind,
        // A clear reward has exactly one source: the pack whose boss drops it.
        packs: clearRewardOf !== null ? [clearRewardOf] : packList,
        exclusiveTo: exclusiveList,
        clearRewardOf,
        startKeyword:
          startKeyword && (KEYWORDS as readonly string[]).includes(startKeyword)
            ? (startKeyword as Gift['keyword'])
            : null,
      },
      fusion:
        recipes.length > 0 || mixed
          ? {
              recipes: recipes
                .map((ingredients) => ({ ingredients }))
                .sort(
                  (a, b) =>
                    a.ingredients.length - b.ingredients.length || a.ingredients[0]! - b.ingredients[0]!,
                ),
              ...(mixed?.mixed ? { mixed: mixed.mixed } : {}),
            }
          : null,
      conditions,
      upgradeOf: null,
      ...(notes ? { notes } : {}),
    };
  });

// 조합 계승: a lower-tier ingredient that feeds exactly one same-keyword result points at it.
const upgradeOfById = deriveUpgradeOf(
  recipesByResult,
  new Map(gifts.map((g) => [g.id, { keyword: g.keyword, tier: g.tier }])),
);
for (const gift of gifts) gift.upgradeOf = upgradeOfById.get(gift.id) ?? null;

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const SINNER_NAMES: Localized[] = [];
for (let sinner = 1; sinner <= 12; sinner += 1) {
  const baseId = 10000 + sinner * 100 + 1;
  SINNER_NAMES[sinner] = loc(personalityKo.get(baseId)?.name, personalityEn.get(baseId)?.name);
}

/** 특수 variant buff ids (생체 재료 → 특수 충전 …), read off the game's own buff descriptions. */
const specialVariants = readSpecialVariants();

const derivedIdentities: Identity[] = rawPersonalities
  .map((raw): Identity => {
    const sinnerId = sinnerIdFromIdentityId(raw.id);
    const curatedKeywords = curated.identityKeywords[String(raw.id)]?.keywords;
    const derived = deriveIdentityKeywords(raw, skills, specialVariants);
    const keywords = (curatedKeywords ?? derived) as Identity['keywords'];
    const keywordSource: Identity['keywordSource'] = curatedKeywords
      ? 'curated'
      : Object.keys(derived).length > 0
        ? 'derived'
        : 'none';

    const sins = new Set<Identity['sins'][number]>();
    const attackTypes = new Set<Identity['attackTypes'][number]>();
    for (const entry of raw.attributeList ?? []) {
      const data = skills.get(entry.skillId)?.skillData?.[0];
      const sin = data?.attributeType ? SIN_BY_COLOR[data.attributeType] : undefined;
      if (sin) sins.add(sin);
      switch (data?.atkType) {
        case 'SLASH':
          attackTypes.add('Slash');
          break;
        case 'PENETRATE':
          attackTypes.add('Penetrate');
          break;
        case 'HIT':
          attackTypes.add('Hit');
          break;
        default:
          break;
      }
    }

    const title = loc(
      personalityKo.get(raw.id)?.title?.replace(/\s*\n\s*/g, ' '),
      personalityEn.get(raw.id)?.title?.replace(/\s*\n\s*/g, ' '),
    );

    return {
      id: raw.id,
      sinnerId,
      sinner: SINNER_NAMES[sinnerId] ?? loc('', ''),
      title: applyNameOverride(title, curated.names.identities?.[String(raw.id)]),
      rank: Math.min(3, Math.max(1, raw.rank ?? 1)) as 1 | 2 | 3,
      season: raw.season ?? 0,
      factions: [...(raw.associationList ?? [])].sort(),
      traits: [...(raw.unitKeywordList ?? [])].sort(),
      keywords,
      keywordSource,
      sins: [...sins].sort((a, b) => SINS.indexOf(a) - SINS.indexOf(b)),
      attackTypes: [...attackTypes].sort(),
    };
  });

// ---------------------------------------------------------------------------
// Identities the static data does not ship
//
// Three sources, in descending order of authority: the game's own static records (above), the
// derived mirror plus the Korean skill text (here), and finally a row written by hand. Each layer
// only fills what the one above it does not have, and the build stops if a lower layer shadows a
// higher one — a stopgap must never outlive the real data.
// ---------------------------------------------------------------------------

const staticIdentityIds = new Set(derivedIdentities.map((identity) => identity.id));
const derivedSource = readDerivedIdentities();
const localizedSkills = readLocalizedPersonalitySkills('KR');

/** English faction names inverted, so a derived tag can be read back as the id the app uses. */
const factionIdByEnglishName = new Map<string, string>();
for (const [id, name] of readFactionNames('EN')) if (!factionIdByEnglishName.has(name)) factionIdByEnglishName.set(name, id);
const knownFactionIds = new Set<string>(
  rawPersonalities.flatMap((raw) => raw.associationList ?? []).concat(curatedEntries(curated.factions).map(([id]) => id)),
);

function titleFor(id: number): Localized {
  return applyNameOverride(
    loc(
      personalityKo.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
      personalityEn.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
    ),
    curated.names.identities?.[String(id)],
  );
}

/**
 * An identity assembled from the derived mirror and the Korean skill text.
 *
 * The mirror lists the base attack skills outright, so the keyword derivation is told which skills
 * to read rather than guessing; the Korean text is what actually names the keywords, because the
 * mirror's own list is the weaker of the two.
 */
const backfilledIdentities: Identity[] = [...derivedSource.entries()]
  .filter(([id]) => !staticIdentityIds.has(id) && sinnerIdFromIdentityId(id) >= 1 && sinnerIdFromIdentityId(id) <= 12)
  .filter(([id]) => personalityKo.has(id))
  .map(([id, entry]): Identity => {
    const sinnerId = entry.sinnerId ?? sinnerIdFromIdentityId(id);
    const attackIds = derivedAttackSkillIds(entry);
    const skills = skillsOfIdentity(id, localizedSkills);
    const keywords = deriveIdentityKeywordsFromText(
      skills,
      specialVariants,
      attackIds.length > 0 ? attackIds : undefined,
    ) as Identity['keywords'];
    return {
      id,
      sinnerId,
      sinner: SINNER_NAMES[sinnerId] ?? loc('', ''),
      title: titleFor(id),
      rank: Math.min(3, Math.max(1, entry.rank ?? 1)) as 1 | 2 | 3,
      season: entry.season ?? 0,
      factions: derivedFactions(entry, factionIdByEnglishName, knownFactionIds).sort(),
      // The derived tags carry no size or appearance traits, and nothing reads them anyway.
      traits: [],
      keywords,
      keywordSource: 'backfilled',
      sins: derivedSins(entry).sort((a, b) => SINS.indexOf(a) - SINS.indexOf(b)),
      attackTypes: derivedAttackTypes(entry).sort(),
    };
  })
  .sort((a, b) => a.id - b.id);

const backfilledIds = new Set(backfilledIdentities.map((identity) => identity.id));

/** The last resort: a row written by hand for an identity no source has yet. */
const curatedIdentities: Identity[] = curatedEntries(curated.identities).map(([key, entry]) => {
  const id = Number(key);
  if (!Number.isFinite(id)) fail(`curated identity key "${key}" is not an id`);
  if (staticIdentityIds.has(id)) {
    fail(
      `curated identity ${id} now has static data upstream; ` +
        `delete its entry from data/curated/identities.json so the real record is used`,
    );
  }
  if (backfilledIds.has(id)) {
    fail(
      `curated identity ${id} is now covered by the derived source; ` +
        `delete its entry from data/curated/identities.json so the fetched data is used`,
    );
  }
  const sinnerId = sinnerIdFromIdentityId(id);
  const title = loc(
    personalityKo.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
    personalityEn.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
  );
  if (!title.ko) fail(`curated identity ${id} is not in the localization either; there is nothing to name it`);
  return {
    id,
    sinnerId,
    sinner: SINNER_NAMES[sinnerId] ?? loc('', ''),
    title: applyNameOverride(title, curated.names.identities?.[key]),
    rank: Math.min(3, Math.max(1, entry.rank ?? 1)) as 1 | 2 | 3,
    season: entry.season ?? 0,
    factions: [...(entry.factions ?? [])].sort(),
    traits: [...(entry.traits ?? [])].sort(),
    keywords: (entry.keywords ?? {}) as Identity['keywords'],
    keywordSource: 'curated',
    sins: [...(entry.sins ?? [])].sort((a, b) => SINS.indexOf(a as Sin) - SINS.indexOf(b as Sin)) as Identity['sins'],
    attackTypes: [...(entry.attackTypes ?? [])].sort() as Identity['attackTypes'],
  };
});

const identities: Identity[] = [...derivedIdentities, ...backfilledIdentities, ...curatedIdentities].sort(
  (a, b) => a.id - b.id,
);

// ---------------------------------------------------------------------------
// Enums and rules
// ---------------------------------------------------------------------------

const statusSet = new Set<string>(STATUS_KEYWORDS);
const giftKeywordSet = new Set<string>(KEYWORDS);
// 탄환 has no gift category row, so its name comes from the battle keywords instead.
const battleKeywordKo = readBattleKeywordNames('KR');
const battleKeywordEn = readBattleKeywordNames('EN');

const enums: Enums = {
  keywords: KEYWORDS.map((id) => ({
    id,
    name: loc(categoryKo.get(id) ?? id, categoryEn.get(id) ?? id),
    status: statusSet.has(id),
  })),
  identityOnlyKeywords: IDENTITY_KEYWORDS.filter((id) => !giftKeywordSet.has(id)).map((id) => ({
    id,
    name: loc(battleKeywordKo.get(id) ?? id, battleKeywordEn.get(id) ?? id),
  })),
  factions: [...factionNameById]
    .map(([id, name]) => ({ id, name, deprecated: factionDeprecated.has(id) }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  sinners: SINNER_NAMES.flatMap((name, id) => (id >= 1 ? [{ id, name }] : [])),
  sins: [...SINS],
};

const starlight = common?.data.starlightInfo;
const tierScores: Record<string, number> = {};
for (const row of common?.data.egoGiftCombineTierTable?.combineScoreByEgoGiftTier ?? []) {
  tierScores[String(row.egoGiftTier)] = row.combineScore;
}
const upgradeCostByTier: Record<string, number[]> = {};
for (const row of common?.data.egoGiftUpgradeCostTable?.table ?? []) {
  upgradeCostByTier[String(row.tier)] = row.cost;
}
const probByCount = (rows: { materialCount: number; prob: number }[] | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const row of rows ?? []) out[String(row.materialCount)] = row.prob;
  return out;
};

const startPoolsByKeyword: Record<string, number[]> = {};
for (const pool of common?.data.startEgoGiftPools ?? []) {
  if (!(KEYWORDS as readonly string[]).includes(pool.keyword)) continue;
  startPoolsByKeyword[pool.keyword] = sortNums([...(pool.normalpool ?? []), ...(pool.buffpool ?? [])]);
}

const rules: Rules = {
  dungeonId,
  floors: curatedSeason.floors ?? DEFAULT_FLOORS,
  difficulty: { hardIsSticky: true, parallelRequiresAllHard: true, extremeAllowsObservation: false },
  deployment: curated.rules.deployment ?? { max: 6, default: 6, verified: false },
  themePacksOfferedPerFloor: common?.data.themePoolNum ?? 3,
  themePackRefreshCount: common?.data.themePoolRecreateCount ?? 1,
  themeObservation: {
    base: starlight?.detectThemeFloorDefaultPoint ?? 20,
    step: starlight?.detectThemeFloorPointMultiplier ?? 10,
    unvisitedMultiplier: starlight?.detectunentrancedThemeFloorPointMultiplier ?? 1.5,
  },
  startGift: {
    pickCount: 1,
    poolsByKeyword: startPoolsByKeyword,
    newKeywordChipCost: common?.data.selectNewStartEgoGiftCategoryChip ?? 12,
    refreshStarlightCost: starlight?.startBuffEgoGiftRefreshDefaultPoint ?? 10,
  },
  giftObservation:
    curated.rules.giftObservation ??
    (observation?.observationEgoGiftCostDataList?.length
      ? {
          max: observation.observationEgoGiftCostDataList.length,
          fusionResultsAllowed: false,
          costTable: [...observation.observationEgoGiftCostDataList]
            .sort((a, b) => a.egogiftCount - b.egogiftCount)
            .map((row) => row.starlightCost),
          verified: true,
          source: `mirror-dungeon-egogift-observation-data-md${dungeonId}.json observationEgoGiftCostDataList`,
        }
      : { max: 3, fusionResultsAllowed: false, costTable: [], verified: false }),
  starlight: {
    initial: starlight?.initPoint ?? 0,
    hardClearMultiplier: starlight?.rewardInfo?.hardDifficultyBonusMultiplier ?? 1,
  },
  fusion: {
    tierScores,
    resultTierByScore: (common?.data.egoGiftCombineTierTable?.combineTierResultByCombineScore ?? []).map(
      (row) => ({
        min: row.combineScoreRangeMin,
        max: row.combineScoreRangeMax,
        tier: row.tierResult,
      }),
    ),
    successProbabilityByIngredients: probByCount(common?.data.egogiftRandomCombineProbs?.origin),
    successProbabilityWithStarlight: probByCount(common?.data.egogiftRandomCombineProbs?.enabledStarlight),
    maxShopSlots: 3,
  },
  upgradeCostByTier,
  generalGiftPackShare: generalShare,
  hiddenPack: curated.rules.hiddenPack ?? null,
  hiddenBattle: hiddenBattleInfo
    ? {
        gifts: sortNums(hiddenBattleGifts),
        floors: sortNums((hiddenBattleInfo.probInfo ?? []).map((row) => row.floor)).filter((f) => f >= 1 && f <= 15),
        probabilityPerFloor: hiddenBattleInfo.probInfo?.[0]?.prob ?? null,
      }
    : null,
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

interface Lock {
  sources: Record<
    string,
    {
      repo: string;
      sha?: string;
      languages?: string[] | Record<string, { ref: string; sha: string }>;
      fetchedAt: string;
    }
  >;
}
const lock = readJson<Lock>(repoPath('data/sources.lock.json'));

/**
 * A content hash of every input, so `dataVersion` changes exactly when the data does.
 * A wall-clock timestamp here would make every rebuild dirty the git diff.
 */
function inputsFingerprint(): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.json')) {
        hash.update(entry);
        hash.update(readJsonStableBytes(full));
      }
    }
  };
  walk(STATIC_DIR);
  walk(LOCALIZE_DIR);
  // The derived mirror backfills identities, packs and gifts, so it is an input like any other:
  // leaving it out would let the data change while `dataVersion` swore it had not.
  walk(DERIVED_DIR);
  walk(repoPath('data/curated'));
  return hash.digest('hex').slice(0, 8);
}

function readJsonStableBytes(path: string): string {
  return JSON.stringify(readJson(path));
}

/**
 * A season is provisional while a selectable pack has no general gift pool: the fallback knows the
 * pack exists but not what it can drop, and a plan built on that would be quietly wrong. The app
 * shows the flag rather than presenting half a season as a whole one.
 */
const backfilledPackIds = new Set(backfilledPacks.map((pack) => pack.id));
const packsWithoutGeneralPool = selectablePacks.filter((pack) => backfilledPackIds.has(pack.id));
const provisional = curatedSeason.provisional === true || packsWithoutGeneralPool.length > 0;

const meta: Meta = {
  dataVersion: `${dungeonId}.${inputsFingerprint()}`,
  schemaVersion: 1,
  dungeon: {
    id: dungeonId,
    name: loc(
      // The dungeon's display name lives in the per-season UI strings.
      findDungeonName('KR'),
      findDungeonName('EN'),
    ),
  },
  sources: Object.fromEntries(
    Object.entries(lock.sources).map(([name, s]) => {
      const branches = s.languages && !Array.isArray(s.languages) ? s.languages : null;
      return [
        name,
        {
          repo: s.repo,
          ...(s.sha ? { sha: s.sha } : {}),
          ...(branches
            ? { languages: Object.fromEntries(Object.entries(branches).map(([lang, pin]) => [lang, pin.sha])) }
            : {}),
          fetchedAt: s.fetchedAt,
        },
      ];
    }),
  ),
  staticDataPresent: hasStatic,
  provisional,
  counts: {
    gifts: gifts.length,
    packs: packs.length,
    identities: identities.length,
    fusionRecipes: [...recipesByResult.values()].reduce((n, list) => n + list.length, 0) + mixedByResult.size,
  },
};

function findDungeonName(lang: 'KR' | 'EN'): string {
  const path = join(LOCALIZE_DIR, lang, `MirrorDungeonUI_${dungeonId}.json`);
  const raw = readJsonIfExists<{ dataList?: { id: string; content?: string }[] }>(path);
  const entry = raw?.dataList?.find((e) => e.id === `mirror_dungeon_progress_text_${dungeonId}`);
  // "이름과 거미의 거울 {0}층" -> "이름과 거미의 거울"
  return (entry?.content ?? '').replace(/\s*\{0\}.*$/, '').trim();
}

// ---------------------------------------------------------------------------
// Buff ids in the text
// ---------------------------------------------------------------------------

/*
 * The game writes a buff into its own text as a bracketed id — 「[Combustion] 횟수를 부여」 — and
 * paints the localized name over it at runtime. Our copy keeps the ids, so a gift read half in
 * English whatever language the reader chose. `BattleKeywords.json` is the game's own table for
 * them, so every id it names is rewritten here, in both languages.
 *
 * A buff it does not name (identity-specific ones like `BloodDinner`) keeps its bracketed id: a
 * guessed name would be worse than a visible id. The count is reported below so the gap is known.
 */
const unnamedBuffIds = new Set<string>();
for (const gift of gifts) {
  const text = (value: Localized): Localized => ({
    ko: localizeBuffTokens(value.ko, battleKeywordKo, unnamedBuffIds),
    en: localizeBuffTokens(value.en, battleKeywordEn, unnamedBuffIds),
  });
  gift.desc = text(gift.desc);
  for (const condition of gift.conditions) if (condition.text) condition.text = text(condition.text);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const SEASON_OUT = seasonDir(dungeonId);

// What the season owns.
writeJsonStable(join(SEASON_OUT, 'meta.json'), meta);
writeJsonStable(join(SEASON_OUT, 'rules.json'), rules);
writeJsonStable(join(SEASON_OUT, 'gifts.json'), gifts);
writeJsonStable(join(SEASON_OUT, 'packs.json'), packs);
// What every season shares. Neither looks at the dungeon, so a frozen season keeps getting new
// identities instead of going stale with the build that made it.
writeJsonStable(join(OUT, 'enums.json'), enums);
writeJsonStable(join(OUT, 'identities.json'), identities);
writeSeasonIndex();

/**
 * Rebuild `index.json` from the season directories on disk — the one just written and the frozen
 * ones alike — so the app can ask what exists instead of probing for directory names.
 */
function writeSeasonIndex(): void {
  const seasons: SeasonEntry[] = readdirSync(OUT)
    .filter((entry) => /^md\d+$/.test(entry) && statSync(join(OUT, entry)).isDirectory())
    .map((entry) => {
      const seasonMeta = metaSchema.parse(readJson(join(OUT, entry, 'meta.json')));
      const seasonRules = rulesSchema.parse(readJson(join(OUT, entry, 'rules.json')));
      return {
        id: seasonMeta.dungeon.id,
        name: seasonMeta.dungeon.name,
        dataVersion: seasonMeta.dataVersion,
        lastFloor: Math.max(...Object.values(seasonRules.floors).flat()),
        provisional: seasonMeta.provisional,
      };
    })
    .sort((a, b) => a.id - b.id);
  const newest = seasons[seasons.length - 1];
  if (!newest) fail('no season directories were written.');
  // The app opens the newest season whose data is whole. A new season arrives knowing only half
  // of itself — no general gift pool — and a half-known season is something to step into on
  // purpose, not the page everyone lands on. It becomes the default the moment it is complete.
  const complete = seasons.filter((entry) => !entry.provisional);
  const opens = complete[complete.length - 1] ?? newest;
  writeJsonStable(join(OUT, 'index.json'), { default: opens.id, seasons });
}

const conditionCounts = gifts.reduce(
  (acc, g) => {
    for (const c of g.conditions) acc[c.type] = (acc[c.type] ?? 0) + 1;
    return acc;
  },
  {} as Record<string, number>,
);

console.log(
  `build-data: dungeon ${dungeonId}, dataVersion ${meta.dataVersion}${lenient ? ' (lenient)' : ''}`,
);
console.log(
  `  gifts ${gifts.length}, packs ${packs.length} (${selectablePacks.length} selectable), ` +
    `identities ${identities.length}, fusion recipes ${meta.counts.fusionRecipes}`,
);
console.log(`  acquisition: ${summarize(gifts.map((g) => g.acquisition.kind))}`);
console.log(`  conditions: ${summarize(gifts.flatMap((g) => g.conditions.map((c) => c.type)))}`);
console.log(`  identity keywords: ${summarize(identities.map((i) => i.keywordSource))}`);
console.log(
  `  특수 variants: ${specialVariants.size} buff(s), ${identities.filter((i) => Object.values(i.keywords).some((k) => k.specialSkills > 0)).length} identities`,
);
console.log(`  탄환 identities: ${identities.filter((i) => i.keywords.Bullet).length}`);
if (unnamedBuffIds.size > 0) {
  // Not an error: these are identity- or gift-specific buffs the game names nowhere we can read.
  console.log(`  ${unnamedBuffIds.size} buff id(s) left as ids in the text: ${[...unnamedBuffIds].sort().slice(0, 8).join(', ')}…`);
}
if (missingText.length > 0) {
  console.log(`  ${missingText.length} gift(s) without Korean text: ${missingText.slice(0, 10).join(', ')}`);
}
if (unnamedFactions.length > 0) {
  console.log(
    `  ${unnamedFactions.length} faction(s) without a display name: ${unnamedFactions.join(', ')}` +
      ' — add them to data/curated/factions.json',
  );
}
if (unparsedConditionCount > 0) {
  console.log(`  ${unparsedConditionCount} condition sentence(s) could not be parsed (kept as "unparsed")`);
}
void conditionCounts;

function summarize(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
}
