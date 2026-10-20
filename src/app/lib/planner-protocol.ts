/**
 * What the planner worker is asked and what it answers — and the function that does the work.
 *
 * Kept apart from the worker itself on purpose. The worker file ends up being four lines of
 * `postMessage` plumbing with no logic in it, so everything that could be wrong lives here, where a
 * test can call it directly. `src/core/data/load.ts` went untested for exactly the opposite reason
 * (see `docs/review/M48.md`), and a worker is even easier to leave uncovered.
 *
 * The same `runPlan` runs on the main thread when there is no worker (tests, and any browser that
 * cannot construct a module worker), so the two paths cannot drift apart in behaviour — only in
 * when they finish.
 */
import type { GameData } from '../../core/schema.ts';
import type { GameIndexes, PlanInput, RoutePlan } from '../../core/types.ts';
import {
  buildIndexes,
  createDropEffects,
  createResolutions,
  planRoute,
  type DropAnalysis,
  type DropEffectSteps,
  type ResolutionAnalysis,
  type ResolutionSteps,
} from '../../core/index.ts';

/** Hand the worker the season's data once; it builds its own indexes. */
export interface InitRequest {
  type: 'init';
  data: GameData;
}

export interface PlanRequest {
  type: 'plan';
  /** Echoed back, so a late answer to a superseded question can be dropped. */
  id: number;
  input: PlanInput;
}

/**
 * The plan with some goals left out — the set the decision card has checked — and, since M144,
 * some of the player's observation pins released (a way 「이 방법 고르기」 picked). Answered for the
 * newest `plan` request's input, so it never mixes an old goal list with a new selection.
 */
export interface DropRequest {
  type: 'drop';
  id: number;
  dropped: number[];
  released?: number[];
}

/**
 * Measure the candidates the budget or the cap left out of plan `id`'s analysis (M115, the card's
 * 「더 계산」). Ignored unless `id` is still the newest plan; answered by more `analysis` messages.
 */
export interface MoreRequest {
  type: 'analysis-more';
  id: number;
}

export type PlannerRequest = InitRequest | PlanRequest | DropRequest | MoreRequest;

/** The route alone — what the panel waits on. */
export interface PlanResponse {
  type: 'plan';
  id: number;
  plan: RoutePlan | null;
  /** True when the drop analysis for this plan follows in an `analysis` message (unless superseded). */
  analysisPending: boolean;
}

/**
 * The drop analysis for plan `id`, sent after it — several times since M81: once per bar as it is
 * measured (`done: false`, the bars so far), then the final answer (`done: true`). Never sent for
 * a plan a newer one replaced. Since M144 it carries the ways to resolve the conflict too
 * (`resolutions`), computed in the same budget: the forced plans first (they name the causes and
 * are the enumeration's first children), then the ways, then the bars.
 */
export interface AnalysisResponse {
  type: 'analysis';
  id: number;
  analysis: DropAnalysis;
  resolutions: ResolutionAnalysis;
  done: boolean;
}

/**
 * How long the worker keeps measuring bars before it settles for the ones it has. Small goal lists
 * finish all ten candidates in a few dozen milliseconds; at 40+ goals one candidate is ~150ms, so
 * this keeps the first five or so — the conflicting goals and the ones on their floors come first.
 * A clock lives here, not in core: core stays deterministic and the inline path measures them all.
 */
export const ANALYSIS_BUDGET_MS = 800;

const sortedKey = (ids: readonly number[]): string => [...ids].sort((a, b) => a - b).join(',');
/**
 * `planRoute` with `stats.elapsedMs` filled in: core keeps no clock (M160), so the call is timed
 * here, where every plan the app sees is made.
 */
function timedPlan(input: PlanInput, data: GameData, indexes: GameIndexes): RoutePlan {
  const startedAt = performance.now();
  const plan = planRoute(input, data, indexes);
  return { ...plan, stats: { ...plan.stats, elapsedMs: Math.round(performance.now() - startedAt) } };
}

/** A checked set and the pins released with it, as one cache key. */
const dropKey = (ids: readonly number[], released: readonly number[] = []): string =>
  released.length === 0 ? sortedKey(ids) : `${sortedKey(ids)}|${sortedKey(released)}`;

/**
 * One memo of `planRoute` for an analysis: the bars and the ways plan some inputs alike (a forced
 * plan is the enumeration's first child), and the same input always plans the same.
 */
function memoPlanner(data: GameData, indexes: GameIndexes): (input: PlanInput) => RoutePlan {
  const memo = new Map<string, RoutePlan>();
  return (input) => {
    const key = JSON.stringify(input);
    let plan = memo.get(key);
    if (!plan) {
      plan = timedPlan(input, data, indexes);
      memo.set(key, plan);
    }
    return plan;
  };
}

