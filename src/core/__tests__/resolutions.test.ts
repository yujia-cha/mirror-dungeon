/**
 * Ways to resolve a conflict (M144, `resolutions.ts`): release the player's own observation pins,
 * remove the fewest goals, or both — on boards built from the real season data.
 *
 * The facts these lean on: with the pins fixed the planner minimises the goals it loses (k), so
 * fewer than k removals never fit, and the plan's own k losses always do.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import {
  buildIndexes,
  compareResolutions,
  conflictRootsOf,
  createDropEffects,
  createResolutions,
  defaultOptions,
  planDropEffects,
  planResolutions,
  planRoute,
  RESOLUTION_RUN_CAP,
  RESOLUTION_RUNS,
  wantedRoots,
} from '../index.ts';
import type { PlanInput, PlanOptions, RoutePlan } from '../types.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
/** The season with 기프트 관측 switched off: the pack search alone. */
const noObservation = {
  ...data,
  rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } },
};
const BLADE_LINEAGE_DECK = [10403, 10308, 10208, 10108, 11005, 10104];
/** Five EXTREME clear rewards, one pack each, for the four floors that pay one (11~14, M173). */
const CLEAR_REWARDS = [9250, 9251, 9252, 9253, 9254];

const goals = (...ids: number[]): PlanInput['wanted'] => ids.map((giftId) => ({ giftId, required: false }));
const input = (wanted: PlanInput['wanted'], overrides: Partial<PlanOptions> = {}): PlanInput => ({
  deck: BLADE_LINEAGE_DECK,
  wanted,
  options: { ...defaultOptions(), hardFromFloor: 1, ...overrides },
});
const conflicts = (of: PlanInput, d = data): number =>
  conflictRootsOf(planRoute(of, d, indexes), of, d, indexes).length;
const without = (of: PlanInput, removed: readonly number[]): PlanInput => ({
  ...of,
  wanted: of.wanted.filter((w) => !removed.includes(w.giftId)),
});
const subsetsOf = (ids: readonly number[], size: number): number[][] =>
  size === 0
    ? [[]]
    : ids.flatMap((id, i) => subsetsOf(ids.slice(i + 1), size - 1).map((rest) => [id, ...rest]));

/**
 * Floors 1~5 Hard. Two of the player's pins (9732, 9735) take the slots the planner would spend on
 * 털방울 모자 and 찰랑이는 연료통, so one goal is lost — and releasing either pin alone fits it.
 */
const PINNED_SLOTS = input(goals(9732, 9275, 9709, 9735, 9702, 9407, 9794, 9739, 9427), {
  lastFloor: 5,
  observedGifts: [9732, 9735],
});
/** Floors 1~5 Hard, pins on 9262 and 9768: two goals lost; releasing 9768 leaves one to remove. */
const MIXED = input(goals(9262, 9218, 9768, 9772, 9804, 9789, 9791, 9773, 9219), {
  lastFloor: 5,
  observedGifts: [9262, 9768],
});

