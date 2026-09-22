/**
 * The planner protocol, tested without a worker.
 *
 * The worker file is four lines of `postMessage` plumbing precisely so that everything worth
 * testing is reachable from here. `src/core/data/load.ts` spent the project untested because it
 * only ran in a browser (`docs/review/M48.md`); a worker is even easier to leave that way, so the
 * logic was kept out of it from the start.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes, defaultOptions } from '../../../core/index.ts';
import { defaultDeck } from '../default-deck.ts';
import type { RoutePlan } from '../../../core/types.ts';
import { createPlanner, runPlan, type PlannerResponse } from '../planner-protocol.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const deck = defaultDeck(data);
const lastFloor = Math.max(...Object.values(data.rules.floors).flat());

function inputFor(giftIds: number[]) {
  return {
    deck,
    wanted: giftIds.map((giftId) => ({ giftId, required: false })),
    options: { ...defaultOptions(), lastFloor, deployed: deck.slice(0, 6) },
  };
}

/**
 * The same plan minus `stats.elapsedMs`.
 *
 * That field is a measurement, so two runs of an identical plan differ by a millisecond. Comparing
 * plans without stripping it makes a test that fails whenever the machine is a little slower.
 */
function withoutTiming(plan: RoutePlan): unknown {
  return { ...plan, stats: { ...plan.stats, elapsedMs: 0 } };
}

/** Gifts bound to a pack, so the planner has actual routing to do. */
const packBound = data.gifts
  .filter((gift) => gift.acquisition.kind === 'packLimited')
  .map((gift) => gift.id)
  .sort((a, b) => a - b);

describe('runPlan', () => {
  it('answers with no plan at all when nothing is wanted', () => {
    expect(runPlan(inputFor([]), data, indexes)).toEqual({ plan: null, variants: [] });
  });

  it('plans a route for the gifts asked for', () => {
    const { plan, variants } = runPlan(inputFor(packBound.slice(0, 3)), data, indexes);
    expect(plan).not.toBeNull();
    expect(plan!.floors.length).toBeGreaterThan(0);
    expect(plan!.stats.totalWanted).toBe(3);
    // No conflict, so the expensive half is skipped entirely.
    expect(variants).toEqual([]);
  });

  it('only computes alternatives when the route could not fit everything', () => {
    // The gate is `pack-conflict`; anything else (an unobtainable gift, a failed one) must not pay
    // for up to six more `planRoute` calls.
    const { plan, variants } = runPlan(inputFor(packBound.slice(0, 3)), data, indexes);
    expect(plan!.unresolved.some((entry) => entry.reason === 'pack-conflict')).toBe(false);
    expect(variants).toEqual([]);
  });

  it('returns a result that survives structured cloning', () => {
    // This is what makes the worker possible: no Map, no Set, no function anywhere in a RoutePlan.
    const result = runPlan(inputFor(packBound.slice(0, 8)), data, indexes);
    const cloned = structuredClone(result);
    expect(cloned).toEqual(result);
  });
});

describe('createPlanner', () => {
  it('acknowledges init before answering anything', () => {
    const planner = createPlanner();
    expect(planner.handle({ type: 'init', data })).toEqual({ type: 'ready' });
  });

  it('refuses to answer a plan asked for before init', () => {
    // Null rather than an empty plan: "not ready" must not be mistaken for "nothing to do", which
    // is what an empty plan means everywhere else in the app.
    const planner = createPlanner();
    expect(planner.handle({ type: 'plan', id: 1, input: inputFor(packBound.slice(0, 2)) })).toBeNull();
  });

  it('echoes the id back so a superseded answer can be dropped', () => {
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    for (const id of [1, 2, 7]) {
      const response = planner.handle({ type: 'plan', id, input: inputFor(packBound.slice(0, 2)) }) as PlannerResponse;
      expect(response).toMatchObject({ type: 'plan', id });
    }
  });

  it('builds its own indexes, so only the season data crosses the boundary', () => {
    // The host sends `data` and nothing else — `GameIndexes` is full of Maps and rebuilding it on
    // the far side is cheaper than shipping it on every season change.
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    const viaProtocol = planner.handle({ type: 'plan', id: 1, input: inputFor(packBound.slice(0, 4)) });
    const direct = runPlan(inputFor(packBound.slice(0, 4)), data, indexes);
    expect(withoutTiming((viaProtocol as { plan: RoutePlan }).plan)).toEqual(withoutTiming(direct.plan!));
  });

  it('answers a second season after a re-init', () => {
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    planner.handle({ type: 'init', data });
    expect(planner.handle({ type: 'plan', id: 9, input: inputFor(packBound.slice(0, 2)) })).toMatchObject({
      type: 'plan',
      id: 9,
    });
  });
});