/** The answer to a `drop` request. */
export interface DropResponse {
  type: 'drop';
  id: number;
  plan: RoutePlan | null;
}

export type PlannerResponse = { type: 'ready' } | PlanResponse | AnalysisResponse | DropResponse;

export interface PlanResult {
  plan: RoutePlan | null;
  analysis: DropAnalysis | null;
  /** The ways to resolve the conflict (M144), beside the bars. */
  resolutions: ResolutionAnalysis | null;
}

/**
 * Whether a plan needs the drop analysis at all: only when the route could not fit everything —
 * a pack conflict, or since M115 a shared ingredient's second copy that no pack could supply.
 */
export function needsAlternatives(plan: RoutePlan | null): boolean {
  return (
    plan !== null &&
    plan.unresolved.some((entry) => entry.reason === 'pack-conflict' || entry.reason === 'ingredient-shared')
  );
}

/**
 * The whole job at once: the route, plus the drop analysis and the ways to fit (M144) when the
 * route could not fit everything. This is the inline path (no worker), where there is nothing to
 * gain from splitting it; the steps run in the worker's order (`drive`) over one plan memo.
 *
 * The analysis is the expensive half — the bars call `planRoute` once per candidate goal (up to
 * ten) and the ways once per release subset and enumeration step (up to `RESOLUTION_RUNS`), and at
 * 40+ goals one call is ~150ms (`docs/review/M49.md`). The worker path splits the two for that
 * reason (`createPlanner`) and stops on a budget.
 */
export function runPlan(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  /** Every candidate rather than the first ten (the card's 「더 계산」). */
  all = false,
): PlanResult {
  if (input.wanted.length === 0) return { plan: null, analysis: null, resolutions: null };
  const plan = timedPlan(input, data, indexes);
  if (!needsAlternatives(plan)) return { plan, analysis: null, resolutions: null };
  const planner = memoPlanner(data, indexes);
  const bars = createDropEffects(input, data, indexes, plan, {
    planner,
    ...(all ? { maxRuns: Infinity } : {}),
  });
  const ways = createResolutions(input, data, indexes, plan, { planner });
  if (all) ways.extend();
  drive(bars, ways, () => true);
  return { plan, analysis: bars.finish(), resolutions: ways.finish() };
}

/**
 * Steps of the analysis, in the order that matters to the card: the forced plans (the causes, and
 * the enumeration's first children), then the ways (M144, the card's top list), then the bars.
 * `more` decides after each step whether to take another; it stops by itself when nothing is left.
 */
function drive(bars: DropEffectSteps, ways: ResolutionSteps, more: () => boolean): void {
  for (;;) {
    if (bars.forcing()) bars.step();
    else if (!ways.done()) ways.step();
    else if (!bars.done()) bars.step();
    else return;
    if (!more()) return;
  }
}

/** The plan for `input` with `dropped` left out of the goals and `released` pins let go. */
/**
 * The input a checked set's route is planned from: the goals without `dropped`, the pins without
 * `released`. What that route's conflicts are measured against as well (M160) — measured against
 * the full input, a conflict could map back to a goal the variant no longer has.
 */
export function dropInputOf(
  input: PlanInput,
  dropped: readonly number[],
  released: readonly number[] = [],
): PlanInput {
  const wanted = input.wanted.filter((w) => !dropped.includes(w.giftId));
  const options =
    released.length === 0
      ? input.options
      : {
          ...input.options,
          observedGifts: input.options.observedGifts.filter((id) => !released.includes(id)),
        };
  return { ...input, wanted, options };
}

export function runDrop(
  input: PlanInput,
  dropped: readonly number[],
  data: GameData,
  indexes: GameIndexes,
  released: readonly number[] = [],
): RoutePlan | null {
  const variant = dropInputOf(input, dropped, released);
  if (variant.wanted.length === 0) return null;
  return timedPlan(variant, data, indexes);
}

/**
 * A planner that holds its own indexes, for the worker (and for a test that wants to drive the
 * protocol without a worker).
 *
 * The route and its drop analysis are **two answers** (M52; the analysis replaced the alternatives
 * list in M80). The route arrives after ~180ms and the panel stops saying 「갱신 중…」; the analysis
 * follows **one bar per call** of `analysisStep(id)` (M81), which the worker runs as a task each, so
 * a newer request queued behind it is read between bars and makes the rest moot: `analysisStep`
 * answers only the newest plan. Before M52 every quick toggle paid the full analysis before the
 * worker would even read the next one; before M81 it still paid until the last bar.
 *
 * The checked sets the card asks about (`drop`) are kept per plan input: the single drops the
 * analysis already planned answer a checked bar at once, and checking a set back costs nothing.
 */