describe('removals: k is the floor, and every k-sized way is found (M144)', () => {
  it('finds no way smaller than the conflict, and exactly the k-sized ones a brute force finds', () => {
    // Arrange: six one-pack goals for the four paying floors — two lost.
    const board = input(goals(...CLEAR_REWARDS, 9827), { lastFloor: 15 });
    // Act
    const analysis = planResolutions(board, data, indexes);
    // Assert: k = 2, and no single removal fits (the lower bound).
    expect(analysis.conflicts).toBe(2);
    for (const [id] of subsetsOf(CLEAR_REWARDS.concat(9827), 1))
      expect(conflicts(without(board, [id!]))).toBe(1);
    // Every pair that fits is listed, and nothing else: here any two of the six.
    const fitting = subsetsOf([...CLEAR_REWARDS, 9827].sort(), 2).filter(
      (pair) => conflicts(without(board, pair)) === 0,
    );
    expect(analysis.methods.map((m) => m.removals)).toEqual(fitting);
    expect(analysis.methods.every((m) => m.minimal && m.releases.length === 0)).toBe(true);
    // Summed up as 「이 중 아무거나 2개」 of all six, nobody essential.
    expect(analysis.choices).toEqual([
      expect.objectContaining({ removals: 2, essential: [], pick: 2, any: true, complete: true, ways: 15 }),
    ]);
    expect(analysis.choices[0]!.pool).toEqual([...CLEAR_REWARDS, 9827].sort());
    expect(analysis.complete).toBe(true);
  });

  it('lists the same singles as the −1 bars when one removal is enough', () => {
    // Arrange: five goals for four paying floors — one lost, and any one of the five frees a floor.
    const board = input(goals(...CLEAR_REWARDS), { lastFloor: 15 });
    // Act
    const analysis = planResolutions(board, data, indexes);
    const bars = planDropEffects(board, data, indexes, undefined, { maxRuns: Infinity });
    // Assert
    expect(analysis.conflicts).toBe(1);
    const singles = analysis.methods.filter((m) => m.minimal).map((m) => m.removals[0]);
    const fullBars = bars.effects.filter((e) => e.reduces === bars.conflicts).map((e) => e.giftId);
    expect(singles).toEqual([...fullBars].sort((a, b) => a - b));
    expect(singles).toEqual(CLEAR_REWARDS);
    expect(analysis.choices[0]).toMatchObject({ pick: 1, any: true, essential: [] });
    // One run per single plus the child that finds none: k = 1 costs the number of ways, plus one.
    expect(analysis.runs).toBe(CLEAR_REWARDS.length);
  });

  it('marks the goals every way removes as essential once the enumeration is done', () => {
    // Arrange: the start is past (observation spent), so the two pins no longer apply.
    const board = { ...MIXED, options: { ...MIXED.options, startDecided: true } };
    // Act
    const analysis = planResolutions(board, data, indexes);
    // Assert: four lost; 9262 and 9804 are in every way, and the rest is a choice among three pairs.
    expect(analysis.conflicts).toBe(4);
    expect(analysis.methods).toHaveLength(3);
    for (const method of analysis.methods) {
      expect(method.removals).toHaveLength(4);
      expect(method.essential).toEqual([9262, 9804]);
    }
    expect(analysis.choices[0]).toMatchObject({ essential: [9262, 9804], pick: 2, any: false, ways: 3 });
  });
});

describe('bars measured against the goals their plan was made from (M160)', () => {
  /** Floors 1~5 Hard, three goals lost: 9792 left out alone clears one of them. */
  const BOARD = input(goals(9723, 9822, 9214, 9819, 9239, 9789, 9435, 9792, 9717, 9808, 9236, 9408), {
    lastFloor: 5,
  });

  it('counts a bar by the conflicts of the plan without that goal, as the resolutions count theirs', () => {
    // Arrange
    const main = planRoute(BOARD, data, indexes);
    const scoped = {
      ...BOARD,
      options: { ...BOARD.options, lastFloor: main.floors[main.floors.length - 1]!.floor },
    };
    // Act
    const bars = planDropEffects(BOARD, data, indexes, main, { maxRuns: Infinity });
    const ways = planResolutions(BOARD, data, indexes, main);
    // Assert: the same k at the root …
    expect(bars.conflicts).toBe(3);
    expect(ways.conflicts).toBe(bars.conflicts);
    // … and every bar is the root's k less the k of its own plan, measured against its own goals.
    // Measured against the full goal list, an ingredient the plan without 9792 could not place
    // still mapped to 9792, so that bar read 0 where the plan had cleared one conflict.
    for (const bar of bars.effects) {
      const variant = without(scoped, [bar.giftId]);
      expect(bar.reduces).toBe(bars.conflicts - conflictRootsOf(bar.plan, variant, data, indexes).length);
    }
    expect(bars.effects.find((e) => e.giftId === 9792)?.reduces).toBe(1);
    // A precomputed root map changes nothing but the work.
    const variant = without(scoped, [9792]);
    const bar = bars.effects.find((e) => e.giftId === 9792)!;
    expect(conflictRootsOf(bar.plan, variant, data, indexes, wantedRoots(variant, data, indexes))).toEqual(
      conflictRootsOf(bar.plan, variant, data, indexes),
    );
  });
});

