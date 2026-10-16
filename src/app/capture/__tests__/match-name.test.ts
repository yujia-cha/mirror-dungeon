import { describe, expect, it } from 'vitest';
import {
  containedSimilarity,
  editDistance,
  matchName,
  namePieces,
  normalizeName,
  similarity,
} from '../match-name.ts';

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

describe('containedSimilarity', () => {
  it('scores a title inside a longer line as a full match', () => {
    expect(
      containedSimilarity('빛나는 잔영을를 코스트에 판매하시겠습니까', '코스트에 판매하시겠습니까'),
    ).toBe(1);
  });

  it('forgives a slip inside the title, and finds nothing in unrelated text', () => {
    // Arrange: one jamo off (ㅁ→ㄴ) inside the title.
    const slipped = containedSimilarity('1층 탐사 증', '층 탐사 중');
    // Act + Assert
    expect(slipped).toBeGreaterThan(0.8);
    expect(slipped).toBeLessThan(1);
    expect(containedSimilarity('다음 층에서 특별한 상점 등장 확률', '층 탐사 중')).toBeLessThan(0.8);
  });

  it('is 0 for empty input', () => {
    expect(containedSimilarity('', '층 탐사 중')).toBe(0);
    expect(containedSimilarity('층 탐사 중', '')).toBe(0);
  });
});

describe('namePieces', () => {
  it('lifts the name out of the sentences the game wraps it in', () => {
    // Arrange: a sell confirm, a buff toast and an event result.
    const lines = [
      '[빛나는 잔영]을(를) 코스트 300에',
      '별의 가호<완전한 가능성>효과로 잔영 획득',
      'E.G.O 기프트 커피와 종이학 획득!',
    ];
    // Act
    const pieces = namePieces(lines);
    // Assert
    expect(pieces).toEqual(expect.arrayContaining(['빛나는 잔영', '잔영', '커피와 종이학']));
  });

  it('keeps a single plain line as it is', () => {
    expect(namePieces(['해진 우산'])).toEqual(['해진 우산']);
    expect(namePieces([])).toEqual([]);
  });

  it('joins neighbouring lines both ways, for a name wrapped inside its button', () => {
    // Arrange: real OCR of 「붉게 물든 목화」, the halves out of order.
    const lines = ['물든 목하', '붉게 물든'];
    // Act + Assert
    // Joined without repeating the overlap 「물든」; the other order is a plain join.
    expect(namePieces(lines)).toEqual(expect.arrayContaining(['붉게 물든 목하', '물든 목하 붉게 물든']));
    expect(
      matchName(lines, [
        { id: 1, name: '붉게 물든 목화' },
        { id: 2, name: '흰 목화' },
      ]),
    ).toMatchObject({ status: 'match', id: 1 });
  });
});

describe('matchName with a wrapped name', () => {
  it('matches the bracketed name of a sell confirm', () => {
    const gifts = [
      { id: 1, name: '빛나는 잔영' },
      { id: 2, name: '찬란한 잔영' },
      { id: 3, name: '잔영' },
    ];
    expect(matchName(['[빛나는 잔영]을(를) 코스트 300에'], gifts)).toMatchObject({ status: 'match', id: 1 });
    expect(matchName(['별의 가호<완전한 가능성>효과로 잔영 획득'], gifts)).toMatchObject({
      status: 'match',
      id: 3,
    });
  });
});

describe('matchName, pruned (M116)', () => {
  /** The scan before M116: every piece against every name, no shortcut. */
  function plain(lines: string[], candidates: { id: number; name: string }[]) {
    const best = new Map<number, number>();
    for (const line of namePieces(lines)) {
      if (normalizeName(line) === '') continue;
      for (const c of candidates) {
        const score = similarity(line, c.name);
        if (score > (best.get(c.id) ?? 0)) best.set(c.id, score);
      }
    }
    return best;
  }

  it('answers exactly as the full scan, margins included', () => {
    // Arrange: names of every length, and reads that are close, far, wrapped or noisy.
    const names = [
      '해진 우산',
      '깨진 안경',
      '부치지 못한 편지',
      '생강꽃, 안경 그리고 전해진 편지',
      '4호선 - 제 3 구간',
      '4호선 - 제 4 구간',
      '타입 L',
      '타입 E',
      'Broken Glasses',
      '빛나는 잔영',
      '잔영',
    ].map((name, i) => ({ id: i + 1, name }));
    const reads = [
      ['해진우산'],
      ['깨진 안견', '300   코스트'],
      ['생강꽃, 안경 그리고', '전해진 편지'],
      ['4호선 - 제 3 구간'],
      ['타입 l'],
      ['broken glases'],
      ['[빛나는 잔영]을(를) 코스트 300에 판매합니다'],
      ['완전히 다른 글', '아무것'],
      ['잔'],
    ];
    for (const lines of reads) {
      // Act
      const result = matchName(lines, names);
      // Assert: the same ranking the full scan gives decides it.
      const ranked = [...plain(lines, names)].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const [first, second] = ranked;
      if (!first || first[1] < 0.75) expect(result).toEqual({ status: 'none' });
      else expect(result).toMatchObject({ score: first[1], margin: first[1] - (second?.[1] ?? 0) });
    }
  });
});
