/**
 * The gift filters of the 「모두 보기」 browser (the items tab keeps only the query): the 「조건」
 * predicate against real gifts, the combined predicate, and the hook that holds one caller's filters.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildIndexes } from '../../../core/index.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { EMPTY_FILTERS, filtersActive, hasDeckCondition, matchesGiftFilters } from '../gift-filters.ts';
import { useGiftFilters } from '../useGiftFilters.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const gift = (id: number) => indexes.giftById.get(id)!;

describe('hasDeckCondition', () => {
  it('is false for a gift with no condition (지옥나비의 꿈)', () => {
    expect(gift(9001).conditions).toEqual([]);
    expect(hasDeckCondition(gift(9001))).toBe(false);
  });

  it('is false for a keyword count with no threshold — 「편성된 수에 따라 강화」 (피로 된 살점, 살점으로 된 피)', () => {
    expect(gift(9842).conditions).toMatchObject([{ type: 'keywordSkillCount', min: null }]);
    expect(hasDeckCondition(gift(9842))).toBe(false);
  });

  it('is true for a keyword count with a threshold (데스페라도)', () => {
    expect(gift(9235).conditions).toMatchObject([{ type: 'keywordSkillCount', min: 2 }]);
    expect(hasDeckCondition(gift(9235))).toBe(true);
  });

  it('is true for a faction count (검은 장부)', () => {
    expect(gift(9712).conditions).toMatchObject([{ type: 'factionCount' }]);
    expect(hasDeckCondition(gift(9712))).toBe(true);
  });

  it('is false for a full-resonance condition alone — that is decided in battle (인연 얽힘)', () => {
    expect(gift(9208).conditions).toMatchObject([{ type: 'fullResonance' }]);
    expect(hasDeckCondition(gift(9208))).toBe(false);
  });
});

describe('matchesGiftFilters', () => {
  it('passes everything with no filter set', () => {
    expect(data.gifts.every((g) => matchesGiftFilters(g, EMPTY_FILTERS))).toBe(true);
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
  });

  it('「조건 없음」 keeps the ungated gifts and 「덱 조건」 the gated ones', () => {
    const none = { ...EMPTY_FILTERS, condition: 'none' as const };
    const gated = { ...EMPTY_FILTERS, condition: 'gated' as const };
    for (const id of [9001, 9842, 9208]) {
      expect(matchesGiftFilters(gift(id), none)).toBe(true);
      expect(matchesGiftFilters(gift(id), gated)).toBe(false);
    }
    for (const id of [9235, 9712]) {
      expect(matchesGiftFilters(gift(id), none)).toBe(false);
      expect(matchesGiftFilters(gift(id), gated)).toBe(true);
    }
    // The two halves are the whole list.
    const kept = data.gifts.filter((g) => matchesGiftFilters(g, none) || matchesGiftFilters(g, gated));
    expect(kept).toHaveLength(data.gifts.length);
    expect(data.gifts.some((g) => matchesGiftFilters(g, none) && matchesGiftFilters(g, gated))).toBe(false);
  });

  it('matches the query against either name, and the tier and the sin against the gift itself', () => {
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, query: '진혼' })).toBe(true);
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, query: gift(9088).name.en.slice(0, 4) })).toBe(
      true,
    );
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, query: '없는이름' })).toBe(false);
    // 진혼 is a T4 PRIDE gift.
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, tier: '4' })).toBe(true);
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, tier: '3' })).toBe(false);
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, sin: 'PRIDE' })).toBe(true);
    expect(matchesGiftFilters(gift(9088), { ...EMPTY_FILTERS, sin: 'LUST' })).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, sin: 'LUST' })).toBe(true);
    expect(filtersActive({ ...EMPTY_FILTERS, query: '  ' })).toBe(false);
  });
});

describe('useGiftFilters', () => {
  it('holds one set of filters, says when they narrow, and resets in one go', () => {
    const { result } = renderHook(() => useGiftFilters());
    expect(result.current.filtersOn).toBe(false);
    expect(result.current.searching).toBe(false);
    expect(result.current.matchesFilters(gift(9235))).toBe(true);
    act(() => result.current.set('condition', 'none'));
    expect(result.current.filtersOn).toBe(true);
    expect(result.current.filters.condition).toBe('none');
    expect(result.current.matchesFilters(gift(9235))).toBe(false);
    expect(result.current.matchesFilters(gift(9001))).toBe(true);
    act(() => result.current.setQuery('진혼'));
    expect(result.current.searching).toBe(true);
    expect(result.current.filters.query).toBe('진혼');
    act(() => result.current.resetFilters());
    expect(result.current.filters).toEqual(EMPTY_FILTERS);
    expect(result.current.filtersOn).toBe(false);
    expect(result.current.matchesFilters(gift(9235))).toBe(true);
  });

  it('knows only keyword, condition, tier and sin besides the name — no price, no source', () => {
    expect(Object.keys(EMPTY_FILTERS).sort()).toEqual(['condition', 'keyword', 'query', 'sin', 'tier']);
  });

  it('opens on the query it is given, and a reset clears that too', () => {
    const { result } = renderHook(() => useGiftFilters('진혼'));
    expect(result.current.filters.query).toBe('진혼');
    expect(result.current.searching).toBe(true);
    expect(result.current.matchesFilters(gift(9088))).toBe(true);
    expect(result.current.matchesFilters(gift(9235))).toBe(false);
    act(() => result.current.resetFilters());
    expect(result.current.filters.query).toBe('');
  });

  it('keeps its own state per caller', () => {
    const a = renderHook(() => useGiftFilters());
    const b = renderHook(() => useGiftFilters());
    act(() => a.result.current.set('tier', '4'));
    expect(a.result.current.filters.tier).toBe('4');
    expect(b.result.current.filters.tier).toBe('all');
  });
});
