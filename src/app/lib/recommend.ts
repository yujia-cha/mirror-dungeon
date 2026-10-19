/**
 * 추천 기프트 (M121, 기준은 M129): the gifts the current deck can actually use, for the 「추천 기프트」
 * tab of the 「모두 보기」 browser.
 *
 * The judgement is core's `giftEffectsReport`: a gift is read as effects (`gift.effects`, built from
 * its description), and an effect is usable when the deployed party meets every requirement it and
 * the gift's gates name — a skill that inflicts the keyword, the slot, a faction, an identity-only
 * buff, a sin and attack type, coins, a defense kind. States and battle situations ask nothing.
 *
 * - `deck` (drawn in 「지금 덱으로 발동」): some usable effect asks something of the deck, or a met gate opens it;
 * - `free` (drawn in the same section since M137): only unconditional effects are usable, and the gift takes a
 *   particular pack (`isPackBound` — one pack or boss hands it out, or, since M156, every recipe of a fusion
 *   result eats such a gift) — that is what decides a route; a general one is left out;
 * - `ego` (「E.G.O 스킬 조건」, last): only an E.G.O skill condition holds it — our data has no
 *   identity's E.G.O, so the owner counts it as met but keeps such gifts apart;
 * - anything else is not recommended.
 *
 * Why is never shown; `relevanceReason` says it for debugging (`data-recommend`, `npm run recommend`).
 * Pure: the browser holds the filter state and draws the tiles.
 */
import {
  giftEffectsReport,
  relevanceReason,
  type GiftEffectsReport,
  type SkillGiftLookup,
} from '../../core/index.ts';
import type { Gift, Keyword } from '../../core/schema.ts';
import type { ConditionReport, DeckStats, GameIndexes } from '../../core/types.ts';
import { classifyGift, isPackBound, type GiftById, type GiftEntry } from './gift-priority.ts';
import { compareRecommended, recommendationScore, type RankContext } from './recommend-rank.ts';

/**
 * Why a gift is recommended: the deck can use an effect that asks for it (`deck`), it is plain and
 * pack-bound (`free`, a pack-bound fusion result too), or only an E.G.O skill condition — always met, owner's call — holds it (`ego`).
 */
export type Activation = 'deck' | 'free' | 'ego';

export function activationOf(
  gift: Gift,
  report: GiftEffectsReport | undefined,
  giftById: GiftById,
): Activation | null {
  if (!report || report.relevance === null) return null;
  if (report.relevance === 'free') return isPackBound(gift, giftById) ? 'free' : null;
  return report.relevance;
}

/** Every gift's effects judged on the deployed party. */
export function effectReportsByGift(
  gifts: readonly Gift[],
  stats: DeckStats,
  indexes: GameIndexes,
  lookup?: SkillGiftLookup,
): Map<number, GiftEffectsReport> {
  return new Map(
    gifts.map((gift) => [gift.id, giftEffectsReport(gift, stats, indexes.identityById, lookup)]),
  );
}

/** A fusion result (조합 기프트): it has a recipe of its own. */
export function isFusionGift(gift: Gift): boolean {
  return gift.fusion !== null;
}

export interface Recommendation {
  /** The deck can use an effect that asks something of it (「지금 덱으로 발동」). */
  deck: GiftEntry[];
  /** Only plain effects are usable, and the gift takes a particular pack (same section, M137). */
  free: GiftEntry[];
  /** 「E.G.O 스킬 조건」: held only by an E.G.O skill condition, any source — the last group. */
  ego: GiftEntry[];
  /** `relevanceReason` per recommended gift — for debugging only. */
  reasons: Map<number, string>;
  /** `recommendationScore` per recommended gift — the order; shown only as `data-score`. */
  scores: Map<number, number>;
}

