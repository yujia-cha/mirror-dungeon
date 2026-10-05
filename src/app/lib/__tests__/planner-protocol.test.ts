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
import {
  createPlanner,
  runDrop,
  runPlan,
  type AnalysisResponse,
  type DropResponse,
  type PlanResponse,
  type PlannerResponse,
} from '../planner-protocol.ts';

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
/** Six clear-reward gifts that cannot all fit one run, so the route has alternatives to offer. */
const conflicting = [9250, 9251, 9252, 9253, 9254, 9255];

const packBound = data.gifts
  .filter((gift) => gift.acquisition.kind === 'packLimited')
  .map((gift) => gift.id)
  .sort((a, b) => a - b);

/** Every analysis answer for plan `id`, stepping until the final one. */
function drain(planner: ReturnType<typeof createPlanner>, id: number): AnalysisResponse[] {
  const out: AnalysisResponse[] = [];
  for (let answer = planner.analysisStep(id); answer; answer = planner.analysisStep(id)) {
    out.push(answer);
    if (answer.done) break;
  }
  return out;
}

describe('runPlan', () => {
  it('answers with no plan at all when nothing is wanted', () => {
    expect(runPlan(inputFor([]), data, indexes)).toEqual({ plan: null, analysis: null });
  });

  it('plans a route for the gifts asked for', () => {
    const { plan, analysis } = runPlan(inputFor(packBound.slice(0, 3)), data, indexes);
    expect(plan).not.toBeNull();
    expect(plan!.floors.length).toBeGreaterThan(0);
    expect(plan!.stats.totalWanted).toBe(3);
    // No conflict, so the expensive half is skipped entirely.
    expect(analysis).toBeNull();
  });

  it('only computes alternatives when the route could not fit everything', () => {
    // The gate is `pack-conflict`; anything else (an unobtainable gift, a failed one) must not pay
    // for up to six more `planRoute` calls.
    const { plan, analysis } = runPlan(inputFor(packBound.slice(0, 3)), data, indexes);
    expect(plan!.unresolved.some((entry) => entry.reason === 'pack-conflict')).toBe(false);
    expect(analysis).toBeNull();
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
      const response = planner.handle({
        type: 'plan',
        id,
        input: inputFor(packBound.slice(0, 2)),
      }) as PlannerResponse;
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

describe('the route and its drop analysis are two answers (M52)', () => {
  it('fixture: the conflicting set really does have alternatives', () => {
    const { plan, analysis } = runPlan(inputFor(conflicting), data, indexes);
    expect(plan!.unresolved.some((entry) => entry.reason === 'pack-conflict')).toBe(true);
    expect(analysis!.effects.length).toBeGreaterThan(0);
  });

  it('answers the route first, then the bars one at a time until the analysis is done (M81)', () => {
    const planner = createPlanner({ budgetMs: Number.POSITIVE_INFINITY });
    planner.handle({ type: 'init', data });
    const response = planner.handle({ type: 'plan', id: 1, input: inputFor(conflicting) }) as PlanResponse;
    expect(response).toMatchObject({ type: 'plan', id: 1, analysisPending: true });
    expect(response).not.toHaveProperty('analysis');

    const answers = drain(planner, 1);
    const direct = runPlan(inputFor(conflicting), data, indexes);
    // One bar per step: each partial answer has one more bar than the last, the last is final.
    expect(answers.map((a) => a.analysis.effects.length)).toEqual(
      direct.analysis!.effects.map((_, i) => i + 1),
    );
    expect(answers.map((a) => a.done)).toEqual(answers.map((_, i) => i === answers.length - 1));
    const final = answers[answers.length - 1]!;
    expect(final.analysis.effects.map((e) => [e.giftId, e.reduces])).toEqual(
      direct.analysis!.effects.map((e) => [e.giftId, e.reduces]),
    );
    expect(final.analysis.resolving?.dropped).toEqual(direct.analysis!.resolving?.dropped);
    // Answered once: the plan's analysis is not recomputed on a second ask.
    expect(planner.analysisStep(1)).toBeNull();
  });

  it('stops on its budget with the bars it has, still a final answer', () => {
    let clock = 0;
    const planner = createPlanner({ budgetMs: 100, now: () => clock });
    planner.handle({ type: 'init', data });
    planner.handle({ type: 'plan', id: 1, input: inputFor(conflicting) });
    expect(planner.analysisStep(1)).toMatchObject({ done: false });
    clock = 150;
    const last = planner.analysisStep(1)!;
    expect(last.done).toBe(true);
    expect(last.analysis.effects).toHaveLength(2);
    expect(planner.analysisStep(1)).toBeNull();
  });

  it("skips the rest of a plan's analysis once a newer request replaced it", () => {
    // The whole point: a quick second toggle must not wait behind ~900ms of work for the first.
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    planner.handle({ type: 'plan', id: 1, input: inputFor(conflicting) });
    expect(planner.analysisStep(1)).toMatchObject({ done: false });
    planner.handle({ type: 'plan', id: 2, input: inputFor(conflicting) });
    expect(planner.analysisStep(1)).toBeNull();
    expect(planner.analysisStep(2)).not.toBeNull();
  });

  it('promises nothing when the route fits', () => {
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    expect(planner.handle({ type: 'plan', id: 1, input: inputFor(packBound.slice(0, 3)) })).toMatchObject({
      analysisPending: false,
    });
    expect(planner.analysisStep(1)).toBeNull();
  });

  it('forgets pending alternatives on a season change', () => {
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    planner.handle({ type: 'plan', id: 1, input: inputFor(conflicting) });
    planner.handle({ type: 'init', data });
    expect(planner.analysisStep(1)).toBeNull();
  });
});

describe('a checked set is planned on request (M80)', () => {
  it('answers a drop against the newest plan input, without touching its pending analysis', () => {
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    planner.handle({ type: 'plan', id: 1, input: inputFor(conflicting) });
    const answer = planner.handle({ type: 'drop', id: 2, dropped: [9250] });
    expect(answer).toMatchObject({ type: 'drop', id: 2 });
    const direct = runDrop(inputFor(conflicting), [9250], data, indexes);
    expect((answer as DropResponse).plan!.stats).toEqual({ ...direct!.stats, elapsedMs: expect.any(Number) });
    expect((answer as DropResponse).plan!.stats.totalWanted).toBe(5);
    // The analysis of plan 1 is still owed.
    expect(planner.analysisStep(1)).not.toBeNull();
  });

  it('answers a checked bar from the analysis, and the same set twice from one plan (M81)', () => {
    const planner = createPlanner({ budgetMs: Number.POSITIVE_INFINITY });
    planner.handle({ type: 'init', data });
    const input = inputFor(conflicting);
    planner.handle({ type: 'plan', id: 1, input });
    const final = drain(planner, 1).pop()!;
    const bar = final.analysis.effects[0]!;
    const checked = planner.handle({ type: 'drop', id: 2, dropped: [bar.giftId] }) as DropResponse;
    expect(checked.plan).toBe(bar.plan);
    const pair = [conflicting[0]!, conflicting[1]!];
    const first = planner.handle({ type: 'drop', id: 3, dropped: pair }) as DropResponse;
    const again = planner.handle({ type: 'drop', id: 4, dropped: [...pair].reverse() }) as DropResponse;
    expect(again.plan).toBe(first.plan);
    // A new input is a new question: nothing carries over.
    planner.handle({ type: 'plan', id: 5, input: { ...input } });
    const fresh = planner.handle({ type: 'drop', id: 6, dropped: pair }) as DropResponse;
    expect(fresh.plan).not.toBe(first.plan);
  });

  it('cannot answer a drop before any plan', () => {
    const planner = createPlanner();
    planner.handle({ type: 'init', data });
    expect(planner.handle({ type: 'drop', id: 1, dropped: [9250] })).toBeNull();
  });
});
