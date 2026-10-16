import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import {
  attackTypeLabels,
  matchesIdentity,
  searchIdentities,
  searchTerms,
  sinLabels,
} from '../identity-search.ts';

const data = loadGameDataFromDisk();
const { enums } = data;
const byId = (id: number) => data.identities.find((identity) => identity.id === id)!;
const ids = (query: string, mode: 'or' | 'and', sinnerId?: number) =>
  searchIdentities(data.identities, { query, mode, enums, sinnerId })
    .map((identity) => identity.id)
    .sort((a, b) => a - b);

describe('searchTerms', () => {
  it('splits on whitespace, lower-cases, and drops blanks', () => {
    // Arrange
    const query = '  화상   LCB ';
    // Act
    const terms = searchTerms(query);
    // Assert
    expect(terms).toEqual(['화상', 'lcb']);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('matchesIdentity', () => {
  it('lets an empty query through', () => {
    // Arrange
    const identity = byId(10201);
    // Act
    const matched = matchesIdentity(identity, [], 'and', enums);
    // Assert
    expect(matched).toBe(true);
  });

  it('matches one term against the name, the sinner and the 소속 in either language', () => {
    // Arrange
    const dawn = byId(10216); // 파우스트 · 새벽 사무소 해결사 · DAWN
    // Act
    const results = ['새벽', 'dawn office', '파우스트', 'faust', '새벽 사무소'].map((q) =>
      matchesIdentity(dawn, searchTerms(q), 'and', enums),
    );
    // Assert
    expect(results).toEqual([true, true, true, true, true]);
    expect(matchesIdentity(dawn, ['침잠'], 'or', enums)).toBe(false);
  });

  it('reads a term of lead consonants as 초성', () => {
    // Arrange
    const dawn = byId(10216);
    // Act
    const byName = matchesIdentity(dawn, ['ㅅㅂㅅㅁㅅ'], 'or', enums);
    const bySinner = matchesIdentity(dawn, ['ㅍㅇㅅㅌ'], 'or', enums);
    const mixed = matchesIdentity(dawn, ['새ㅂ'], 'or', enums);
    // Assert
    expect(byName).toBe(true);
    expect(bySinner).toBe(true);
    // A half-typed syllable is a substring search, as everywhere else.
    expect(mixed).toBe(false);
  });

  it('finds keywords as the chips name them, 특수 variants included', () => {
    // Arrange: 10614 거미집 약지 아비 uses 충전 and 특수 충전, 10504 N사 큰 망치 only 특수 출혈.
    const nursefather = byId(10614);
    const hammer = byId(10504);
    // Act / Assert
    expect(matchesIdentity(nursefather, searchTerms('특수 충전'), 'and', enums)).toBe(true);
    expect(matchesIdentity(hammer, searchTerms('특수 출혈'), 'and', enums)).toBe(true);
    expect(matchesIdentity(hammer, searchTerms('출혈'), 'and', enums)).toBe(true);
    expect(matchesIdentity(hammer, searchTerms('특수 충전'), 'and', enums)).toBe(false);
    // English keyword names too.
    expect(matchesIdentity(hammer, ['bleed'], 'or', enums)).toBe(true);
  });

  it('writes 탄환 plainly whether the identity spends the 특수 kind or not', () => {
    // Arrange: 10414 잔향・외로움 spends only 특수 탄환 (탄환 - 고독).
    const aroma = byId(10414);
    // Act / Assert
    expect(matchesIdentity(aroma, ['탄환'], 'and', enums)).toBe(true);
    expect(matchesIdentity(aroma, searchTerms('특수 탄환'), 'and', enums)).toBe(false);
  });

  it('finds attack types and sins', () => {
    // Arrange: 10211 홍염살 is 타격 only; 10216 새벽 사무소 해결사 참격 only.
    const ardor = byId(10211);
    const dawn = byId(10216);
    // Act / Assert
    expect(matchesIdentity(ardor, ['타격'], 'or', enums)).toBe(true);
    expect(matchesIdentity(ardor, ['blunt'], 'or', enums)).toBe(true);
    expect(matchesIdentity(ardor, ['참격'], 'or', enums)).toBe(false);
    expect(matchesIdentity(dawn, ['참격'], 'or', enums)).toBe(true);
    expect(matchesIdentity(dawn, ['pierce'], 'or', enums)).toBe(false);
    expect(matchesIdentity(dawn, ['분노'], 'or', enums)).toBe(true);
    expect(matchesIdentity(dawn, ['우울'], 'or', enums)).toBe(false);
  });
});

describe('searchIdentities', () => {
  it('ANDs every term: 「화상 파우스트」 is Faust’s identities that inflict 화상', () => {
    // Arrange
    const query = '화상 파우스트';
    // Act
    const found = ids(query, 'and');
    // Assert
    expect(found).toEqual([10211, 10216]);
  });

  it('ORs the terms by default behaviour: either term is enough, so the list only grows', () => {
    // Arrange
    const burn = ids('화상', 'or');
    const faust = ids('파우스트', 'or');
    // Act
    const either = ids('화상 파우스트', 'or');
    // Assert
    expect(either.length).toBeGreaterThan(Math.max(burn.length, faust.length));
    expect(new Set(either)).toEqual(new Set([...burn, ...faust]));
  });

  it('gives the same answer for one term in either mode', () => {
    // Arrange / Act
    const and = ids('침잠', 'and');
    const or = ids('침잠', 'or');
    // Assert
    expect(and).toEqual(or);
    expect(and.length).toBeGreaterThan(5);
  });

  it('keeps a search fixed to one sinner inside that sinner', () => {
    // Arrange: 2 = 파우스트.
    const sinnerId = 2;
    // Act
    const all = searchIdentities(data.identities, { query: '', mode: 'or', enums, sinnerId });
    const burn = ids('화상', 'or', sinnerId);
    const otherSinner = ids('이상', 'and', sinnerId);
    // Assert
    expect(all.length).toBe(data.identities.filter((identity) => identity.sinnerId === 2).length);
    expect(all.every((identity) => identity.sinnerId === 2)).toBe(true);
    expect(burn).toEqual([10211, 10216]);
    expect(otherSinner).toEqual([]);
  });

  it('returns everyone for an empty query', () => {
    // Arrange / Act
    const found = searchIdentities(data.identities, { query: ' ', mode: 'and', enums });
    // Assert
    expect(found).toHaveLength(data.identities.length);
  });
});

describe('row labels', () => {
  it('lists attack types and sins in the game’s order', () => {
    // Arrange: 10203 is stored as Penetrate, Slash — the row reads 참격 · 관통.
    const remnant = byId(10203);
    // Act
    const attacks = attackTypeLabels(remnant, enums, 'ko');
    const sins = sinLabels(remnant, 'ko');
    // Assert
    expect(attacks).toEqual(['참격', '관통']);
    expect(attackTypeLabels(remnant, enums, 'en')).toEqual(['Slash', 'Pierce']);
    expect(sins).toEqual(['색욕', '우울', '질투']);
  });
});
