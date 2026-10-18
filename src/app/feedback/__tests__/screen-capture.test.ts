/**
 * The pure halves of the app-screen capture: which `@font-face` slices the visible text needs
 * (`unicode-range`) and which addresses may be fetched (same origin only — no request leaves us).
 */
import { describe, expect, it } from 'vitest';
import { codePoints, parseUnicodeRange, rangeHits, sameOrigin } from '../screen-capture.ts';

describe('parseUnicodeRange', () => {
  it('reads a single point, a range and a list, in any case and spacing', () => {
    expect(parseUnicodeRange('U+0041')).toEqual([[0x41, 0x41]]);
    expect(parseUnicodeRange('U+AC00-D7A3')).toEqual([[0xac00, 0xd7a3]]);
    expect(parseUnicodeRange('u+0020-007e, U+00A0 ,U+1F600')).toEqual([
      [0x20, 0x7e],
      [0xa0, 0xa0],
      [0x1f600, 0x1f600],
    ]);
  });

  it('reads a wildcard as the block it covers', () => {
    expect(parseUnicodeRange('U+4??')).toEqual([[0x400, 0x4ff]]);
    expect(parseUnicodeRange('U+00??')).toEqual([[0x00, 0xff]]);
    expect(parseUnicodeRange('U+??????')).toEqual([[0x0, 0xffffff]]);
  });

  it('skips the parts it cannot read and keeps the rest', () => {
    expect(parseUnicodeRange('')).toEqual([]);
    expect(parseUnicodeRange('garbage')).toEqual([]);
    expect(parseUnicodeRange('U+XYZ, U+0041')).toEqual([[0x41, 0x41]]);
    // Too many digits, a missing prefix, a bad end: none is a range.
    expect(parseUnicodeRange('U+1234567, 0041, U+0041-XYZ')).toEqual([]);
  });
});

describe('rangeHits', () => {
  const korean = parseUnicodeRange('U+AC00-D7A3');

  it('is true when any point of the text falls in any range', () => {
    expect(rangeHits(korean, codePoints('Mirror 거울'))).toBe(true);
    expect(rangeHits(parseUnicodeRange('U+0041, U+AC00-D7A3'), codePoints('A'))).toBe(true);
    expect(rangeHits(parseUnicodeRange('U+4??'), codePoints('Ж'))).toBe(true);
  });

  it('is false when none does, and for no text at all', () => {
    expect(rangeHits(korean, codePoints('Mirror'))).toBe(false);
    expect(rangeHits(korean, codePoints(''))).toBe(false);
  });

  it('treats a rule without a unicode-range as covering everything', () => {
    expect(rangeHits([], codePoints('anything'))).toBe(true);
    expect(rangeHits([], codePoints(''))).toBe(true);
  });

  it('includes both ends of a range', () => {
    expect(rangeHits(korean, new Set([0xac00]))).toBe(true);
    expect(rangeHits(korean, new Set([0xd7a3]))).toBe(true);
    expect(rangeHits(korean, new Set([0xd7a4]))).toBe(false);
  });
});

describe('sameOrigin', () => {
  const base = 'https://yujia-cha.github.io/mirror-dungeon/';

  it('takes the page’s own addresses, relative ones included', () => {
    expect(sameOrigin('https://yujia-cha.github.io/mirror-dungeon/icons/gifts/a.webp', base)).toBe(true);
    expect(sameOrigin('icons/gifts/a.webp', base)).toBe(true);
    expect(sameOrigin('/other/path.woff2', base)).toBe(true);
  });

  it('refuses another origin — another host, scheme or port', () => {
    expect(sameOrigin('https://example.com/a.png', base)).toBe(false);
    expect(sameOrigin('http://yujia-cha.github.io/mirror-dungeon/a.png', base)).toBe(false);
    expect(sameOrigin('https://yujia-cha.github.io:8443/a.png', base)).toBe(false);
    expect(sameOrigin('//example.com/a.png', base)).toBe(false);
  });

  it('takes data and blob addresses, which need no request', () => {
    expect(sameOrigin('data:image/png;base64,AAAA', base)).toBe(true);
    expect(sameOrigin('blob:https://yujia-cha.github.io/1234', base)).toBe(true);
  });

  it('refuses what it cannot parse instead of throwing', () => {
    expect(sameOrigin('http://[::1', base)).toBe(false);
    expect(sameOrigin('a.png', 'not a url')).toBe(false);
  });
});
