/**
 * The Korean particle on a name (M166). The game hangs notes and marks on some gift names —
 * 「덕목 - 지(智)」, 「한 잔 더!」, 「강화제 Mk.4」 — and the particle used to fall back to 「을(를)」
 * on every one of them. The ending that decides it is the name without those, and a digit or
 * Latin letter reads by its Korean name.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { fillTemplate, hasBatchim, josa } from '../text.ts';

describe('josa', () => {
  it.each([
    ['a final consonant', '화상', '화상을'],
    ['no final consonant', '연기', '연기를'],
    ['a bracketed note', '덕목 - 지(智)', '덕목 - 지(智)를'],
    ['a bracketed note after a consonant', '덕목 - 용(勇)', '덕목 - 용(勇)을'],
    ['a square-bracketed note', '본국검보[本國劍譜]', '본국검보[本國劍譜]를'],
    ['a note after the whole name', '절차탁마(切磋琢磨)', '절차탁마(切磋琢磨)를'],
    ['an exclamation mark', '한 잔 더!', '한 잔 더!를'],
    ['an exclamation mark after a consonant', '박수 짝짝!', '박수 짝짝!을'],
    ['a note and a mark', '이름(주)!', '이름(주)!을'],
  ])('reads past %s', (_, word, expected) => {
    // Arrange / Act
    const out = josa(word, '을/를');
    // Assert
    expect(out).toBe(expected);
  });

  it.each([
    ['0', '0을'],
    ['1', '1을'],
    ['2', '2를'],
    ['3', '3을'],
    ['4', '4를'],
    ['5', '5를'],
    ['6', '6을'],
    ['7', '7을'],
    ['8', '8을'],
    ['9', '9를'],
    ['강화제 Mk.4', '강화제 Mk.4를'],
    ['9088', '9088을'],
  ])('reads a final digit by its name: %s', (word, expected) => {
    expect(josa(word, '을/를')).toBe(expected);
  });

  it.each([
    ['회중시계 : 타입 L', '회중시계 : 타입 L을'],
    ['회중시계 : 타입 E', '회중시계 : 타입 E를'],
    ['회중시계 : 타입 Y', '회중시계 : 타입 Y를'],
    ['회중시계 : 타입 P', '회중시계 : 타입 P를'],
    ['변형 추출 : AEDD', '변형 추출 : AEDD를'],
    ['M', 'M을'],
    ['N', 'N을'],
    ['R', 'R을'],
    ['Burn', 'Burn을'],
    ['Bell', 'Bell을'],
    ['Dead', 'Dead를'],
    ['Flask', 'Flask를'],
  ])('reads a final Latin letter by its name: %s', (word, expected) => {
    expect(josa(word, '을/를')).toBe(expected);
  });

  it.each([
    ['an empty name', ''],
    ['only marks', '!!!'],
    ['a lone ideograph', '智'],
    ['a Greek letter', 'α'],
  ])('keeps the bracketed form when the ending cannot be read: %s', (_, word) => {
    expect(hasBatchim(word)).toBeNull();
    expect(josa(word, '이/가')).toBe(`${word}이(가)`);
  });

  it('chooses each pair the same way', () => {
    expect(josa('타입 L', '이/가')).toBe('타입 L이');
    expect(josa('Mk.4', '은/는')).toBe('Mk.4는');
    expect(josa('한 잔 더!', '과/와')).toBe('한 잔 더!와');
  });

  it('leaves no MD8 gift name on the bracketed form', () => {
    // Arrange: the names whose last character is not Hangul — 13 in MD8.
    const names = loadGameDataFromDisk()
      .gifts.map((gift) => gift.name.ko)
      .filter((name) => {
        const code = name.codePointAt(name.length - 1) ?? 0;
        return code < 0xac00 || code > 0xd7a3;
      });
    expect(names.length).toBeGreaterThan(0);
    // Act / Assert
    for (const name of names) expect(hasBatchim(name)).not.toBeNull();
  });

  it('is what fillTemplate attaches', () => {
    expect(fillTemplate('{g|을/를} 얻습니다', 'ko', { g: { ko: '한 잔 더!', en: 'One More!' } })).toBe(
      '한 잔 더!를 얻습니다',
    );
    expect(fillTemplate('{g|을/를} 얻습니다', 'en', { g: { ko: '한 잔 더!', en: 'One More!' } })).toBe(
      'One More! 얻습니다',
    );
  });
});
