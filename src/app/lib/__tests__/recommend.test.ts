/**
 * 추천 기프트 (M121): which gifts the deck sets off, in which group, and the tab's filters.
 * Real gifts; the condition reports are either the real evaluation against a deck or written out
 * when the case needs a count the shipped decks do not happen to have.
 */
import { describe, expect, it } from 'vitest';
import type { ConditionReport } from '../../../core/types.ts';
import { analyseDeck, buildIndexes } from '../../../core/index.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { conditionReportsByGift } from '../gift-tile.ts';
import { classifyGift } from '../gift-priority.ts';
import {
  DEFAULT_RECOMMEND_FILTERS,
  activationOf,
  deployedConditionReports,
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
const burnReports = conditionReportsByGift(
  data,
  analyseDeck(BURN_DECK, indexes, data.rules.deployment, BURN_DECK.slice(0, 7)),
  indexes,
);

/** One condition report, as `evaluateConditions` writes it. */
const report = (giftId: number, fields: Partial<ConditionReport>): ConditionReport => ({
  giftId,
  satisfied: false,
  reachedTiers: [],
  have: 0,
  need: null,
  subject: { kind: 'keyword', ids: ['Laceration'], scope: 'deployed' },
  gate: true,
  detail: { ko: '', en: '' },
  ...fields,
});

describe('activationOf', () => {
  it('recommends a gift whose threshold the deck meets (진혼, 화상 7/5)', () => {
    // Arrange
    const reports = burnReports.get(9088)!;
    // Act
    const activation = activationOf(gift(9088), reports);
    // Assert
    expect(reports.every((r) => r.gate && r.satisfied)).toBe(true);
    expect(activation).toBe('deck');
  });

  it('leaves out a gift whose threshold the deck misses (연성진동, 진동 2/5)', () => {
    // Arrange
    const reports = burnReports.get(9092)!;
    // Act
    const activation = activationOf(gift(9092), reports);
    // Assert
    expect(reports.some((r) => r.gate && !r.satisfied)).toBe(true);
    expect(activation).toBeNull();
  });

  it('leaves out a condition a deck cannot judge (인연 얽힘, 완전 공명)', () => {
    // Arrange
    const reports = burnReports.get(9208)!;
    // Act
    const activation = activationOf(gift(9208), reports);
    // Assert
    expect(activation).toBeNull();
  });

  it('recommends a threshold-less count once one identity counts, and not at zero (피로 된 살점, 살점으로 된 피)', () => {
    // Arrange
    const none = [report(9842, { gate: false, have: 0 })];
    const one = [report(9842, { gate: false, have: 1 })];
    // Act
    const atZero = activationOf(gift(9842), none);
    const atOne = activationOf(gift(9842), one);
    // Assert
    expect(gift(9842).conditions).toMatchObject([{ type: 'keywordSkillCount', min: null }]);
    expect(atZero).toBeNull();
    expect(atOne).toBe('deck');
  });

  it('counts a threshold-less 「편성된」 condition only over the deployed party (피로 된 살점, 혈찬)', () => {
    // Arrange: 10310 consumes 혈찬; the rest of the burn deck does not.
    const deck = BURN_DECK.map((id) => (id === 10311 ? 10310 : id));
    const inReserve = analyseDeck(deck, indexes, data.rules.deployment, [10112, 10216, 10415, 10512, 10604]);
    const deployed = analyseDeck(deck, indexes, data.rules.deployment, [10112, 10216, 10310]);
    // Act
    const reserveReports = conditionReportsByGift(data, inReserve, indexes).get(9842)!;
    const reserveActivation = activationOf(
      gift(9842),
      reserveReports,
      deployedConditionReports(data, inReserve, indexes).get(9842)!,
    );
    const deployedActivation = activationOf(
      gift(9842),
      conditionReportsByGift(data, deployed, indexes).get(9842)!,
      deployedConditionReports(data, deployed, indexes).get(9842)!,
    );
    // Assert: the ring's count sees the reserve member, the recommendation does not.
    expect(reserveReports).toMatchObject([{ gate: false, have: 1 }]);
    expect(reserveActivation).toBeNull();
    expect(deployedActivation).toBe('deck');
  });

  it('recommends nothing threshold-less with nobody deployed', () => {
    // Arrange
    const deck = BURN_DECK.map((id) => (id === 10311 ? 10310 : id));
    const nobody = analyseDeck(deck, indexes, data.rules.deployment, []);
    // Act
    const { deck: met } = recommendedGifts(
      [gift(9842), gift(9843)],
      conditionReportsByGift(data, nobody, indexes),
      deployedConditionReports(data, nobody, indexes),
    );
    // Assert
    expect(met).toEqual([]);
  });

  it('puts an unconditional pack-bound gift in the second group (붉은색 넥타이, 테마팩 한정)', () => {
    // Arrange
    const tie = gift(9215);
    // Act
    const activation = activationOf(tie, []);
    // Assert
    expect(tie.conditions).toEqual([]);
    expect(tie.acquisition.kind).toBe('packLimited');
    expect(activation).toBe('free');
  });

  it('leaves out an unconditional general gift — any deck has it (지옥나비의 꿈)', () => {
    // Arrange
    const dream = gift(9001);
    // Act
    const activation = activationOf(dream, []);
    // Assert
    expect(dream.acquisition.kind).toBe('general');
    expect(activation).toBeNull();
  });
});

describe('recommendedGifts', () => {
  it('splits the season into the deck group and the unconditional pack-bound group', () => {
    // Arrange
    const gifts = [gift(9088), gift(9092), gift(9215), gift(9001), gift(9157)];
    // Act
    const { deck, free } = recommendedGifts(gifts, burnReports);
    // Assert
    expect(deck.map((e) => e.gift.id)).toEqual([9088, 9157]);
    expect(free.map((e) => e.gift.id)).toEqual([9215]);
  });

  it('keeps every free gift unconditional and pack-bound, and every deck gift conditional', () => {
    // Arrange
    const gifts = data.gifts.filter((g) => g.obtainable);
    // Act
    const { deck, free } = recommendedGifts(gifts, burnReports);
    // Assert
    expect(deck.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((e) => e.gift.conditions.length === 0)).toBe(true);
    expect(free.every((e) => ['packLimited', 'clearReward'].includes(e.gift.acquisition.kind))).toBe(true);
    expect(deck.every((e) => e.gift.conditions.length > 0)).toBe(true);
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
