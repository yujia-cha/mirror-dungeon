import { describe, expect, it } from 'vitest';
import { editDistance, matchName, normalizeName, similarity } from '../match-name.ts';

const GIFTS = [
  { id: 1, name: '해진 우산' },
  { id: 2, name: '깨진 안경' },
  { id: 3, name: '부치지 못한 편지' },
];

describe('normalizeName', () => {
  it('drops spaces, punctuation and upgrade marks', () => {
    // Arrange
    const read = ' 해진  우산++ ';
    // Act
    const normalized = normalizeName(read);
    // Assert
    expect(normalized).toBe(normalizeName('해진우산'));
  });

  it('lowercases English names', () => {
    expect(normalizeName('Broken Glasses')).toBe(normalizeName('broken glasses'));
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('similarity', () => {
  it('costs a misread 받침 one jamo, not a whole syllable', () => {
    // Arrange: OCR dropped the ㄴ of 「진」.
    const read = '해지 우산';
    // Act
    const score = similarity(read, '해진 우산');
    // Assert: 1 edit over the 10 jamo of 해진우산.
    expect(score).toBeCloseTo(1 - 1 / 10);
  });

  it('never matches empty text', () => {
    expect(similarity('', '해진 우산')).toBe(0);
    expect(similarity('  ++ ', '해진 우산')).toBe(0);
  });
});

describe('matchName', () => {
  it('picks the exact name with full confidence', () => {
    // Act
    const result = matchName(['깨진 안경'], GIFTS);
    // Assert
    expect(result).toEqual({ status: 'match', id: 2, score: 1, margin: expect.any(Number) });
  });

  it('corrects a small OCR error to the closest name', () => {
    expect(matchName(['부치지 못한 편시'], GIFTS)).toMatchObject({ status: 'match', id: 3 });
  });

  it('reads the best of several lines, ignoring labels around the name', () => {
    // Arrange: a crop that caught the popup title and a price.
    const lines = ['E.G.O 기프트 획득', '해진 우산', '150'];
    // Act
    const result = matchName(lines, GIFTS);
    // Assert
    expect(result).toMatchObject({ status: 'match', id: 1, score: 1 });
  });

  it('reads a name apart from what sits beside it on the same line', () => {
    // Arrange: Tesseract reads a price far to the right as one line, garbled, after a wide gap.
    const sections = [
      { id: 3, name: '4호선 - 제 3 구간' },
      { id: 4, name: '4호선 - 제 4 구간' },
    ];
    // Act
    const result = matchName(['4호선 -제 3 구간                         델'], sections);
    // Assert
    expect(result).toMatchObject({ status: 'match', id: 3, score: 1 });
  });

  it('returns none for text that is like no candidate', () => {
    expect(matchName(['테마팩 선택'], GIFTS)).toEqual({ status: 'none' });
    expect(matchName([], GIFTS)).toEqual({ status: 'none' });
    expect(matchName(['해진 우산'], [])).toEqual({ status: 'none' });
  });

  it('asks instead of guessing when two names are equally close', () => {
    // Arrange: one jamo away from each of two candidates.
    const twins = [
      { id: 10, name: '가나' },
      { id: 11, name: '가다' },
    ];
    // Act: 「가라」 is one substitution from both.
    const result = matchName(['가라'], twins, { minScore: 0.5, minMargin: 0.1 });
    // Assert: ordered by id when the scores tie.
    expect(result).toMatchObject({ status: 'ambiguous', ids: [10, 11] });
  });

  it('takes a unique exact read even when a sibling name is one character away', () => {
    // Arrange: real pack names that differ only in the section number.
    const sections = [
      { id: 3, name: '4호선 - 제 3 구간' },
      { id: 4, name: '4호선 - 제 4 구간' },
    ];
    // Act
    const exact = matchName(['4호선 - 제 4 구간'], sections);
    const blurred = matchName(['4호선 - 제 구간'], sections);
    // Assert: the exact read is applied; a read that lost the digit is asked about.
    expect(exact).toMatchObject({ status: 'match', id: 4 });
    expect(blurred).toMatchObject({ status: 'ambiguous', ids: [3, 4] });
  });

  it('treats the thresholds as inclusive lower bounds', () => {
    // Arrange: 「해지 우산」 scores exactly 0.9 against 「해진 우산」.
    const single = [{ id: 1, name: '해진 우산' }];
    // Act + Assert
    expect(matchName(['해지 우산'], single, { minScore: 0.9, minMargin: 0 })).toMatchObject({
      status: 'match',
    });
    expect(matchName(['해지 우산'], single, { minScore: 0.91, minMargin: 0 })).toEqual({
      status: 'none',
    });
  });
});
