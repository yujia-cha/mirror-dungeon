/**
 * One caller's set of gift filters. The items tab and the 「모두 보기」 browser each hold their own —
 * a query typed in the browser is not a query in the tab. The tab uses only the query; the browser
 * also draws `GiftFilterBar` from what this returns.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Gift } from '../../core/schema.ts';
import {
  EMPTY_FILTERS,
  filtersActive,
  matchesGiftAttrs,
  matchesGiftFilters,
  matchesGiftName,
  type GiftFilters,
  type GiftMatcher,
} from './gift-filters.ts';

export interface GiftFilterState {
  filters: GiftFilters;
  /** Change one filter. */
  set: <K extends keyof GiftFilters>(key: K, value: GiftFilters[K]) => void;
  setQuery: (query: string) => void;
  /** Whether any filter narrows the list. */
  filtersOn: boolean;
  /** True while a query is being typed. */
  searching: boolean;
  matchesFilters: (gift: Gift) => boolean;
  /** The name search and the other filters apart, for the parent/child tile rule. */
  matcher: GiftMatcher;
  resetFilters: () => void;
}

/** `initialQuery` seeds the search box — the browser opens on whatever the tab had typed. */
export function useGiftFilters(initialQuery = ''): GiftFilterState {
  const [filters, setFilters] = useState<GiftFilters>(() => ({ ...EMPTY_FILTERS, query: initialQuery }));
  const set = useCallback(
    <K extends keyof GiftFilters>(key: K, value: GiftFilters[K]): void =>
      setFilters((current) => ({ ...current, [key]: value })),
    [],
  );
  const setQuery = useCallback((query: string): void => set('query', query), [set]);
  const resetFilters = useCallback((): void => setFilters(EMPTY_FILTERS), []);
  const matchesFilters = useCallback((gift: Gift): boolean => matchesGiftFilters(gift, filters), [filters]);
  const matcher = useMemo<GiftMatcher>(
    () => ({
      name: (gift) => matchesGiftName(gift, filters),
      attrs: (gift) => matchesGiftAttrs(gift, filters),
    }),
    [filters],
  );
  return useMemo(
    () => ({
      filters,
      set,
      setQuery,
      filtersOn: filtersActive(filters),
      searching: filters.query.trim() !== '',
      matchesFilters,
      matcher,
      resetFilters,
    }),
    [filters, set, setQuery, matchesFilters, matcher, resetFilters],
  );
}
