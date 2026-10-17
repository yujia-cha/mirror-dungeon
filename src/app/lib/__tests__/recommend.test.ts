/**
 * 추천 기프트 (M121, 기준 M129): which gifts land in which group, and the tab's filters. The effect
 * judgement itself is core's (`effects.test.ts`); here real gifts carry written-out effects so each
 * grouping rule is seen alone.
 */
import { describe, expect, it } from 'vitest';
import type { EffectRequirement, Gift, GiftEffect } from '../../../core/schema.ts';
import { analyseDeck, buildIndexes } from '../../../core/index.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { conditionReportsByGift } from '../gift-tile.ts';
import { classifyGift } from '../gift-priority.ts';
import {
  DEFAULT_RECOMMEND_FILTERS,
  activationOf,
  effectReportsByGift,
  groupByKeyword,
  isFusionGift,
  matchesRecommendFilters,
  recommendFiltersActive,
  recommendedGifts,
} from '../recommend.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const gift = (id: number) => indexes.giftById.get(id)!;
const BURN_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
const burnStats = analyseDeck(BURN_DECK, indexes, data.rules.deployment, BURN_DECK.slice(0, 7));

/** A real gift with its effects written out. */
const withEffects = (id: number, effects: GiftEffect[]): Gift => ({ ...gift(id), effects });
const effect = (...requires: EffectRequirement[]): GiftEffect => ({ kind: 'effect', requires });
const burnSkill: EffectRequirement = {
  type: 'skillKeyword',
  keywords: ['Combustion'],
  includesSpecial: true,
};
const nobodyHas: EffectRequirement = { type: 'identityBuff', buffs: ['NoSuchBuff'] };

function judge(gifts: Gift[], stats = burnStats) {
  return recommendedGifts(
    gifts,
    conditionReportsByGift(data, stats, indexes),
    effectReportsByGift(gifts, stats, indexes),
    { deployed: stats.deployed },
  );
}

describe('activationOf', () => {
  it('puts a gift the deck can use through a requirement in the deck group', () => {
    // Arrange: a burn deck, a burn-skill effect.
    const g = withEffects(9215, [effect(burnSkill)]);
    // Act
    const activation = activationOf(g, effectReportsByGift([g], burnStats, indexes).get(g.id));
    // Assert
    expect(activation).toBe('deck');
  });

  it('leaves out a gift whose every conditional effect the deck cannot use', () => {
    const g = withEffects(9215, [effect(nobodyHas)]);
    expect(activationOf(g, effectReportsByGift([g], burnStats, indexes).get(g.id))).toBeNull();
  });

  it('keeps a plain usable gift only when it is pack-bound (붉은색 넥타이 is, 지옥나비의 꿈 is not)', () => {
    // Arrange
    const packBound = withEffects(9215, [effect()]);
    const general = withEffects(9001, [effect()]);
    const reports = effectReportsByGift([packBound, general], burnStats, indexes);
    // Act + Assert
    expect(packBound.acquisition.kind).toBe('packLimited');
    expect(general.acquisition.kind).toBe('general');
    expect(activationOf(packBound, reports.get(packBound.id))).toBe('free');
    expect(activationOf(general, reports.get(general.id))).toBeNull();
  });

  it('recommends nothing that needs the deck when nobody is deployed', () => {
    const nobody = analyseDeck(BURN_DECK, indexes, data.rules.deployment, []);
    const g = withEffects(9215, [effect(burnSkill)]);
    expect(activationOf(g, effectReportsByGift([g], nobody, indexes).get(g.id))).toBeNull();
  });
});

describe('the E.G.O group (M129)', () => {
  it('puts a gift held only by an E.G.O skill condition last, whatever its source', () => {
    // Arrange: an 조각-like general gift — gate 「…E.G.O 스킬 사용 시 발동」, then a plain effect.
    const shard = withEffects(9001, [{ kind: 'gate', requires: [{ type: 'egoSkill' }] }, effect()]);
    // Act
    const { deck, free, ego, reasons } = judge([shard]);
    // Assert
    expect(shard.acquisition.kind).toBe('general');
    expect(deck).toEqual([]);
    expect(free).toEqual([]);
    expect(ego.map((e) => e.gift.id)).toEqual([9001]);
    expect(reasons.get(9001)).toBe('ego');
  });
});

