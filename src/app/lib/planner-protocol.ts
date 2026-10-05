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
import { buildIndexes, planDropEffects, planRoute, type DropAnalysis } from '../../core/index.ts';

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

/** The drop analysis for plan `id`, sent after it. Never sent for a plan a newer one replaced. */
export interface AnalysisResponse {
  type: 'analysis';
  id: number;
  analysis: DropAnalysis;
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
 * list in M80). The route arrives after ~180ms and the
 * panel stops saying 「갱신 중…」; the alternatives follow. And `alternatives(id)` answers only the
 * newest plan: a toggle that lands while the alternatives are still queued makes them moot, so they
 * are skipped rather than computed for a question nobody is asking any more. Before M52 every quick
 * toggle paid the full ~900ms before the worker would even read the next one.
 */
export function createPlanner(): {
  handle: (request: PlannerRequest) => PlanResponse | DropResponse | { type: 'ready' } | null;
  alternatives: (id: number) => AnalysisResponse | null;
} {
  let data: GameData | null = null;
  let indexes: GameIndexes | null = null;
  /**
   * The newest plan, kept until its analysis is computed. Every plan request and every `init`
   * overwrites it, which is what makes a superseded plan's analysis unanswerable. A `drop`
   * request leaves it alone.
   */
  let latest: { id: number; input: PlanInput; plan: RoutePlan } | null = null;
  /** The newest plan request's input, which a `drop` request is answered against. */
  let current: PlanInput | null = null;
  return {
    handle(request) {
      if (request.type === 'init') {
        data = request.data;
        indexes = buildIndexes(request.data);
        latest = null;
        current = null;
        return { type: 'ready' };
      }
      // A plan asked for before `init` cannot be answered; the host always sends `init` first, and
      // answering with an empty plan would look like "nothing to do" rather than "not ready".
      if (!data || !indexes) return null;
      if (request.type === 'drop') {
        if (!current) return null;
        return { type: 'drop', id: request.id, plan: runDrop(current, request.dropped, data, indexes) };
      }
      current = request.input;
      const plan = request.input.wanted.length === 0 ? null : planRoute(request.input, data, indexes);
      const analysisPending = needsAlternatives(plan);
      latest = analysisPending ? { id: request.id, input: request.input, plan: plan! } : null;
      return { type: 'plan', id: request.id, plan, analysisPending };
    },
    alternatives(id) {
      if (!latest || latest.id !== id || !data || !indexes) return null;
      const { input, plan } = latest;
      latest = null;
      return { type: 'analysis', id, analysis: planDropEffects(input, data, indexes, plan) };
    },
  };
}
