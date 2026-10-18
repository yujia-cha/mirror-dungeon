/**
 * The drop analysis (M80, M115): when the goals cannot all fit in one run, plan again with each
 * candidate goal left out, and measure how many conflicting goals that clears — a bar per goal on
 * the decision card. `planResolutions` (resolutions.ts) lists the fewest removals from the same
 * conflict count (`conflictRootsOf`).
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanInput, RoutePlan } from './types.ts';
import { conflictRootsOf, contestedFloors, wantedRoots } from './conflicts.ts';
import { planRoute } from './index.ts';

/** A route without some goals: the plan the decision card previews. */
export interface RouteVariant {
  /** Wanted gift ids this variant leaves out: one, or the bundle when no single drop clears. */
  dropped: number[];
  plan: RoutePlan;
}

/**
 * Why a goal is a candidate, by the first tier it entered (M115): it caused a loss (`cause` — the
 * plan that keeps a lost goal loses it instead), it was lost (`lost`), it is the goal picked last
 * (`recent` — `wanted` keeps the picking order, and the goal just picked is the likeliest cause),
 * it holds the run's start gift (`start` — chosen before the search, so no forced plan can name
 * it), it sits on a contested floor (`occupant`), it is observed (`observed`), or it is merely
 * routed (`routed`).
 */
export type DropRole = 'cause' | 'lost' | 'recent' | 'start' | 'occupant' | 'observed' | 'routed';

/** What leaving one goal out does to the conflict: the bar the decision card draws for it. */
export interface DropEffect {
  giftId: number;
  /** How many conflicting goals the drop clears, the dropped goal itself included. 0: no help. */
  reduces: number;
  plan: RoutePlan;
  role: DropRole;
  /**
   * When the drop clears nothing: other goals picked up from the same pack in the main plan. Left
   * alone the pack is still entered for them, so no floor frees up.
   */
  sharesPackWith?: number[];
}

/** A lost goal and who it fights. */
export interface Tradeoff {
  lost: number;
  /** What the plan that must keep `lost` gives up instead: one way to keep it, the search's pick. */
  causes: number[];
  /**
   * Measured bars whose drop alone keeps `lost`: every goal it fights, as far as the bars go. When
   * several goals contend for one floor the forced plan names one of them; this names them all.
   */
  rivals: number[];
}

export interface DropAnalysis {
  /**
   * Conflicting goals in the main plan: `pack-conflict`, ingredients counted as their goal, and
   * since M115 the fusion an `ingredient-shared` copy starved.
   */
  conflicts: number;
  /** One per candidate goal tried, most helpful first. */
  effects: DropEffect[];
  /**
   * A drop that clears every conflict: the best single one, or else the main plan's own losses
   * together (the plan minimises its losses, so they are the smallest set it knows to fit). `null`
   * when neither was found.
   */
  resolving: RouteVariant | null;
  /** For each lost goal (up to `MAX_TRADEOFFS`), what keeping it would cost. */
  tradeoffs: Tradeoff[];
  /** Candidates not measured yet — cut by `maxRuns` or by the caller's budget. */
  skipped: number;
}

export interface DropEffectOptions {
  /** Candidate drops tried, which bounds the number of extra `planRoute` calls. */
  maxRuns?: number;
  /**
   * Plan an input; default `planRoute`. The worker passes a memo shared with the resolutions
   * (M144, `createResolutions`): a forced plan here is the first child of their enumeration.
   */
  planner?: (input: PlanInput) => RoutePlan;
}

/** Lost goals a forced plan is made for: each costs one `planRoute`. */
export const MAX_TRADEOFFS = 3;

/**
 * Each candidate goal left out on its own, measured by how many conflicting goals that clears.
 *
 * Nothing is merged or cut to a short list: every candidate gets its bar, because a drop that
 * clears nothing is worth knowing too. Effects do not add up — two goals that
 * fight over one floor clear one conflict between them, and two that share a pack clear nothing
 * alone — so the card checks a chosen set with a plan of its own instead of summing bars.
 *
 * Candidates, in the order the budget is spent (M115): the causes (for each lost goal, a plan that
 * must keep it — the goals that plan loses instead are what it fights), the lost goals, the goal
 * holding the start gift, the goals on the contested floors, the observed goals (leaving one out
 * frees an observation slot), then the rest of the routed goals.
 */
export function planDropEffects(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  main?: RoutePlan,
  opts: DropEffectOptions = {},
): DropAnalysis {
  const steps = createDropEffects(input, data, indexes, main, opts);
  while (!steps.done()) steps.step();
  return steps.finish();
}

/**
 * `planDropEffects` one `planRoute` at a time, for a caller that shows bars as they come and stops
 * on a budget of its own (the worker: `planner-protocol.ts`). Core keeps no clock — every step is
 * the same call `planDropEffects` makes, so stopping early only leaves the tail out (`skipped`).
 * The first steps are the forced plans that find the causes; the bars follow.
 */