/**
 * Split `gifts` into the recommended groups, each ranked by `lib/recommend-rank.ts` (today: the
 * identities the effect applies to, most first; ties in the tab's usual order). Gifts that are none
 * are left out. `conditionByGift` only draws the tiles' rings and condition line.
 */
export function recommendedGifts(
  gifts: readonly Gift[],
  conditionByGift: ReadonlyMap<number, ConditionReport[]>,
  effectsByGift: ReadonlyMap<number, GiftEffectsReport>,
  rank: RankContext,
  giftById: GiftById,
): Recommendation {
  const out: Recommendation = { deck: [], free: [], ego: [], reasons: new Map(), scores: new Map() };
  for (const gift of gifts) {
    const report = effectsByGift.get(gift.id);
    const activation = activationOf(gift, report, giftById);
    if (activation === null) continue;
    out[activation].push(classifyGift(gift, conditionByGift.get(gift.id) ?? [], giftById));
    out.reasons.set(gift.id, relevanceReason(report!));
    out.scores.set(gift.id, recommendationScore(report!, rank));
  }
  const scoreOf = (id: number): number => out.scores.get(id) ?? 0;
  for (const list of [out.deck, out.free, out.ego]) list.sort((a, b) => compareRecommended(a, b, scoreOf));
  return out;
}

/** 획득: 팩 전용 = `isPackBound` (팩 전용 재료가 든 조합 포함, M156); 범용 = everything else (범용 드랍, 시작, 범용 재료만의 조합 …). */
export type RecommendAcquisition = 'pack' | 'general';
/** 정렬: by keyword (the default), or pack-bound first — each by score inside (`recommend-rank.ts`). */
export type RecommendSort = 'keyword' | 'pack';

export interface RecommendFilters {
  acquisition: RecommendAcquisition | 'all';
  /** Whether fusion results (`isFusionGift`) stay in the list. */
  fusion: boolean;
  keyword: Keyword | 'all';
  sort: RecommendSort;
}

/** What the tab opens with: 팩 전용 (owner's call, M156) — the gifts that decide a route. */
export const DEFAULT_RECOMMEND_FILTERS: RecommendFilters = {
  acquisition: 'pack',
  fusion: true,
  keyword: 'all',
  sort: 'keyword',
};

/**
 * What 「필터 초기화」 goes back to: nothing narrowing. Not the default, whose 팩 전용 could leave the
 * list as empty as before the reset.
 */
export const CLEARED_RECOMMEND_FILTERS: RecommendFilters = {
  acquisition: 'all',
  fusion: true,
  keyword: 'all',
  sort: 'keyword',
};

/** True when a filter narrows the list (the sort does not). */
export function recommendFiltersActive(filters: RecommendFilters): boolean {
  return filters.acquisition !== 'all' || !filters.fusion || filters.keyword !== 'all';
}

export function matchesRecommendFilters(gift: Gift, filters: RecommendFilters, giftById: GiftById): boolean {
  if (filters.acquisition !== 'all' && isPackBound(gift, giftById) !== (filters.acquisition === 'pack'))
    return false;
  if (!filters.fusion && isFusionGift(gift)) return false;
  if (filters.keyword !== 'all' && gift.keyword !== filters.keyword) return false;
  return true;
}

export interface KeywordGroup {
  keyword: Keyword;
  entries: GiftEntry[];
}

/**
 * The entries grouped by keyword in `order` (the enums' order), each group keeping the order it was
 * given; empty groups are left out, and a keyword missing from `order` goes last.
 */
export function groupByKeyword(entries: readonly GiftEntry[], order: readonly Keyword[]): KeywordGroup[] {
  const groups = new Map<Keyword, GiftEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.gift.keyword);
    if (list) list.push(entry);
    else groups.set(entry.gift.keyword, [entry]);
  }
  const rank = (keyword: Keyword): number => {
    const at = order.indexOf(keyword);
    return at === -1 ? order.length : at;
  };
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([keyword, list]) => ({ keyword, entries: list }));
}
