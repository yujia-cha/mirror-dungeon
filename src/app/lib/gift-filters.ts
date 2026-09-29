/**
 * The gift filters: what the items tab and the 「모두 보기」 browser narrow the gift list by, and the
 * one predicate both apply. Pure — the state that holds a set of filters is `useGiftFilters`.
 */
import type { AcquisitionKind, Gift, Keyword, Sin } from '../../core/schema.ts';
import { matchesQuery } from './hangul.ts';

export type TierFilter = '1' | '2' | '3' | '4' | '5' | 'EX';
export type PriceFilter = 'p1' | 'p2' | 'p3' | 'p4';
/** 「조건 없음」 keeps the gifts a deck cannot fail; 「덱 조건」 keeps the ones it can. */
export type ConditionFilter = 'none' | 'gated';

export const PRICE_BANDS: Record<PriceFilter, [number, number]> = {
  p1: [0, 150],
  p2: [151, 250],
  p3: [251, 400],
  p4: [401, Infinity],
};

export interface GiftFilters {
  query: string;
  keyword: Keyword | 'all';
  condition: ConditionFilter | 'all';
  tier: TierFilter | 'all';
  acquisition: AcquisitionKind | 'all';
  sin: Sin | 'all';
  price: PriceFilter | 'all';
}

export const EMPTY_FILTERS: GiftFilters = {
  query: '',
  keyword: 'all',
  condition: 'all',
  tier: 'all',
  acquisition: 'all',
  sin: 'all',
  price: 'all',
};

/**
 * Whether the deck decides anything about this gift: a keyword count with a threshold, or a
 * faction count. A count with no threshold (「편성된 수에 따라 강화」, `min: null`) only scales the
 * effect, and a full-resonance condition is decided in battle — neither is a bar a deck can fail,
 * so a gift with only those has no deck condition.
 */
export function hasDeckCondition(gift: Gift): boolean {
  return gift.conditions.some(
    (c) => (c.type === 'keywordSkillCount' && c.min !== null) || c.type === 'factionCount',
  );
}

/** True when any filter narrows the list. */
export function filtersActive(filters: GiftFilters): boolean {
  return (
    filters.keyword !== 'all' ||
    filters.condition !== 'all' ||
    filters.tier !== 'all' ||
    filters.acquisition !== 'all' ||
    filters.sin !== 'all' ||
    filters.price !== 'all' ||
    filters.query.trim() !== ''
  );
}

/** The name search alone: an upgrade child's name finds its parent, so this is asked of children too. */
export function matchesGiftName(gift: Gift, filters: GiftFilters): boolean {
  const needle = filters.query.trim().toLowerCase();
  return matchesQuery(`${gift.name.ko} ${gift.name.en}`.toLowerCase(), needle);
}

/**
 * Every filter but the name. These are asked of the gift itself — a parent tile stands on its own
 * keyword, condition, tier and so on, and a child under it is shown only when it passes them too.
 */
export function matchesGiftAttrs(gift: Gift, filters: GiftFilters): boolean {
  if (filters.keyword !== 'all' && gift.keyword !== filters.keyword) return false;
  if (filters.condition !== 'all' && hasDeckCondition(gift) !== (filters.condition === 'gated')) return false;
  if (filters.tier !== 'all' && String(gift.tier) !== filters.tier) return false;
  if (filters.acquisition !== 'all' && gift.acquisition.kind !== filters.acquisition) return false;
  if (filters.sin !== 'all' && gift.sin !== filters.sin) return false;
  if (filters.price !== 'all') {
    const [lo, hi] = PRICE_BANDS[filters.price];
    if (gift.price === null || gift.price < lo || gift.price > hi) return false;
  }
  return true;
}

export function matchesGiftFilters(gift: Gift, filters: GiftFilters): boolean {
  return matchesGiftName(gift, filters) && matchesGiftAttrs(gift, filters);
}

/** The two halves a tile list needs separately (see `browsableParents`). */
export interface GiftMatcher {
  name: (gift: Gift) => boolean;
  attrs: (gift: Gift) => boolean;
}