describe('releasing pins (M144)', () => {
  it('resolves by releasing a pin alone, keeping every goal, ahead of any removal', () => {
    // Act
    const analysis = planResolutions(PINNED_SLOTS, data, indexes);
    // Assert
    expect(analysis.conflicts).toBe(1);
    expect(analysis.releasable).toEqual([9732, 9735]);
    const releaseOnly = analysis.methods.filter((m) => m.removals.length === 0);
    expect(releaseOnly.map((m) => m.releases)).toEqual([[9732], [9735]]);
    // Ranked first: no goal removed beats one removed.
    expect(analysis.methods.slice(0, 2)).toEqual(releaseOnly);
    // Releasing both is no smaller way, so it is not offered.
    expect(analysis.methods.some((m) => m.releases.length === 2)).toBe(false);
    // The plan behind it really fits: every goal, the other pin kept.
    const released = { ...PINNED_SLOTS, options: { ...PINNED_SLOTS.options, observedGifts: [9735] } };
    expect(conflicts(released)).toBe(0);
    // Everything released first (one run), the two singles, then the base state's singles.
    expect(analysis.runs).toBeLessThanOrEqual(
      3 + analysis.methods.filter((m) => m.releases.length === 0).length,
    );
  });

  it('mixes a release with one removal where removals alone need two', () => {
    // Act
    const analysis = planResolutions(MIXED, data, indexes);
    // Assert
    expect(analysis.conflicts).toBe(2);
    const [first] = analysis.methods;
    expect(first).toMatchObject({ releases: [9768], minimal: true });
    expect(first!.removals).toHaveLength(1);
    expect(analysis.methods.some((m) => m.releases.length === 0 && m.removals.length === 2)).toBe(true);
    // No way removes fewer than its state's k: one with the release, two without.
    for (const method of analysis.methods)
      expect(method.removals.length).toBe(method.releases.length === 0 ? 2 : 1);
    // The release state's single removals are a free choice (「이 중 아무거나」).
    expect(analysis.choices[0]).toMatchObject({ releases: [9768], removals: 1, pick: 1, any: true });
    // Fits for real: 9768 released and the first removal gone.
    const check = without(
      { ...MIXED, options: { ...MIXED.options, observedGifts: [9262] } },
      first!.removals,
    );
    expect(conflicts(check)).toBe(0);
  });

  it('releases nothing once the start is closed, and never a pin already in hand', () => {
    // Arrange
    const closed = { ...MIXED, options: { ...MIXED.options, startDecided: true } };
    const inHand = { ...PINNED_SLOTS, options: { ...PINNED_SLOTS.options, ownedGifts: [9732] } };
    // Act
    const afterStart = planResolutions(closed, data, indexes);
    const spent = planResolutions(inHand, data, indexes);
    // Assert: no release stage past the start — every way is removals, and no run went to releases.
    expect(afterStart.releasable).toEqual([]);
    expect(afterStart.methods.every((m) => m.releases.length === 0)).toBe(true);
    // 9732 was observed already (in hand on floor 1): that starlight is spent. 9735 is still a choice.
    expect(spent.releasable).toEqual([9735]);
    expect(spent.methods[0]).toMatchObject({ releases: [9735], removals: [] });
  });
});

describe('same-pack goals (M144)', () => {
  it('offers a same-pack pair as a minimal way only when two goals have to go', () => {
    // Arrange: three packs that each give two goals (담요·꽃가위, 치사랑·어긋난 트랜지스터, 작살·고래의
    // 심장) on floors 3~4 only: one pair is lost, and no single removal frees a floor.
    const board = input(goals(9290, 9291, 9744, 9745, 9427, 9428), { lastFloor: 5 });
    // Act
    const analysis = planResolutions(board, noObservation, indexes);
    const bars = planDropEffects(board, noObservation, indexes, undefined, { maxRuns: Infinity });
    // Assert: no single removal clears both lost goals — leaving one of a pair out, the planner
    // drops its partner instead of a whole other pair …
    expect(bars.effects.every((e) => e.reduces < bars.conflicts)).toBe(true);
    // … yet each pair together is a way, and only those.
    expect(analysis.conflicts).toBe(2);
    expect(analysis.methods.map((m) => m.removals)).toEqual([
      [9290, 9291],
      [9427, 9428],
      [9744, 9745],
    ]);
    expect(analysis.methods.every((m) => m.minimal)).toBe(true);
    // Three ways out of fifteen pairs: listed, not 「이 중 아무거나」.
    expect(analysis.choices[0]).toMatchObject({ pick: 2, any: false, ways: 3 });
  });

  it('offers a same-pack pair as another way (「다른 방법」) when one removal is enough', () => {
    // Arrange: two of those pairs and 치프 버틀러의 비급서 (one pack, floors 3~4): it is the one lost.
    const board = input(goals(9290, 9291, 9744, 9745, 9433), { lastFloor: 5 });
    // Act
    const analysis = planResolutions(board, noObservation, indexes);
    // Assert
    expect(analysis.conflicts).toBe(1);
    expect(analysis.methods.map((m) => [m.removals, m.minimal])).toEqual([
      [[9433], true],
      [[9290, 9291], false],
      [[9744, 9745], false],
    ]);
    // The only minimal way: its goal has to go (「꼭 빼야 함」).
    expect(analysis.methods[0]!.essential).toEqual([9433]);
    for (const method of analysis.methods.slice(1))
      expect(conflicts(without(board, method.removals), noObservation)).toBe(0);
  });
});

