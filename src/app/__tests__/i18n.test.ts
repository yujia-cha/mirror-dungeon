/**
 * M160: `t()` fills every placeholder in one pass, so a value is never read as a placeholder.
 */
import { describe, expect, it } from 'vitest';
import { STRINGS, t, type StringKey } from '../i18n.ts';

/** A string with two placeholders and their names, whichever one the copy has. */
function twoPlaceholders(): { key: StringKey; a: string; b: string } {
  for (const key of Object.keys(STRINGS) as StringKey[]) {
    const names = [...STRINGS[key].ko.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    if (new Set(names).size >= 2) return { key, a: names[0]!, b: names[1]! };
  }
  throw new Error('the copy has no string with two placeholders');
}

describe('t', () => {
  it('leaves a {name} inside a value alone instead of filling it with the next parameter', () => {
    // Arrange: the first value is the literal text of the second placeholder.
    const { key, a, b } = twoPlaceholders();
    // Act
    const out = t(key, 'ko', { [a]: `{${b}}`, [b]: 'X' });
    // Assert: `{b}` survives as text, and X stands exactly where {b} stood in the template.
    expect(out).toContain(`{${b}}`);
    expect(out.split('X')).toHaveLength(STRINGS[key].ko.split(`{${b}}`).length);
    expect(out).toBe(STRINGS[key].ko.split(`{${b}}`).join('X').split(`{${a}}`).join(`{${b}}`));
  });

  it('keeps a placeholder no parameter names, and fills numbers', () => {
    const { key, a, b } = twoPlaceholders();
    const out = t(key, 'ko', { [a]: 3 });
    expect(out).toContain('3');
    expect(out).toContain(`{${b}}`);
    expect(t(key, 'ko')).toBe(STRINGS[key].ko);
  });
});
