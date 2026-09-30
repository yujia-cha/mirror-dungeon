/**
 * `variantDiff`: what an alternative route changes against the plan it came from — the facts the
 * decision card writes on each row. The synthetic cases pin the reading of "changes" (a pack
 * that only slides to another floor is the same visit); the last case runs the real planner.
 */
import { describe, expect, it } from 'vitest';
import type { RoutePlan } from '../../../core/types.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes, defaultOptions, planAlternatives, planRoute } from '../../../core/index.ts';
import { variantDiff } from '../variants.ts';

/** Only the fields `variantDiff` reads. */
const planOf = (floors: [floor: number, packId: number | null][], unresolved: number[] = []): RoutePlan =>
  ({
    floors: floors.map(([floor, packId]) => ({ floor, packId })),
    unresolved: unresolved.map((giftId) => ({ giftId, reason: 'pack-conflict' })),
  }) as unknown as RoutePlan;

describe('variantDiff', () => {
  it('lists the packs the variant visits that the base does not, and the reverse, by floor', () => {
    const base = planOf([
      [1, 1001],
      [2, 1002],
      [3, null],
    ]);
    const variant = planOf([
      [1, 1001],
      [2, 1003],
      [3, 1004],
    ]);
    expect(variantDiff(base, variant)).toEqual({
      added: [
        { floor: 2, packId: 1003 },
        { floor: 3, packId: 1004 },
      ],
      removed: [{ floor: 2, packId: 1002 }],
      stillUnresolved: [],
    });
  });

  it('does not count a pack that only moved to another floor', () => {
    const base = planOf([
      [5, 1001],
      [7, null],
    ]);
    const variant = planOf([
      [5, null],
      [7, 1001],
    ]);
    expect(variantDiff(base, variant)).toEqual({ added: [], removed: [], stillUnresolved: [] });
  });

  it("names the variant's unresolved gifts once each", () => {
    const base = planOf([[1, 1001]], [9001]);
    const variant = planOf([[1, 1001]], [9002, 9002, 9003]);
    expect(variantDiff(base, variant).stillUnresolved).toEqual([9002, 9003]);
  });

  it('describes a real alternative: the sixth EXTREME pack comes in for the one the dropped gift needed', () => {
    const data = loadGameDataFromDisk();
    const indexes = buildIndexes(data);
    const deck = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
    const input = {
      deck,
      wanted: [9250, 9251, 9252, 9253, 9254, 9255].map((giftId) => ({ giftId, required: false })),
      options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1, deployed: deck.slice(0, 7) },
    };
    const base = planRoute(input, data, indexes);
    const variants = planAlternatives(input, data, indexes, base);
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      const diff = variantDiff(base, variant.plan);
      // The pack the base could not seat takes a floor, and exactly one pack leaves.
      expect(diff.added.map((a) => a.packId)).toEqual([1516]);
      expect(diff.removed).toHaveLength(1);
      expect(diff.stillUnresolved).toEqual([]);
    }
  });
});
