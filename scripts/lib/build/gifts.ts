import { SIN_BY_COLOR } from '../raw.ts';
import { deriveUpgradeOf, tierFromTags } from '../derive.ts';
import { parseConditions } from '../parse-conditions.ts';
import { KEYWORDS, type AcquisitionKind, type Condition, type Gift } from '../../../src/core/schema.ts';
import type { Factions } from './factions.ts';
import type { Sources } from './load.ts';
import type { PackSet } from './packs.ts';
import { applyNameOverride, loc, sortNums } from './util.ts';

export interface GiftSet {
  gifts: Gift[];
  /** Fixed recipes, keyed by result. `requiredEgoGiftIds` is the real ingredient list. */
  recipesByResult: Map<number, number[][]>;
  mixedByResult: Map<number, Gift['fusion']>;
  hiddenBattleInfo: NonNullable<Sources['common']>['data']['hiddenBattleInfo'] | undefined;
  hiddenBattleGifts: Set<number>;
  generalShare: number;
  diagnostics: {
    /** Enhanceable gifts the game ships no text for at some step (M130) — reported, never guessed. */
    upgradeWithoutText: number[];
    missingText: number[];
    unparsedConditionCount: number;
    /** Selectable-pack exclusives the season drop pool does not list (see `obtainable`). */
    exclusivesOutsideDropPool: number[];
  };
}

export function deriveGifts(src: Sources, packSet: PackSet, factions: Factions): GiftSet {
  const {
    curated,
    common,
    combineTable,
    hardOnlyIds,
    dropPool,
    stages,
    observation,
    curatedSeason,
    backfilledGiftIds,
    backfilledGifts,
    rawGifts,
    giftTextKo,
    giftTextEn,
    lockedDesc,
    derivedGiftName,
  } = src;
  const { selectablePacks } = packSet;
  const factionIdByName = factions.idByName;

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
    (hiddenBattleInfo?.pool ?? [])
      .flatMap((stageId) => stageRewardGifts(stageId))
      .filter((id) => giftTextKo.has(id)),
  );

  /** What 기프트 관측 can offer this season; the data lists eligible gifts explicitly. */
  const observableIds = new Set(
    (observation?.observationEgoGiftDataList ?? []).flatMap((entry) => entry.egogiftIdList ?? []),
  );
  for (const id of observation?.unobservableEgoGiftIds ?? []) observableIds.delete(id);
  // The static observation list cannot name a gift the static data has not shipped; the owner's
  // stand-in (`backfillAssumptions.exclusivesObservable`) lets those exclusives be observed for now.
  if (curatedSeason.backfillAssumptions?.exclusivesObservable === true) {
    for (const gift of backfilledGifts) observableIds.add(gift.id);
  }

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

  const upgradeWithoutText: number[] = [];

  /**
   * The game's text for each enhancement step (M130). `upgradeDataList` names a localize id per
   * level; an entry that points back at the base text (a synthesized rehearsal season does that)
   * carries nothing of its own. The text is cleaned with the base desc in the text pass.
   */
  function upgradeTextsOf(id: number, stat: (typeof rawGifts)[number] | undefined): Gift['upgrades'] {
    const list = stat?.upgradeDataList ?? [];
    const baseLocalizeId = list.find((entry) => entry.upgradeLevel === 0)?.localizeID ?? id;
    const out: NonNullable<Gift['upgrades']> = [];
    let missing = false;
    for (const entry of [...list].sort((a, b) => a.upgradeLevel - b.upgradeLevel)) {
      if (entry.upgradeLevel !== 1 && entry.upgradeLevel !== 2) continue;
      const ko = entry.localizeID === baseLocalizeId ? undefined : giftTextKo.get(entry.localizeID);
      const en = entry.localizeID === baseLocalizeId ? undefined : giftTextEn.get(entry.localizeID);
      if (!ko?.name || !ko.desc) {
        missing = true;
        continue;
      }
      out.push({
        level: entry.upgradeLevel,
        name: loc(ko.name, en?.name ?? ko.name),
        desc: loc(ko.desc, en?.desc ?? ko.desc),
      });
    }
    if (missing) upgradeWithoutText.push(id);
    return out.length > 0 ? out : undefined;
  }

  const missingText: number[] = [];
  let unparsedConditionCount = 0;

  const exclusivesOutsideDropPool: number[] = [];
  function exclusiveOutsideDropPool(id: number, exclusiveTo: readonly number[]): boolean {
    if (exclusiveTo.length === 0 || dropPoolIds.size === 0 || dropPoolIds.has(id)) return false;
    exclusivesOutsideDropPool.push(id);
    return true;
  }

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
      const upgrades = upgradeTextsOf(id, stat);
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
        ...(upgrades ? { upgrades } : {}),
        tags,
        hardOnly: hardOnlyIds.has(id),
        obtainable:
          dropPoolIds.has(id) ||
          // A backfilled pack's exclusive is reached by entering that pack; the static drop pool
          // that would otherwise list it has not shipped yet.
          backfilledGiftIds.has(id) ||
          // So is a selectable pack's static exclusive the season drop pool leaves out: MD8 moved
          // 9205 전혈 플라스크 out of every general pool into the `specificEgoGiftPool` of 1019~1021,
          // 1507·1514·1518 and dropped it from `egoGifts`, while its own observation list still
          // offers it. Counted in the build log so a second case is read, not absorbed.
          exclusiveOutsideDropPool(id, exclusiveList) ||
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

  return {
    gifts,
    recipesByResult,
    mixedByResult,
    hiddenBattleInfo,
    hiddenBattleGifts,
    generalShare,
    diagnostics: { upgradeWithoutText, missingText, unparsedConditionCount, exclusivesOutsideDropPool },
  };
}