describe('recommendedGifts', () => {
  it('splits gifts into the deck group and the plain pack-bound group, with a reason for each', () => {
    // Arrange
    const gifts = [
      withEffects(9088, [effect(burnSkill)]),
      withEffects(9092, [effect(nobodyHas)]),
      withEffects(9215, [effect()]),
      withEffects(9001, [effect()]),
    ];
    // Act
    const { deck, free, reasons } = judge(gifts);
    // Assert
    expect(deck.map((e) => e.gift.id)).toEqual([9088]);
    expect(free.map((e) => e.gift.id)).toEqual([9215]);
    expect(reasons.get(9088)).toBe('deck:skillKeyword/Combustion');
    expect(reasons.get(9215)).toBe('free');
    expect(reasons.has(9092)).toBe(false);
  });
});

describe('the recommended tab filters', () => {
  it('says which gifts are fusions (진혼 is, 붉은색 넥타이 is not)', () => {
    // Arrange / Act / Assert
    expect(isFusionGift(gift(9088))).toBe(true);
    expect(isFusionGift(gift(9215))).toBe(false);
  });

  it('narrows by 획득, by 조합 and by keyword, and passes everything by default', () => {
    // Arrange
    const requiem = gift(9088); // fusion, 화상, not pack-bound
    const tie = gift(9215); // pack-limited, 화상
    const hammer = gift(9214); // pack-limited, 진동
    // Act
    const byDefault = [requiem, tie, hammer].every((g) =>
      matchesRecommendFilters(g, DEFAULT_RECOMMEND_FILTERS),
    );
    const packOnly = { ...DEFAULT_RECOMMEND_FILTERS, acquisition: 'pack' as const };
    const generalOnly = { ...DEFAULT_RECOMMEND_FILTERS, acquisition: 'general' as const };
    const noFusion = { ...DEFAULT_RECOMMEND_FILTERS, fusion: false };
    const vibration = { ...DEFAULT_RECOMMEND_FILTERS, keyword: 'Vibration' as const };
    // Assert
    expect(byDefault).toBe(true);
    expect(recommendFiltersActive(DEFAULT_RECOMMEND_FILTERS)).toBe(false);
    expect(matchesRecommendFilters(requiem, packOnly)).toBe(false);
    expect(matchesRecommendFilters(tie, packOnly)).toBe(true);
    expect(matchesRecommendFilters(requiem, generalOnly)).toBe(true);
    expect(matchesRecommendFilters(tie, generalOnly)).toBe(false);
    expect(matchesRecommendFilters(requiem, noFusion)).toBe(false);
    expect(matchesRecommendFilters(tie, noFusion)).toBe(true);
    expect(matchesRecommendFilters(hammer, vibration)).toBe(true);
    expect(matchesRecommendFilters(tie, vibration)).toBe(false);
    expect([packOnly, noFusion, vibration].every(recommendFiltersActive)).toBe(true);
    // The sort is not a filter.
    expect(recommendFiltersActive({ ...DEFAULT_RECOMMEND_FILTERS, sort: 'pack' })).toBe(false);
  });

  it('groups by keyword in the enums order, keeping the order inside each group', () => {
    // Arrange
    const entries = [9214, 9088, 9215, 9002].map((id) => classifyGift(gift(id), []));
    const order = data.enums.keywords.map((k) => k.id);
    // Act
    const groups = groupByKeyword(entries, order);
    // Assert
    expect(groups.map((g) => g.keyword)).toEqual(['Combustion', 'Vibration', 'None']);
    expect(groups[0]!.entries.map((e) => e.gift.id)).toEqual([9088, 9215]);
  });

  it('puts a keyword the order does not know last', () => {
    // Arrange
    const entries = [9214, 9088].map((id) => classifyGift(gift(id), []));
    // Act
    const groups = groupByKeyword(entries, ['Vibration']);
    // Assert
    expect(groups.map((g) => g.keyword)).toEqual(['Vibration', 'Combustion']);
  });
});
