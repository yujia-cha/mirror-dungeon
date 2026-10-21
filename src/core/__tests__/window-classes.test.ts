/**
 * The floor-window bound past 30 window classes (M166).
 *
 * Packs whose open floors are the same form one window class (MD8, 1~15 Hard: 11 classes). The
 * classes a run of floors contains were a 32-bit mask, so past 30 classes the bound, the root
 * relaxation and the branch and bound switched off without a word and the DFS ran to the node
 * cap. No season has that many; this one is built onto the real season (`synthetic.ts`): 31
 * packs on 31 distinct windows, one exclusive gift each.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { analyseDeck, assignPacks, buildIndexes, defaultOptions, planRoute } from '../index.ts';
import { expandRequirements, goalRoots, requirementKey } from '../requirements.ts';
import { packGift, themePack, withSynthetic } from './synthetic.ts';

const live = loadGameDataFromDisk();
// Windows [k, k] (15), [k, k+1] (14), [1, 3] and [2, 4]: 31 classes, one pack and one gift each.
const WINDOWS: Array<[number, number]> = [
  ...Array.from({ length: 15 }, (_, i): [number, number] => [i + 1, i + 1]),
  ...Array.from({ length: 14 }, (_, i): [number, number] => [i + 1, i + 2]),
  [1, 3],
  [2, 4],
];
const packId = (i: number): number => 5000 + i;
const giftId = (i: number): number => 99100 + i;
const data = withSynthetic(
  live,
  WINDOWS.map((_, i) => packGift(live, giftId(i), `창 기프트 ${i}`, [packId(i)])),
  WINDOWS.map(([from, to], i) =>
    themePack(
      live,
      packId(i),
      `창 팩 ${i}`,
      Array.from({ length: to - from + 1 }, (_, k) => from + k),
      [giftId(i)],
    ),
  ),
);
const noObservation = {
  ...data,
  rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } },
};
const indexes = buildIndexes(data);
const DECK = [10101, 10203, 10312, 10403, 10505, 10601];
const options = { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1 };
const wanted = WINDOWS.map((_, i) => ({ giftId: giftId(i), required: false }));

describe('more window classes than a mask holds', () => {
  it('still has the bound: the plan is proven, not capped', () => {
    // Act
    const plan = planRoute({ deck: DECK, wanted, options }, noObservation, indexes);
    // Assert: 31 single-pack goals on 15 floors keep 15, and the bound proves it at the root.
    expect(plan.stats.searchCapped).toBe(false);
    expect(plan.stats.coveredWanted).toBe(15);
    expect(plan.floors.filter((f) => f.packId !== null)).toHaveLength(15);
    expect(plan.unresolved.filter((u) => u.reason === 'pack-conflict')).toHaveLength(16);
  });

  it('runs the DFS to the node cap without it, as it did past 30 classes until M166', () => {
    // Arrange
    const stats = analyseDeck(DECK, indexes, data.rules.deployment);
    const { requirements, fusions, instances } = expandRequirements(
      wanted,
      indexes,
      stats,
      data.rules.fusion.maxShopSlots,
    );
    const roots = goalRoots(wanted, fusions, instances);
    const run = (lowerBound: boolean) =>
      assignPacks({
        requirements,
        floors: Array.from({ length: 15 }, (_, i) => i + 1),
        options,
        rules: data.rules,
        indexes,
        goals: { roots: new Map(requirements.map((r) => [requirementKey(r), roots.ofRequirement(r)])) },
        lowerBound,
      });
    // Act
    const bounded = run(true);
    const blind = run(false);
    // Assert
    expect(bounded.capped).toBe(false);
    expect(bounded.lostGoals).toHaveLength(16);
    expect(blind.capped).toBe(true);
    expect(blind.nodes).toBeGreaterThan(bounded.nodes * 10);
  });
});
