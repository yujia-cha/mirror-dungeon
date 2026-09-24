// @vitest-environment node
//
// The pipeline readers resolve the repo root from `import.meta.url`, which is not a file URL under
// jsdom; this suite reads data/raw straight off disk like the scripts do.
/**
 * Evidence that the Mirror Dungeon fallback will work when it is finally needed.
 *
 * OpenLethe's capture is frozen, so the season after this one has to be built from the derived
 * mirror instead. That code path cannot run today — the static data is still here — which is exactly
 * how a fallback rots. So it is exercised against the current season: rebuild what we already have
 * from the derived source alone and check it lands in the same place.
 *
 * What is *not* covered is stated as loudly as what is: the derived source has no per-pack general
 * gift pool, no prices, no observation list and no dungeon constants, and the last test pins that.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { giftsFileSchema, packsFileSchema, rulesSchema } from '../src/core/schema.ts';
import { availabilityFor, tierFromTags } from '../scripts/lib/derive.ts';
import {
  derivedFixedRecipes,
  derivedGiftAsRaw,
  derivedMdPresent,
  derivedPackAsRaw,
  readDerivedAvailability,
  readDerivedGifts,
  readDerivedPacks,
  readDerivedStartPools,
} from '../scripts/lib/derived-md.ts';
import { defaultSeason, outPath } from '../scripts/lib/out.ts';

/** Whatever season `index.json` opens: the one the vendored raw data describes. */
const season = defaultSeason() ?? 7;
const read = (name: string): unknown =>
  JSON.parse(
    readFileSync(outPath(name.replace(/\.json$/, '') as Parameters<typeof outPath>[0], season), 'utf8'),
  );
const packs = packsFileSchema.parse(read('packs.json'));
const gifts = giftsFileSchema.parse(read('gifts.json'));
const rules = rulesSchema.parse(read('rules.json'));

const hasRaw = derivedMdPresent() && existsSync(resolve(process.cwd(), 'data/raw/static'));

/** The pack that exists but cannot be chosen, so the derived floor map rightly omits it. */
const STORY_ONLY_PACK = 1122;

describe.skipIf(!hasRaw)('Mirror Dungeon fallback, rebuilt from the derived source', () => {
  const derivedPacks = readDerivedPacks();
  const derivedGifts = readDerivedGifts();
  const floors = readDerivedAvailability();
  const selectable = packs.filter((pack) => pack.selectable);

  it('covers every pack the game actually offers', () => {
    const uncovered = selectable.filter((pack) => !floors.has(pack.id)).map((pack) => pack.id);
    expect(uncovered).toEqual([]);
    expect(selectable.length).toBeGreaterThanOrEqual(115);
    // The story-only pack is shipped but unselectable, and the derived map leaves it out to match.
    expect(floors.has(STORY_ONLY_PACK)).toBe(false);
  });

  it('reproduces every pack floor restriction through the same encoding the static data uses', () => {
    const wrong = selectable
      .filter((pack) => floors.has(pack.id))
      .filter((pack) => {
        // Round-trip: synthesise the raw record, then read it back with the production derivation.
        const rebuilt = availabilityFor(
          derivedPackAsRaw(pack.id, derivedPacks.get(pack.id) ?? {}, floors.get(pack.id)!),
        );
        return JSON.stringify(rebuilt) !== JSON.stringify(pack.availability);
      })
      .map((pack) => pack.id);
    expect(wrong).toEqual([]);
  });

  it('reproduces every fixed fusion recipe', () => {
    const fusions = gifts.filter((gift) => (gift.fusion?.recipes?.length ?? 0) > 0);
    expect(fusions.length).toBeGreaterThanOrEqual(59);
    const wrong = fusions
      .filter((gift) => {
        const ours = gift
          .fusion!.recipes.map((r) => [...r.ingredients].sort((a, b) => a - b).join(','))
          .sort();
        const theirs = derivedFixedRecipes(derivedGifts.get(gift.id) ?? {})
          .map((r) => r.join(','))
          .sort();
        return JSON.stringify(ours) !== JSON.stringify(theirs);
      })
      .map((gift) => gift.id);
    expect(wrong).toEqual([]);
  });

  it('reproduces every starting gift pool', () => {
    const theirs = readDerivedStartPools();
    expect(theirs.size).toBe(Object.keys(rules.startGift.poolsByKeyword).length);
    for (const [keyword, ids] of theirs) {
      const ours = rules.startGift.poolsByKeyword[keyword as keyof typeof rules.startGift.poolsByKeyword];
      expect([...(ours ?? [])].sort((a, b) => a - b)).toEqual(ids);
    }
  });

  it('reproduces gift tiers through the same encoding the static data uses', () => {
    const wrong = gifts
      .filter((gift) => derivedGifts.has(gift.id))
      .filter(
        (gift) => tierFromTags(derivedGiftAsRaw(gift.id, derivedGifts.get(gift.id)!).tag ?? []) !== gift.tier,
      )
      .map((gift) => gift.id);
    expect(wrong).toEqual([]);
  });

  it('knows which pack-bound gifts belong where, allowing for clear rewards being folded in', () => {
    const wrong = selectable
      .filter((pack) => derivedPacks.has(pack.id) && pack.exclusiveGifts.length > 0)
      .filter((pack) => {
        const theirs = new Set((derivedPacks.get(pack.id)!.exclusive_gifts ?? []).map(Number));
        // The derived list is a superset: it folds an EXTREME pack's clear rewards in with its
        // shop exclusives. Containment is what the fallback relies on.
        return !pack.exclusiveGifts.every((id) => theirs.has(id));
      })
      .map((pack) => pack.id);
    expect(wrong).toEqual([]);
  });

  it('cannot supply a general gift pool, a price, or an observation list — and does not pretend to', () => {
    // These are the gaps that make the fallback a stopgap. If a future version of the source starts
    // carrying them, this test fails and the fallback can be made whole.
    const anyPool = [...derivedPacks.values()].some((pack) => 'egoGiftPool' in pack || 'giftPool' in pack);
    const anyPrice = [...derivedGifts.values()].some((gift) => 'price' in gift || 'cost' in gift);
    const anyObservable = [...derivedGifts.values()].some((gift) => 'observable' in gift);
    expect({ anyPool, anyPrice, anyObservable }).toEqual({
      anyPool: false,
      anyPrice: false,
      anyObservable: false,
    });
    // Meanwhile the static data does carry them, which is why it stays the source of truth.
    expect(gifts.filter((gift) => gift.price !== null).length).toBeGreaterThan(300);
    expect(gifts.filter((gift) => gift.observable).length).toBeGreaterThan(300);
  });
});
