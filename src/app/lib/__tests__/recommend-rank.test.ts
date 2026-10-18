/**
 * 추천 기프트의 순위 (M131): the score is how many identities a gift's effect applies to, and the
 * sections are ordered by it — ties in the tab's usual order.
 */
import { describe, expect, it } from 'vitest';
import type { EffectReport, GiftEffectsReport, RequirementReport } from '../../../core/index.ts';
import { analyseDeck, buildIndexes } from '../../../core/index.ts';
import type { EffectRequirement } from '../../../core/schema.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { conditionReportsByGift } from '../gift-tile.ts';
import { classifyGift, compareEntries } from '../gift-priority.ts';
import { effectReportsByGift, recommendedGifts } from '../recommend.ts';
import {
  compareRecommended,
  keywordGroupOrder,
  comparePackFirst,
  orderRecommended,
  recommendationScore,
} from '../recommend-rank.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const gift = (id: number) => indexes.giftById.get(id)!;

const BURN: EffectRequirement = { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true };
/** A met (or unmet) requirement whose matching identities are `ids`. */
const req = (ids: number[], satisfied = ids.length > 0): RequirementReport => ({
  requirement: BURN,
  have: ids.length,
  need: 1,
  satisfied,
  unknown: 0,
  matches: ids.map((id) => ({ id, slots: [] })),
});
const eff = (
  requirements: RequirementReport[],
  usable = requirements.every((r) => r.satisfied),
): EffectReport => ({
  index: 0,
  kind: 'effect',
  requirements,
  hints: [],
  usable,
  unconditional: requirements.length === 0,
  unclassified: false,
});
const report = (effects: EffectReport[], gates: RequirementReport[] = []): GiftEffectsReport => ({
  giftId: 1,
  gates,
  gateOpen: gates.every((g) => g.satisfied),
  effects,
  relevance: 'deck',
});
const SEVEN = { deployed: [1, 2, 3, 4, 5, 6, 7] };

describe('recommendationScore', () => {
  it('counts the identities an effect applies to: three beat one', () => {
    // Arrange
    const three = report([eff([req([10, 11, 12])])]);
    const one = report([eff([req([10])])]);
    // Act
    const scores = [recommendationScore(three, SEVEN), recommendationScore(one, SEVEN)];
    // Assert
    expect(scores).toEqual([3, 1]);
  });

  it('counts an identity once however many effects and requirements name it', () => {
    // Arrange: 10 meets both requirements of one effect and the other effect too; 11 the gate.
    const r = report([eff([req([10, 12]), req([10])]), eff([req([10, 12])])], [req([10, 11])]);
    // Act
    const score = recommendationScore(r, SEVEN);
    // Assert
    expect(score).toBe(3);
  });

  it('leaves out an effect the deck cannot use', () => {
    // Arrange: the second effect names 20 and 21 but one of its requirements is unmet.
    const r = report([eff([req([10])]), eff([req([20, 21]), req([], false)])]);
    // Act + Assert
    expect(recommendationScore(r, SEVEN)).toBe(1);
  });

  it('scores 0 behind a closed gate', () => {
    // Arrange: the gate needs two, one meets it.
    const gate: RequirementReport = { ...req([10]), need: 2, satisfied: false };
    const r = report([eff([req([10, 11, 12])], false)], [gate]);
    // Act + Assert
    expect(recommendationScore(r, SEVEN)).toBe(0);
  });

  it('scores an unconditional gift as the number deployed — and 0 when nobody is', () => {
    // Arrange
    const plain = report([eff([])]);
    // Act
    const withSeven = recommendationScore(plain, SEVEN);
    const withNobody = recommendationScore(plain, { deployed: [] });
    // Assert
    expect(withSeven).toBe(7);
    expect(withNobody).toBe(0);
  });

  it('scores nothing usable as 0 when nobody is deployed', () => {
    // Arrange: nobody meets the requirement, so the effect is not usable.
    const r = report([eff([req([], false)])]);
    // Act + Assert
    expect(recommendationScore(r, { deployed: [] })).toBe(0);
  });
});

