/**
 * 추천 기프트 (M121): the gifts the current deck can actually set off, for the 「추천 기프트」 tab of
 * the 「모두 보기」 browser.
 *
 * It decides nothing new about conditions — it reads the same `ConditionReport`s the tiles' rings
 * read (`evaluateConditions` via `conditionReportsByGift`) and the same `judgementOf`:
 *
 * - a gift with threshold conditions (`gate`) is recommended when every one is met (`met`); one
 *   that cannot be judged from a deck (완전 공명, an unparsed sentence) is not;
 * - a gift whose only conditions have no threshold (「편성된 수에 따라 강화」, `gate === false`) is
 *   recommended once at least one **deployed** identity counts toward it (owner's answer). Those
 *   sentences count the whole formation, reserves included, so the deployed count comes from a
 *   second evaluation over the deployed party alone (`deployedConditionReports`) — the same core
 *   counting, not a second copy of it;
 * - a gift with no condition at all works with any deck, so a deck cannot recommend it — except a
 *   pack-bound one (테마팩 한정 · 클리어 보상, `isPackBound`), which is what decides a route. Those
 *   go in a group of their own (`free`).
 *
 * Pure: the browser holds the filter state and draws the tiles.
 */
import { analyseDeck } from '../../core/index.ts';
import type { GameData, Gift, Keyword } from '../../core/schema.ts';
import type { ConditionReport, DeckStats, GameIndexes } from '../../core/types.ts';
import { conditionReportsByGift } from './gift-tile.ts';
import { classifyGift, compareEntries, isPackBound, type GiftEntry } from './gift-priority.ts';
import { judgementOf } from './judgement.ts';

/** Why a gift is recommended: the deck meets its condition, or it has none and is pack-bound. */
export type Activation = 'deck' | 'free';

/**
 * `reports` are the gift's conditions judged on the deck as the rings judge them; `deployedReports`
 * are the same conditions counted over the deployed party alone (defaults to `reports`, which is
 * right when the counts are already deployed-only).
 */
export function activationOf(
  gift: Gift,
  reports: readonly ConditionReport[],
  deployedReports: readonly ConditionReport[] = reports,
): Activation | null {
  if (gift.conditions.length === 0) return isPackBound(gift) ? 'free' : null;
  if (reports.some((report) => report.gate)) return judgementOf([...reports]) === 'met' ? 'deck' : null;
  // Only counts without a threshold: one deployed identity that counts is enough to strengthen it.
  return deployedReports.some((report) => (report.have ?? 0) >= 1) ? 'deck' : null;
}

/**
 * Every conditional gift's reports with the deck cut down to its deployed party: whoever is in
 * reserve is gone, so a 「편성된」 count is then a count of the deployed.
 */
export function deployedConditionReports(
  data: GameData,
  stats: DeckStats,
  indexes: GameIndexes,
): Map<number, ConditionReport[]> {
  const party = analyseDeck(stats.deployed, indexes, data.rules.deployment, stats.deployed);
  return conditionReportsByGift(data, party, indexes);
}

/** A fusion result (조합 기프트): it has a recipe of its own. */
export function isFusionGift(gift: Gift): boolean {
  return gift.fusion !== null;
}

export interface Recommendation {
  /** 「덱 조건 충족」: the deck meets every condition (or counts toward a threshold-less one). */
  deck: GiftEntry[];
  /** 「조건 없이 발동 · 팩 전용」: no condition, and only one pack (or boss) hands it out. */
  free: GiftEntry[];
}

/**
 * Split `gifts` into the two recommended groups, each in the tab's usual order (pack-bound first,
 * closer first, id — `compareEntries`). Gifts that are neither are left out.
 */
export function recommendedGifts(
  gifts: readonly Gift[],
  conditionByGift: ReadonlyMap<number, ConditionReport[]>,
  deployedByGift: ReadonlyMap<number, ConditionReport[]> = conditionByGift,
): Recommendation {
  const out: Recommendation = { deck: [], free: [] };
  for (const gift of gifts) {
    const reports = conditionByGift.get(gift.id) ?? [];
    const activation = activationOf(gift, reports, deployedByGift.get(gift.id) ?? []);
    if (activation !== null) out[activation].push(classifyGift(gift, reports));
  }
  out.deck.sort(compareEntries);
  out.free.sort(compareEntries);
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