export function createPlanner(opts: { budgetMs?: number; now?: () => number } = {}): {
  handle: (request: PlannerRequest) => PlanResponse | DropResponse | { type: 'ready' } | null;
  analysisStep: (id: number) => AnalysisResponse | null;
  resume: (id: number) => boolean;
} {
  const budgetMs = opts.budgetMs ?? ANALYSIS_BUDGET_MS;
  const now = opts.now ?? (() => performance.now());
  let data: GameData | null = null;
  let indexes: GameIndexes | null = null;
  /**
   * The newest plan and its analysis. Every plan request and every `init` overwrites it, which is
   * what makes a superseded plan's analysis unanswerable. A `drop` request leaves it alone. Kept
   * after the analysis finished (M115), so 「더 계산」 can carry on from where the budget stopped.
   */
  let latest: {
    id: number;
    input: PlanInput;
    plan: RoutePlan;
    steps?: DropEffectSteps;
    /** The ways to resolve it (M144), sharing one plan memo with the bars. */
    ways?: ResolutionSteps;
    startedAt?: number;
    finished?: boolean;
    /** Resumed by `analysis-more`: no budget, the player asked for every bar. */
    unbounded?: boolean;
  } | null = null;
  /** The newest plan request's input, which a `drop` request is answered against. */
  let current: PlanInput | null = null;
  /** Plans for checked sets (`dropKey`) of the `current` input; emptied when it changes. */
  const dropCache = new Map<string, RoutePlan | null>();
  return {
    handle(request) {
      if (request.type === 'init') {
        data = request.data;
        indexes = buildIndexes(request.data);
        latest = null;
        current = null;
        dropCache.clear();
        return { type: 'ready' };
      }
      // A plan asked for before `init` cannot be answered; the host always sends `init` first, and
      // answering with an empty plan would look like "nothing to do" rather than "not ready".
      if (!data || !indexes) return null;
      if (request.type === 'analysis-more') return null;
      if (request.type === 'drop') {
        if (!current) return null;
        const released = request.released ?? [];
        const key = dropKey(request.dropped, released);
        if (!dropCache.has(key))
          dropCache.set(key, runDrop(current, request.dropped, data, indexes, released));
        return { type: 'drop', id: request.id, plan: dropCache.get(key)! };
      }
      if (request.input !== current) dropCache.clear();
      current = request.input;
      const plan = request.input.wanted.length === 0 ? null : timedPlan(request.input, data, indexes);
      const analysisPending = needsAlternatives(plan);
      latest = analysisPending ? { id: request.id, input: request.input, plan: plan! } : null;
      return { type: 'plan', id: request.id, plan, analysisPending };
    },
    analysisStep(id) {
      if (!latest || latest.id !== id || latest.finished || !data || !indexes) return null;
      if (!latest.steps || !latest.ways) {
        const planner = memoPlanner(data, indexes);
        latest.steps = createDropEffects(latest.input, data, indexes, latest.plan, { planner });
        latest.ways = createResolutions(latest.input, data, indexes, latest.plan, { planner });
        latest.startedAt = now();
      }
      const { steps, ways } = latest;
      // Always one plan, then stop when the steps or the budget run out.
      drive(steps, ways, () => false);
      const more = !steps.done() || !ways.done();
      if (more && (latest.unbounded || now() - latest.startedAt! < budgetMs))
        return {
          type: 'analysis',
          id,
          analysis: steps.snapshot(),
          resolutions: ways.snapshot(),
          done: false,
        };
      const analysis = steps.finish();
      const resolutions = ways.finish();
      latest.finished = true;
      // The analysis already planned these sets; a checked bar is answered from here.
      for (const effect of analysis.effects) dropCache.set(dropKey([effect.giftId]), effect.plan);
      if (analysis.resolving) dropCache.set(dropKey(analysis.resolving.dropped), analysis.resolving.plan);
      return { type: 'analysis', id, analysis, resolutions, done: true };
    },
    /** Lift the cap and the budget on plan `id`'s finished analysis; true when there is more to do. */
    resume(id) {
      if (!latest || latest.id !== id || !latest.steps || !latest.ways || !latest.finished) return false;
      latest.steps.extend();
      latest.ways.extend();
      if (latest.steps.done() && latest.ways.done()) return false;
      latest.finished = false;
      latest.unbounded = true;
      return true;
    },
  };
}