describe('the analysis itself (M144)', () => {
  it('marks every way approximate when the main plan was cut short', () => {
    // Arrange: the main plan as a capped search would hand it over.
    const board = input(goals(...CLEAR_REWARDS), { lastFloor: 15 });
    const main = planRoute(board, data, indexes);
    const capped: RoutePlan = { ...main, stats: { ...main.stats, searchCapped: true } };
    // Act
    const analysis = planResolutions(board, data, indexes, capped);
    // Assert
    expect(analysis.approx).toBe(true);
    expect(analysis.methods.length).toBeGreaterThan(0);
    expect(analysis.methods.every((m) => m.approx)).toBe(true);
    expect(planResolutions(board, data, indexes, main).methods.every((m) => !m.approx)).toBe(true);
  });

  it('spends nothing without a conflict', () => {
    const analysis = planResolutions(input(goals(9423)), data, indexes);
    expect(analysis).toEqual({
      conflicts: 0,
      releasable: [],
      methods: [],
      choices: [],
      approx: false,
      runs: 0,
      complete: true,
    });
  });

  it('steps one plan at a time to the same answer, within its budget, and deterministically', () => {
    // Arrange
    const board = input(goals(...CLEAR_REWARDS, 9827), { lastFloor: 15 });
    const whole = planResolutions(board, data, indexes);
    // Act
    const steps = createResolutions(board, data, indexes, undefined, { maxRuns: 5 });
    let seen = 0;
    while (!steps.done()) {
      steps.step();
      const partial = steps.snapshot();
      // Ways only ever add up, and each is one the whole analysis finds.
      expect(partial.methods.length).toBeGreaterThanOrEqual(seen);
      seen = partial.methods.length;
      for (const method of partial.methods) expect(whole.methods).toContainEqual(method);
    }
    const capped = steps.finish();
    // Assert: the cap held and says so; 「더 계산」 carries on to the same answer.
    expect(capped.runs).toBe(5);
    expect(capped.complete).toBe(false);
    expect(steps.finish()).toBe(capped);
    steps.extend();
    while (!steps.done()) steps.step();
    expect(JSON.stringify(steps.finish())).toBe(JSON.stringify(whole));
    expect(JSON.stringify(planResolutions(board, data, indexes))).toBe(JSON.stringify(whole));
    expect(whole.runs).toBeLessThanOrEqual(RESOLUTION_RUNS);
    expect(RESOLUTION_RUN_CAP).toBeGreaterThan(RESOLUTION_RUNS);
  });

  it('ranks by goals removed, then pins released, goals got, packs and ids', () => {
    const way = (releases: number[], removals: number[], got = 5, packs = 5) => ({
      releases,
      removals,
      minimal: true,
      essential: [],
      got,
      packs,
      approx: false,
    });
    const ranked = [
      way([1], [7]),
      way([], [3, 4]),
      way([1, 2], []),
      way([], [9], 5, 6),
      way([], [8], 4),
      way([], [2]),
      way([2], []),
    ].sort(compareResolutions);
    expect(ranked.map((m) => [m.releases, m.removals])).toEqual([
      [[2], []],
      [[1, 2], []],
      [[], [2]],
      [[], [9]],
      [[], [8]],
      [[1], [7]],
      [[], [3, 4]],
    ]);
  });

  it('shares plans with the bars: a memo makes the forced plans and the first children one call', () => {
    // Arrange
    const board = input(goals(...CLEAR_REWARDS), { lastFloor: 15 });
    const memo = new Map<string, RoutePlan>();
    let calls = 0;
    const planner = (of: PlanInput): RoutePlan => {
      const key = JSON.stringify(of);
      if (!memo.has(key)) {
        calls += 1;
        memo.set(key, planRoute(of, data, indexes));
      }
      return memo.get(key)!;
    };
    const main = planRoute(board, data, indexes);
    // Act
    const bars = createDropEffects(board, data, indexes, main, { planner });
    expect(bars.forcing()).toBe(true);
    while (bars.forcing()) bars.step();
    const afterForced = calls;
    const ways = createResolutions(board, data, indexes, main, { planner });
    ways.step();
    // Assert: the first child of the enumeration is the forced plan the bars already made.
    expect(calls).toBe(afterForced);
    expect(ways.snapshot().methods.length).toBeGreaterThan(1);
  });
});