export interface DropEffectSteps {
  /** Conflicting goals in the main plan; 0 means there is nothing to measure. */
  conflicts: number;
  /** True when every candidate within `maxRuns` has its bar. */
  done(): boolean;
  /** True while the forced plans that name the causes (`tradeoffs`) are still to run (M144). */
  forcing(): boolean;
  /** Run the next forced plan, or measure the next candidate. */
  step(): void;
  /** The bars so far, sorted, with a single drop that clears everything as `resolving`. */
  snapshot(): DropAnalysis;
  /** The final answer: the bars so far, plus the bundle when no single drop clears it. */
  finish(): DropAnalysis;
  /** Lift `maxRuns`: every remaining candidate is queued (the card's 「더 계산」). */
  extend(): void;
}

export function createDropEffects(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  main?: RoutePlan,
  opts: DropEffectOptions = {},
): DropEffectSteps {
  let maxRuns = opts.maxRuns ?? 10;
  const planRouteOf = opts.planner ?? ((of: PlanInput) => planRoute(of, data, indexes));
  const base = main ?? planRouteOf(input);
  const options =
    base.floors.length > 0
      ? { ...input.options, lastFloor: base.floors[base.floors.length - 1]!.floor }
      : input.options;
  const scoped = { ...input, options };
  const conflictRoots = conflictRootsOf(base, scoped, data, indexes);
  const empty: DropAnalysis = { conflicts: 0, effects: [], resolving: null, tradeoffs: [], skipped: 0 };
  if (conflictRoots.length === 0) {
    return {
      conflicts: 0,
      done: () => true,
      forcing: () => false,
      step: () => undefined,
      snapshot: () => empty,
      finish: () => empty,
      extend: () => undefined,
    };
  }

  const roots = wantedRoots(scoped, data, indexes);
  const wantedIds = new Set(input.wanted.map((w) => w.giftId));
  const tiered = input.wanted.some((w) => !w.required);
  const required = new Set(tiered ? input.wanted.filter((w) => w.required).map((w) => w.giftId) : []);
  const left = (plan: RoutePlan): number => conflictRootsOf(plan, scoped, data, indexes).length;
  const lostBefore = new Set(conflictRoots);

  // The forced plans: one per lost goal, the others made optional unless the player made them
  // required (with every goal required, requiring one more changes nothing).
  const forceQueue = conflictRoots.filter((id) => !required.has(id)).slice(0, MAX_TRADEOFFS);
  /** What each forced plan gave up instead of its lost goal; absent when even it lost that goal. */
  const causesOf = new Map<number, number[]>();
  let forced = 0;
  /** The goals each measured bar's plan still loses, for the rivals. */
  const lostWithout = new Map<number, Set<number>>();

  const conflictFloors = contestedFloors(base, options, indexes);
  const occupants = base.floors
    .filter((floor) => floor.reason === 'required' && conflictFloors.has(floor.floor))
    .flatMap((floor) => floor.pickups.flatMap((p) => roots(p.giftId)));
  // A pin on a gift already in hand is an observation spent (M134): leaving its goal out frees
  // no slot, so it is no candidate for that reason.
  const inHand = new Set(input.options.ownedGifts ?? []);
  const observed = base.start.observed.filter((o) => !inHand.has(o.giftId)).flatMap((o) => roots(o.giftId));
  const start = base.start.startGifts.flatMap((giftId) => roots(giftId));
  const recent = input.wanted.length > 0 ? [input.wanted[input.wanted.length - 1]!.giftId] : [];
  const routed = base.floors.flatMap((floor) => floor.pickups.flatMap((p) => roots(p.giftId)));

  // Which goals each pack serves in the main plan, for a bar that clears nothing.
  const goalsByPack = new Map<number, Set<number>>();
  for (const floor of base.floors) {
    if (floor.packId === null) continue;
    const set = goalsByPack.get(floor.packId) ?? new Set<number>();
    for (const p of floor.pickups) for (const r of roots(p.giftId)) set.add(r);
    goalsByPack.set(floor.packId, set);
  }
  const sharingWith = (giftId: number): number[] => {
    const peers = new Set<number>();
    for (const goals of goalsByPack.values())
      if (goals.has(giftId)) for (const g of goals) if (g !== giftId) peers.add(g);
    return [...peers].sort((a, b) => a - b);
  };

  let candidates: { giftId: number; role: DropRole }[] | null = null;
  const buildCandidates = (): { giftId: number; role: DropRole }[] => {
    const causes = [...causesOf.values()].flat();
    const tiers: [DropRole, number[]][] = [
      ['cause', causes],
      ['lost', conflictRoots],
      ['recent', recent],
      ['start', start],
      ['occupant', occupants],
      ['observed', observed],
      ['routed', routed],
    ];
    const seen = new Set<number>();
    const out: { giftId: number; role: DropRole }[] = [];
    for (const [role, tier] of tiers) {
      for (const giftId of [...new Set(tier)].sort((a, b) => a - b)) {
        if (seen.has(giftId) || !wantedIds.has(giftId) || required.has(giftId)) continue;
        seen.add(giftId);
        out.push({ giftId, role });
      }
    }
    return out;
  };
  const queue = (): { giftId: number; role: DropRole }[] => {
    candidates ??= buildCandidates();
    return candidates.slice(0, maxRuns);
  };

  const effects: DropEffect[] = [];
  const sorted = (): DropEffect[] =>
    [...effects].sort(
      (a, b) =>
        b.reduces - a.reduces ||
        b.plan.stats.coveredWanted - a.plan.stats.coveredWanted ||
        a.plan.stats.requiredPacks - b.plan.stats.requiredPacks ||
        a.giftId - b.giftId,
    );
  const single = (list: DropEffect[]): RouteVariant | null => {
    const best = list[0];
    return best && best.reduces === conflictRoots.length ? { dropped: [best.giftId], plan: best.plan } : null;
  };
  // Before the forced plans are done the candidates are not final; a preview counts them.
  const skipped = (): number => (candidates ?? buildCandidates()).length - effects.length;
  // A lost goal the forced plan could not keep may still have rivals: a bar whose drop keeps it.
  const withRivals = (): Tradeoff[] =>
    forceQueue
      .slice(0, forced)
      .map((lost) => ({
        lost,
        causes: causesOf.get(lost) ?? [],
        rivals: effects
          .filter((e) => e.giftId !== lost && !lostWithout.get(e.giftId)!.has(lost))
          .map((e) => e.giftId)
          .sort((a, b) => a - b),
      }))
      .filter((t) => t.causes.length > 0 || t.rivals.length > 0);
  let finished: { at: number; analysis: DropAnalysis } | null = null;

  return {
    conflicts: conflictRoots.length,
    done: () => forced >= forceQueue.length && effects.length >= queue().length,
    forcing: () => forced < forceQueue.length,
    step() {
      if (forced < forceQueue.length) {
        const lost = forceQueue[forced++]!;
        const wanted = input.wanted.map((w) => ({
          ...w,
          required: w.giftId === lost || (tiered && w.required),
        }));
        const plan = planRouteOf({ ...scoped, wanted });
        const lostNow = new Set(conflictRootsOf(plan, scoped, data, indexes));
        if (!lostNow.has(lost)) {
          const causes = [...lostNow]
            .filter((id) => !lostBefore.has(id) && id !== lost)
            .sort((a, b) => a - b);
          if (causes.length > 0) causesOf.set(lost, causes);
        }
        return;
      }
      const next = queue()[effects.length];
      if (next === undefined) return;
      const plan = planRouteOf({ ...scoped, wanted: input.wanted.filter((w) => w.giftId !== next.giftId) });
      const lostNow = conflictRootsOf(plan, scoped, data, indexes);
      lostWithout.set(next.giftId, new Set(lostNow));
      const reduces = conflictRoots.length - lostNow.length;
      const effect: DropEffect = { giftId: next.giftId, reduces, plan, role: next.role };
      if (reduces === 0) {
        const peers = sharingWith(next.giftId);
        if (peers.length > 0) effect.sharesPackWith = peers;
      }
      effects.push(effect);
    },
    snapshot() {
      const list = sorted();
      return {
        conflicts: conflictRoots.length,
        effects: list,
        resolving: single(list),
        tradeoffs: withRivals(),
        skipped: skipped(),
      };
    },
    finish() {
      if (finished && finished.at === effects.length) return finished.analysis;
      const list = sorted();
      let resolving = single(list);
      const bundle = conflictRoots.filter((id) => !required.has(id));
      if (!resolving && bundle.length >= 2) {
        // The bundle depends only on the main plan, so the last finish's answer still stands.
        const previous = finished?.analysis.resolving;
        if (previous && previous.dropped.length === bundle.length) resolving = previous;
        else {
          const dropped = new Set(bundle);
          const plan = planRouteOf({ ...scoped, wanted: input.wanted.filter((w) => !dropped.has(w.giftId)) });
          if (left(plan) === 0) resolving = { dropped: bundle, plan };
        }
      }
      const analysis: DropAnalysis = {
        conflicts: conflictRoots.length,
        effects: list,
        resolving,
        tradeoffs: withRivals(),
        skipped: skipped(),
      };
      finished = { at: effects.length, analysis };
      return analysis;
    },
    extend() {
      maxRuns = Infinity;
    },
  };
}
