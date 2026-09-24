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
import { buildIndexes, planAlternatives, planRoute, type RouteVariant } from '../../core/index.ts';

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

export type PlannerRequest = InitRequest | PlanRequest;

/** The route alone — what the panel waits on. */
export interface PlanResponse {
  type: 'plan';
  id: number;
  plan: RoutePlan | null;
  /** True when alternatives for this plan follow in a `variants` message (unless superseded). */
  variantsPending: boolean;
}

/** The alternatives for plan `id`, sent after it. Never sent for a plan a newer one replaced. */
export interface VariantsResponse {
  type: 'variants';
  id: number;
  variants: RouteVariant[];
}

export type PlannerResponse = { type: 'ready' } | PlanResponse | VariantsResponse;

export interface PlanResult {
  plan: RoutePlan | null;
  variants: RouteVariant[];
}

/** Whether a plan needs alternatives at all: only when the route could not fit everything. */
export function needsAlternatives(plan: RoutePlan | null): boolean {
  return plan !== null && plan.unresolved.some((entry) => entry.reason === 'pack-conflict');
}

/**
 * The whole job at once: the route, plus the alternatives when the route could not fit everything.
 * This is the inline path (no worker), where there is nothing to gain from splitting it.
 *
 * `planAlternatives` is the expensive half — it calls `planRoute` up to six more times, and at 40+
 * goals that is ~900ms against the main plan's ~180ms. Measured, not assumed: `docs/review/M49.md`
 * has the numbers. The worker path splits the two for that reason (`createPlanner`).
 */
export function runPlan(input: PlanInput, data: GameData, indexes: GameIndexes): PlanResult {
  if (input.wanted.length === 0) return { plan: null, variants: [] };
  const plan = planRoute(input, data, indexes);
  const variants = needsAlternatives(plan) ? planAlternatives(input, data, indexes, plan) : [];
  return { plan, variants };
}

/**
 * A planner that holds its own indexes, for the worker (and for a test that wants to drive the
 * protocol without a worker).
 *
 * The route and its alternatives are **two answers** (M52). The route arrives after ~180ms and the
 * panel stops saying 「갱신 중…」; the alternatives follow. And `alternatives(id)` answers only the
 * newest plan: a toggle that lands while the alternatives are still queued makes them moot, so they
 * are skipped rather than computed for a question nobody is asking any more. Before M52 every quick
 * toggle paid the full ~900ms before the worker would even read the next one.
 */
export function createPlanner(): {
  handle: (request: PlannerRequest) => PlanResponse | { type: 'ready' } | null;
  alternatives: (id: number) => VariantsResponse | null;
} {
  let data: GameData | null = null;
  let indexes: GameIndexes | null = null;
  /**
   * The newest plan, kept until its alternatives are computed. Every request and every `init`
   * overwrites it, which is what makes a superseded plan's alternatives unanswerable.
   */
  let latest: { id: number; input: PlanInput; plan: RoutePlan } | null = null;
  return {
    handle(request) {
      if (request.type === 'init') {
        data = request.data;
        indexes = buildIndexes(request.data);
        latest = null;
        return { type: 'ready' };
      }
      // A plan asked for before `init` cannot be answered; the host always sends `init` first, and
      // answering with an empty plan would look like "nothing to do" rather than "not ready".
      if (!data || !indexes) return null;
      const plan = request.input.wanted.length === 0 ? null : planRoute(request.input, data, indexes);
      const variantsPending = needsAlternatives(plan);
      latest = variantsPending ? { id: request.id, input: request.input, plan: plan! } : null;
      return { type: 'plan', id: request.id, plan, variantsPending };
    },
    alternatives(id) {
      if (!latest || latest.id !== id || !data || !indexes) return null;
      const { input, plan } = latest;
      latest = null;
      return { type: 'variants', id, variants: planAlternatives(input, data, indexes, plan) };
    },
  };
}
