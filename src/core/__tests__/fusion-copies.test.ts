/**
 * A fusion intermediate two results eat (M166).
 *
 * The shop consumes what it fuses, so a result eaten by two goals has to be fused twice, from two
 * sets of ingredients. Until M166 the expansion visited each result once: both goals read the one
 * intermediate's floor, the plan promised two fusions off one copy, and a 반드시 goal reaching an
 * intermediate already expanded for a 보통 one left that intermediate's ingredients 보통. MD8 has
 * no such recipe, so the cases are built onto the real season (`synthetic.ts`).
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { analyseDeck, buildIndexes, defaultOptions, planRoute } from '../index.ts';
import { expandRequirements, requirementKey } from '../requirements.ts';
import type { PlanInput } from '../types.ts';
import { fusionGift, withSynthetic } from './synthetic.ts';

const live = loadGameDataFromDisk();

// 녹슨 칼자루 (9713) comes from 육참골단 (1104) and its 복각 (1116); 털방울 모자 (9709) from 1103 and
// 1113; 낡은 칼자루 (9782) from the 복각 alone. 재에서 재로 (9003) and 혈액 포집팩 (9004) are general.
const MID = 99001;
const A = 99002;
const B = 99003;
const MID_ONE_SOURCE = 99004;
const A1 = 99005;
const B1 = 99006;
const A_BEFORE_MID = 99000;
const data = withSynthetic(live, [
  fusionGift(live, MID, '중간체', [[9709, 9713]]),
  fusionGift(live, A, '결과 A', [[MID, 9003]]),
  fusionGift(live, B, '결과 B', [[MID, 9004]]),
  fusionGift(live, MID_ONE_SOURCE, '외길 중간체', [[9709, 9782]]),
  fusionGift(live, A1, '결과 A1', [[MID_ONE_SOURCE, 9003]]),
  fusionGift(live, B1, '결과 B1', [[MID_ONE_SOURCE, 9004]]),
  fusionGift(live, A_BEFORE_MID, '앞선 결과', [[MID, 9003]]),
]);
const noObservation = {
  ...data,
  rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } },
};
const indexes = buildIndexes(data);
const DECK = [10101, 10203, 10312, 10403, 10505, 10601];
const stats = analyseDeck(DECK, indexes, data.rules.deployment);
const slots = data.rules.fusion.maxShopSlots;
const hard15 = (): PlanInput['options'] => ({ ...defaultOptions(), lastFloor: 15, hardFromFloor: 1 });
const want = (...entries: Array<[number, boolean]>): PlanInput['wanted'] =>
  entries.map(([giftId, required]) => ({ giftId, required }));

describe('an intermediate two results eat', () => {
  it('is expanded once per result, with ingredients of its own each time', () => {
    // Arrange / Act
    const { fusions, instances, requirements } = expandRequirements(
      want([A, false], [B, false]),
      indexes,
      stats,
      slots,
    );
    // Assert: two fusings of the intermediate, each read by its own result.
    expect(fusions).toEqual([
      { result: MID, ingredients: [9709, 9713] },
      { result: A, ingredients: [MID, 9003] },
      { result: MID, ingredients: [9709, 9713] },
      { result: B, ingredients: [MID, 9004] },
    ]);
    expect(instances).toEqual([
      { copy: 0, made: [null, null] },
      { copy: 0, made: [0, null] },
      { copy: 1, made: [null, null] },
      { copy: 0, made: [2, null] },
    ]);
    // Two copies of each ingredient, under two keys: the second fusing's carry `#1`.
    expect(requirements.map(requirementKey).sort()).toEqual([
      `9003:${A}`,
      `9004:${B}`,
      `9709:${MID}`,
      `9709:${MID}#1`,
      `9713:${MID}`,
      `9713:${MID}#1`,
    ]);
  });

  it('plans the second copy from another pack and says the order matters', () => {
    // Act
    const plan = planRoute(
      { deck: DECK, wanted: want([A, false], [B, false]), options: hard15() },
      noObservation,
      indexes,
    );
    // Assert
    expect(plan.unresolved).toEqual([]);
    expect(plan.stats.coveredWanted).toBe(2);
    expect(plan.fusions.map((f) => [f.result, f.unreachable])).toEqual([
      [MID, false],
      [A, false],
      [MID, false],
      [B, false],
    ]);
    for (const giftId of [9709, 9713]) {
      const floors = plan.floors.filter((f) => f.pickups.some((p) => p.giftId === giftId));
      expect(floors).toHaveLength(2);
      expect(new Set(floors.map((f) => f.packId)).size).toBe(2);
    }
    // Each fusing waits for its own two ingredients, and each result for its own intermediate.
    const floorOf = (giftId: number): number[] =>
      plan.floors.filter((f) => f.pickups.some((p) => p.giftId === giftId)).map((f) => f.floor);
    const [mid1, a, mid2, b] = plan.fusions.map((f) => f.earliestFloor);
    expect(Math.min(mid1!, mid2!)).toBeGreaterThanOrEqual(
      Math.max(Math.min(...floorOf(9709)), Math.min(...floorOf(9713))),
    );
    expect(Math.max(mid1!, mid2!)).toBe(Math.max(...floorOf(9709), ...floorOf(9713)));
    expect(a).toBeGreaterThanOrEqual(mid1!);
    expect(b).toBeGreaterThanOrEqual(mid2!);
    expect(plan.warnings.find((w) => w.code === 'shared-ingredient')?.giftIds).toEqual([9709, 9713]);
  });

  it('reports the copy no second pack can supply as ingredient-shared, and loses one result', () => {
    // Act
    const plan = planRoute(
      { deck: DECK, wanted: want([A1, false], [B1, false]), options: hard15() },
      noObservation,
      indexes,
    );
    // Assert: 낡은 칼자루 has one source, so the second fusing of the intermediate cannot happen.
    expect(plan.unresolved.find((u) => u.giftId === 9782)).toMatchObject({ reason: 'ingredient-shared' });
    expect(plan.unresolved.find((u) => u.giftId === MID_ONE_SOURCE)).toMatchObject({
      reason: 'fusion-ingredient-unresolved',
      missing: [9782],
    });
    expect(plan.fusions.filter((f) => f.result === MID_ONE_SOURCE).map((f) => f.unreachable)).toEqual([
      false,
      true,
    ]);
    expect(plan.stats.coveredWanted).toBe(1);
    // The one copy the plan holds is promised once, so the order warning has nothing to say.
    expect(plan.warnings.map((w) => w.code)).not.toContain('shared-ingredient');
  });

  it('fuses a wanted intermediate once for the first result that eats it, and again for a second', () => {
    // Act
    const once = expandRequirements(want([MID, false], [A, false]), indexes, stats, slots);
    const twice = expandRequirements(want([MID, false], [A, false], [B, false]), indexes, stats, slots);
    // Assert: the goal and A share the one fusing; B needs its own.
    expect(once.fusions.map((f) => f.result)).toEqual([MID, A]);
    expect(once.instances).toEqual([
      { copy: 0, made: [null, null] },
      { copy: 0, made: [0, null] },
    ]);
    expect(twice.fusions.map((f) => f.result)).toEqual([MID, A, MID, B]);
    expect(twice.instances[3]).toEqual({ copy: 0, made: [2, null] });
  });

  it.each([
    ['the result comes after the intermediate', A],
    ['the result comes before the intermediate', A_BEFORE_MID],
  ])('carries 반드시 down to the ingredients when %s', (_, result) => {
    // Arrange: the intermediate is a 보통 goal of its own, the result that eats it 반드시.
    const wanted = want([MID, false], [result, true]);
    // Act
    const { requirements } = expandRequirements(wanted, indexes, stats, slots);
    // Assert
    expect(requirements.filter((r) => r.neededFor === MID).map((r) => r.required)).toEqual([true, true]);
    expect(requirements.find((r) => r.giftId === 9003)?.required).toBe(true);
  });

  it('leaves a 보통 result eating a 반드시 intermediate as it is', () => {
    // Act
    const { requirements } = expandRequirements(want([MID, true], [A, false]), indexes, stats, slots);
    // Assert
    expect(requirements.filter((r) => r.neededFor === MID).map((r) => r.required)).toEqual([true, true]);
    expect(requirements.find((r) => r.giftId === 9003)?.required).toBe(false);
  });
});
