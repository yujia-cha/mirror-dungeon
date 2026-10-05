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
  planDropEffects,
  planRoute,
  type DropAnalysis,
  type DropEffectSteps,
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
 * The plan with some goals left out — the set the decision card has checked. Answered for the
 * newest `plan` request's input, so it never mixes an old goal list with a new selection.
 */
export interface DropRequest {
  type: 'drop';
  id: number;
  dropped: number[];
}

export type PlannerRequest = InitRequest | PlanRequest | DropRequest;

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
 * a plan a newer one replaced.
 */
export interface AnalysisResponse {
  type: 'analysis';
  id: number;
  analysis: DropAnalysis;
  done: boolean;
}

/**
 * How long the worker keeps measuring bars before it settles for the ones it has. Small goal lists
 * finish all ten candidates in a few dozen milliseconds; at 40+ goals one candidate is ~150ms, so
 * this keeps the first five or so — the conflicting goals and the ones on their floors come first.
 * A clock lives here, not in core: core stays deterministic and the inline path measures them all.
 */
export const ANALYSIS_BUDGET_MS = 800;

const dropKey = (ids: readonly number[]): string => [...ids].sort((a, b) => a - b).join(',');

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
}

/** Whether a plan needs the drop analysis at all: only when the route could not fit everything. */
export function needsAlternatives(plan: RoutePlan | null): boolean {
  return plan !== null && plan.unresolved.some((entry) => entry.reason === 'pack-conflict');
}

/**
 * The whole job at once: the route, plus the drop analysis when the route could not fit
 * everything. This is the inline path (no worker), where there is nothing to gain from splitting it.
 *
 * `planDropEffects` is the expensive half — it calls `planRoute` once per candidate goal (up to
 * ten), and at 40+ goals one call is ~180ms (`docs/review/M49.md`). The worker path splits the two
 * for that reason (`createPlanner`).
 */
export function runPlan(input: PlanInput, data: GameData, indexes: GameIndexes): PlanResult {
  if (input.wanted.length === 0) return { plan: null, analysis: null };
  const plan = planRoute(input, data, indexes);
  const analysis = needsAlternatives(plan) ? planDropEffects(input, data, indexes, plan) : null;
  return { plan, analysis };
}

/** The plan for `input` with `dropped` left out of the goals; `null` when nothing is left. */
export function runDrop(
  input: PlanInput,
  dropped: readonly number[],
  data: GameData,
  indexes: GameIndexes,
): RoutePlan | null {
  const wanted = input.wanted.filter((w) => !dropped.includes(w.giftId));
  return wanted.length === 0 ? null : planRoute({ ...input, wanted }, data, indexes);
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
} {
  const budgetMs = opts.budgetMs ?? ANALYSIS_BUDGET_MS;
  const now = opts.now ?? (() => performance.now());
  let data: GameData | null = null;
  let indexes: GameIndexes | null = null;
  /**
   * The newest plan, kept until its analysis is computed. Every plan request and every `init`
   * overwrites it, which is what makes a superseded plan's analysis unanswerable. A `drop`
   * request leaves it alone.
   */
  let latest: {
    id: number;
    input: PlanInput;
    plan: RoutePlan;
    steps?: DropEffectSteps;
    startedAt?: number;
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
      if (request.type === 'drop') {
        if (!current) return null;
        const key = dropKey(request.dropped);
        if (!dropCache.has(key)) dropCache.set(key, runDrop(current, request.dropped, data, indexes));
        return { type: 'drop', id: request.id, plan: dropCache.get(key)! };
      }
      if (request.input !== current) dropCache.clear();
      current = request.input;
      const plan = request.input.wanted.length === 0 ? null : planRoute(request.input, data, indexes);
      const analysisPending = needsAlternatives(plan);
      latest = analysisPending ? { id: request.id, input: request.input, plan: plan! } : null;
      return { type: 'plan', id: request.id, plan, analysisPending };
    },
    analysisStep(id) {
      if (!latest || latest.id !== id || !data || !indexes) return null;
      if (!latest.steps) {
        latest.steps = createDropEffects(latest.input, data, indexes, latest.plan);
        latest.startedAt = now();
      }
      const { steps } = latest;
      // Always one bar, then stop when the candidates or the budget run out.
      steps.step();
      if (!steps.done() && now() - latest.startedAt! < budgetMs)
        return { type: 'analysis', id, analysis: steps.snapshot(), done: false };
      const analysis = steps.finish();
      latest = null;
      // The analysis already planned these sets; a checked bar is answered from here.
      for (const effect of analysis.effects) dropCache.set(dropKey([effect.giftId]), effect.plan);
      if (analysis.resolving) dropCache.set(dropKey(analysis.resolving.dropped), analysis.resolving.plan);
      return { type: 'analysis', id, analysis, done: true };
    },
  };
}