describe('compareRecommended', () => {
  const entries = [9214, 9088, 9215].map((id) => classifyGift(gift(id), []));

  it('puts the higher score first', () => {
    // Arrange
    const scores = new Map([
      [9214, 1],
      [9088, 3],
      [9215, 2],
    ]);
    // Act
    const sorted = [...entries].sort((a, b) => compareRecommended(a, b, (id) => scores.get(id)!));
    // Assert
    expect(sorted.map((e) => e.gift.id)).toEqual([9088, 9215, 9214]);
  });

  it('keeps the usual order on a tie', () => {
    // Arrange: every score equal.
    const usual = [...entries].sort(compareEntries).map((e) => e.gift.id);
    // Act
    const sorted = [...entries].sort((a, b) => compareRecommended(a, b, () => 4));
    // Assert
    expect(sorted.map((e) => e.gift.id)).toEqual(usual);
  });

  it('「팩 전용 먼저」 puts pack-bound first, then by score', () => {
    // Arrange: 진혼 (9088) is a fusion, not pack-bound, with the best score.
    const scores = new Map([
      [9214, 1],
      [9088, 9],
      [9215, 2],
    ]);
    const scoreOf = (id: number) => scores.get(id)!;
    // Act
    const packFirst = orderRecommended(entries, 'pack', scoreOf).map((e) => e.gift.id);
    const byScore = orderRecommended(entries, 'keyword', scoreOf).map((e) => e.gift.id);
    // Assert
    expect(packFirst).toEqual([9215, 9214, 9088]);
    expect(byScore).toEqual([9088, 9215, 9214]);
    expect(comparePackFirst(entries[1]!, entries[0]!, scoreOf)).toBeGreaterThan(0);
  });
});

describe('the ranking on real data', () => {
  it('orders a burn deck’s deck-met gifts by score, highest first', () => {
    // Arrange: seven burn identities deployed.
    const deployed = [10112, 10216, 10311, 10415, 10512, 10604, 10715];
    const stats = analyseDeck(deployed, indexes, data.rules.deployment, deployed);
    const gifts = data.gifts.filter((g) => g.obtainable);
    // Act
    const { deck, scores } = recommendedGifts(
      gifts,
      conditionReportsByGift(data, stats, indexes),
      effectReportsByGift(gifts, stats, indexes),
      { deployed: stats.deployed },
    );
    const ranked = deck.map((e) => scores.get(e.gift.id)!);
    // Assert
    expect(ranked.length).toBeGreaterThan(5);
    expect(ranked[0]).toBe(7);
    expect(ranked.every((score) => score >= 1 && score <= 7)).toBe(true);
    expect([...ranked].sort((a, b) => b - a)).toEqual(ranked);
    expect(new Set(ranked).size).toBeGreaterThan(1);
  });
});

describe('keywordGroupOrder', () => {
  const ENUM = [
    'Combustion',
    'Laceration',
    'Vibration',
    'Burst',
    'Sinking',
    'Breath',
    'Charge',
    'Slash',
    'Penetrate',
    'Hit',
    'None',
  ] as const;

  it("puts the deck's keywords first, then 키워드 없음, the keywords it lacks, the attack types", () => {
    // Arrange: the owner's 충전·진동 deck — 진동 5, 충전 5, 화상 2, 출혈 2, the rest 0.
    const counts = { Vibration: 5, Charge: 5, Combustion: 2, Laceration: 2, Bullet: 1 };
    // Act
    const order = keywordGroupOrder(ENUM, counts);
    // Assert: a tie keeps the enums order (진동 before 충전).
    expect(order).toEqual([
      'Vibration',
      'Charge',
      'Combustion',
      'Laceration',
      'None',
      'Burst',
      'Sinking',
      'Breath',
      'Slash',
      'Penetrate',
      'Hit',
    ]);
  });

  it('puts 키워드 없음 first and keeps the enums order when nobody is deployed', () => {
    expect(keywordGroupOrder(ENUM, {})).toEqual(['None', ...ENUM.filter((k) => k !== 'None')]);
  });

  it('ranks by count, not by the enums order', () => {
    expect(keywordGroupOrder(ENUM, { Breath: 1, Sinking: 6 }).slice(0, 3)).toEqual([
      'Sinking',
      'Breath',
      'None',
    ]);
  });
});
