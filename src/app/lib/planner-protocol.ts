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

export interface PlanResponse {
  type: 'plan';
  id: number;
  plan: RoutePlan | null;
  variants: RouteVariant[];
}

export type PlannerResponse = { type: 'ready' } | PlanResponse;

export interface PlanResult {
  plan: RoutePlan | null;
  variants: RouteVariant[];
}

/**
 * The whole job: the route, plus the alternatives when the route could not fit everything.
 *
 * `planAlternatives` is the expensive half — it calls `planRoute` up to six more times, and at 40+
 * goals that is ~900ms against the main plan's ~180ms. Measured, not assumed: `docs/review/M49.md`
 * has the numbers. Both halves run here so one round trip answers everything the panel needs.
 */
export function runPlan(input: PlanInput, data: GameData, indexes: GameIndexes): PlanResult {
  if (input.wanted.length === 0) return { plan: null, variants: [] };
  const plan = planRoute(input, data, indexes);
  const variants = plan.unresolved.some((entry) => entry.reason === 'pack-conflict')
    ? planAlternatives(input, data, indexes, plan)
    : [];
  return { plan, variants };
}

/**
 * A planner that holds its own indexes, for the worker (and for a test that wants to drive the
 * protocol without a worker).
 */
export function createPlanner(): {
  handle: (request: PlannerRequest) => PlannerResponse | null;
} {
  let data: GameData | null = null;
  let indexes: GameIndexes | null = null;
  return {
    handle(request) {
      if (request.type === 'init') {
        data = request.data;
        indexes = buildIndexes(request.data);
        return { type: 'ready' };
      }
      // A plan asked for before `init` cannot be answered; the host always sends `init` first, and
      // answering with an empty plan would look like "nothing to do" rather than "not ready".
      if (!data || !indexes) return null;
      const { plan, variants } = runPlan(request.input, data, indexes);
      return { type: 'plan', id: request.id, plan, variants };
    },
  };
}
