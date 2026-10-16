/**
 * Can screen capture tell every gift and pack apart by name? Run against the real generated data,
 * because the answer depends on which names a season holds, not on the matcher alone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchName, type NameCandidate } from '../src/app/capture/match-name.ts';
import { giftsFileSchema, packsFileSchema, seasonIndexSchema } from '../src/core/schema.ts';

const DATA = resolve(process.cwd(), 'public/data');
const index = seasonIndexSchema.parse(JSON.parse(readFileSync(resolve(DATA, 'index.json'), 'utf8')));
const read = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(DATA, `md${index.default}`, name), 'utf8'));
const gifts = giftsFileSchema.parse(read('gifts.json'));
const packs = packsFileSchema.parse(read('packs.json'));

/** Drop the middle code point of the decomposed name: the commonest OCR slip, one lost jamo. */
function dropOneJamo(name: string): string {
  const chars = [...name.normalize('NFD')];
  chars.splice(Math.floor(chars.length / 2), 1);
  return chars.join('');
}

describe.each([
  ['gifts', gifts],
  ['packs', packs],
] as const)('%s names under capture', (_, items) => {
  describe.each(['ko', 'en'] as const)('%s', (lang) => {
    const candidates: NameCandidate[] = items.map((x) => ({ id: x.id, name: x.name[lang] }));

    it('match themselves exactly and unambiguously', () => {
      const misses = candidates.filter((c) => {
        const r = matchName([c.name], candidates);
        return r.status !== 'match' || r.id !== c.id;
      });
      expect(misses.map((c) => c.name)).toEqual([]);
    });

    it('never confidently match the wrong name after losing one jamo', () => {
      // Against the whole season, not a narrowed context: the worst case.
      const wrong = candidates.filter((c) => {
        const r = matchName([dropOneJamo(c.name)], candidates);
        return r.status === 'match' && r.id !== c.id;
      });
      expect(wrong.map((c) => c.name)).toEqual([]);
    });
  });
});
