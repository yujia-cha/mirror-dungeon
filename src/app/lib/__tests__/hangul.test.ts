import { describe, expect, it } from 'vitest';
import { matchesQuery } from '../hangul.ts';

describe('matchesQuery', () => {
  it('matches a plain substring as the search always did', () => {
    expect(matchesQuery('진혼 rest', '진혼')).toBe(true);
    expect(matchesQuery('진혼 rest', 'rest')).toBe(true);
    expect(matchesQuery('진혼 rest', '화상')).toBe(false);
    expect(matchesQuery('진혼', '')).toBe(true);
  });

  it('reads a query of lead consonants as 초성', () => {
    expect(matchesQuery('진혼', 'ㅈㅎ')).toBe(true);
    expect(matchesQuery('검은 상처', 'ㄱㅇㅅㅊ')).toBe(true);
    // A space is not a lead consonant, so the query is taken literally and finds nothing.
    expect(matchesQuery('검은 상처', 'ㄱㅇ ㅅㅊ')).toBe(false);
    expect(matchesQuery('검은 상처', 'ㄱㅅ')).toBe(false);
    // The 초성 run reads across the space, so a query may start mid-name.
    expect(matchesQuery('검은 상처', 'ㅇㅅ')).toBe(true);
  });

  it('casts a wider net in 초성 mode, which is what 초성 mode is for', () => {
    // 「ㅈㅎ」 cannot tell 진혼 from 전혀 — the player narrows it by typing a vowel.
    expect(matchesQuery('전혀', 'ㅈㅎ')).toBe(true);
    expect(matchesQuery('전혀', '진ㅎ')).toBe(false);
  });

  it('leaves anything that is not a whole 초성 query to the substring match', () => {
    // 「ㄳ」 and 「ㅏ」 are Hangul but never lead a syllable.
    expect(matchesQuery('값진 것', 'ㄳ')).toBe(false);
    expect(matchesQuery('가시', 'ㅏㅣ')).toBe(false);
    expect(matchesQuery('ㅎ', 'ㅎ')).toBe(true);
    expect(matchesQuery('mirror 7', '7')).toBe(true);
    expect(matchesQuery('mirror 7', 'ㅁ')).toBe(false);
  });
});
