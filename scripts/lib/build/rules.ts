import {
  IDENTITY_KEYWORDS,
  KEYWORDS,
  SINS,
  STATUS_KEYWORDS,
  type Enums,
  type Rules,
} from '../../../src/core/schema.ts';
import type { Factions } from './factions.ts';
import type { GiftSet } from './gifts.ts';
import type { IdentitySet } from './identities.ts';
import type { Sources } from './load.ts';
import { applyNameOverride, loc, sortNums } from './util.ts';

/** What a Mirror Dungeon has opened since MD5, used when a season records nothing of its own. */
const DEFAULT_FLOORS: Rules['floors'] = {
  normal: [1, 2, 3, 4, 5],
  hard: [1, 2, 3, 4, 5],
  parallel: [6, 7, 8, 9, 10],
  extreme: [11, 12, 13, 14, 15],
};

export function deriveEnums(src: Sources, factions: Factions, identitySet: IdentitySet): Enums {
  const { curated, categoryKo, categoryEn, battleKeywordKo, battleKeywordEn } = src;
  const statusSet = new Set<string>(STATUS_KEYWORDS);
  const giftKeywordSet = new Set<string>(KEYWORDS);

  return {
    keywords: KEYWORDS.map((id) => ({
      id,
      // `None` is 「범용」 in the game, which the app keeps for the general drop; the curated label
      // (「키워드 없음」) keeps one word from naming two things.
      name: applyNameOverride(
        loc(categoryKo.get(id) ?? id, categoryEn.get(id) ?? id),
        curated.names.keywords?.[id],
      ),
      status: statusSet.has(id),
    })),
    // 탄환 has no gift category row, so its name comes from the battle keywords instead.
    identityOnlyKeywords: IDENTITY_KEYWORDS.filter((id) => !giftKeywordSet.has(id)).map((id) => ({
      id,
      name: loc(battleKeywordKo.get(id) ?? id, battleKeywordEn.get(id) ?? id),
    })),
    factions: [...factions.nameById]
      .map(([id, name]) => ({ id, name, deprecated: factions.deprecated.has(id) }))
      // Code-point order, like every other sort in this build: `localeCompare` is ICU collation,
      // which ignores `_` and put H_CORP after HOOK_OFFICE — and depends on the Node build's ICU.
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    sinners: identitySet.sinnerNames.flatMap((name, id) => (id >= 1 ? [{ id, name }] : [])),
    sins: [...SINS],
  };
}

export function deriveRules(src: Sources, giftSet: GiftSet): Rules {
  const { curated, curatedSeason, common, dungeonId, observation } = src;
  const { hiddenBattleInfo, hiddenBattleGifts, generalShare } = giftSet;

  const starlight = common?.data.starlightInfo;
  const tierScores: Record<string, number> = {};
  for (const row of common?.data.egoGiftCombineTierTable?.combineScoreByEgoGiftTier ?? []) {
    tierScores[String(row.egoGiftTier)] = row.combineScore;
  }
  const upgradeCostByTier: Record<string, number[]> = {};
  for (const row of common?.data.egoGiftUpgradeCostTable?.table ?? []) {
    upgradeCostByTier[String(row.tier)] = row.cost;
  }
  const probByCount = (
    rows: { materialCount: number; prob: number }[] | undefined,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of rows ?? []) out[String(row.materialCount)] = row.prob;
    return out;
  };

  const startPoolsByKeyword: Record<string, number[]> = {};
  for (const pool of common?.data.startEgoGiftPools ?? []) {
    if (!(KEYWORDS as readonly string[]).includes(pool.keyword)) continue;
    startPoolsByKeyword[pool.keyword] = sortNums([...(pool.normalpool ?? []), ...(pool.buffpool ?? [])]);
  }

  return {
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
          floors: sortNums((hiddenBattleInfo.probInfo ?? []).map((row) => row.floor)).filter(
            (f) => f >= 1 && f <= 15,
          ),
          probabilityPerFloor: hiddenBattleInfo.probInfo?.[0]?.prob ?? null,
        }
      : null,
  };
}
