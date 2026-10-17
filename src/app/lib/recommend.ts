/**
 * 추천 기프트 (M121, 기준은 M129): the gifts the current deck can actually use, for the 「추천 기프트」
 * tab of the 「모두 보기」 browser.
 *
 * The judgement is core's `giftEffectsReport`: a gift is read as effects (`gift.effects`, built from
 * its description), and an effect is usable when the deployed party meets every requirement it and
 * the gift's gates name — a skill that inflicts the keyword, the slot, a faction, an identity-only
 * buff, a sin and attack type, coins, a defense kind. States and battle situations ask nothing.
 *
 * - `deck` (「덱 조건 충족」): some usable effect asks something of the deck, or a met gate opens it;
 * - `free` (「조건 없이 발동 · 팩 전용」): only unconditional effects are usable, and only one pack (or
 *   boss) hands the gift out (`isPackBound`) — that is what decides a route; a general one is left out;
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
import { classifyGift, compareEntries, isPackBound, type GiftEntry } from './gift-priority.ts';

/**
 * Why a gift is recommended: the deck can use an effect that asks for it (`deck`), it is plain and
 * pack-bound (`free`), or only an E.G.O skill condition — always met, owner's call — holds it (`ego`).
 */
export type Activation = 'deck' | 'free' | 'ego';

export function activationOf(gift: Gift, report: GiftEffectsReport | undefined): Activation | null {
  if (!report || report.relevance === null) return null;
  if (report.relevance === 'free') return isPackBound(gift) ? 'free' : null;
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
  /** 「덱 조건 충족」: the deck can use an effect that asks something of it. */
  deck: GiftEntry[];
  /** 「조건 없이 발동 · 팩 전용」: only plain effects are usable, and only one pack (or boss) hands it out. */
  free: GiftEntry[];
  /** 「E.G.O 스킬 조건」: held only by an E.G.O skill condition, any source — the last group. */
  ego: GiftEntry[];
  /** `relevanceReason` per recommended gift — for debugging only. */
  reasons: Map<number, string>;
}

/**
 * Split `gifts` into the two recommended groups, each in the tab's usual order (pack-bound first,
 * closer first, id — `compareEntries`). Gifts that are neither are left out. `conditionByGift` only
 * draws the tiles' rings and condition line.
 */
export function recommendedGifts(
  gifts: readonly Gift[],
  conditionByGift: ReadonlyMap<number, ConditionReport[]>,
  effectsByGift: ReadonlyMap<number, GiftEffectsReport>,
): Recommendation {
  const out: Recommendation = { deck: [], free: [], ego: [], reasons: new Map() };
  for (const gift of gifts) {
    const report = effectsByGift.get(gift.id);
    const activation = activationOf(gift, report);
    if (activation === null) continue;
    out[activation].push(classifyGift(gift, conditionByGift.get(gift.id) ?? []));
    out.reasons.set(gift.id, relevanceReason(report!));
  }
  out.deck.sort(compareEntries);
  out.free.sort(compareEntries);
  out.ego.sort(compareEntries);
  return out;
}

/** 획득: 팩 전용 = `isPackBound`; 범용 = everything else (범용 드랍, 조합, 시작 …). */
export type RecommendAcquisition = 'pack' | 'general';
/** 정렬: by keyword (the default), or the tab's usual order with pack-bound first. */
export type RecommendSort = 'keyword' | 'pack';

export interface RecommendFilters {
  acquisition: RecommendAcquisition | 'all';
  /** Whether fusion results (`isFusionGift`) stay in the list. */
  fusion: boolean;
  keyword: Keyword | 'all';
  sort: RecommendSort;
}

export const DEFAULT_RECOMMEND_FILTERS: RecommendFilters = {
  acquisition: 'all',
  fusion: true,
  keyword: 'all',
  sort: 'keyword',
};

/** True when a filter narrows the list (the sort does not). */
export function recommendFiltersActive(filters: RecommendFilters): boolean {
  return filters.acquisition !== 'all' || !filters.fusion || filters.keyword !== 'all';
}

export function matchesRecommendFilters(gift: Gift, filters: RecommendFilters): boolean {
  if (filters.acquisition !== 'all' && isPackBound(gift) !== (filters.acquisition === 'pack')) return false;
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
