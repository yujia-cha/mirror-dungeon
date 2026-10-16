/**
 * Alternative routes: when the wanted gifts cannot all fit in one run, plan again with one of the
 * conflicting gifts left out, so the user can pick which gift to give up.
 *
 * Single drops that clear every conflict come first. When none does, the gifts the main plan
 * itself left out are tried together as one bundle: the search minimises missed requirements, so
 * dropping exactly those is the smallest set it knows to fit (see `minDrops`).
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanInput, RoutePlan } from './types.ts';
import { wantedRoots } from './conflicts.ts';
import { planRoute } from './index.ts';
import { modeForFloor } from './search.ts';

export interface RouteVariant {
  /** Wanted gift ids this variant leaves out: one, or the bundle when no single drop clears. */
  dropped: number[];
  plan: RoutePlan;
}

export interface AlternativeOptions {
  /** Variants returned, best first. */
  max?: number;
  /** Candidate drops tried, which bounds the number of extra `planRoute` calls. */
  maxRuns?: number;
}

export function planAlternatives(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  main?: RoutePlan,
  opts: AlternativeOptions = {},
): RouteVariant[] {
  const max = opts.max ?? 4;
  const maxRuns = opts.maxRuns ?? 6;
  const base = main ?? planRoute(input, data, indexes);

  const conflicts = base.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId);
  if (conflicts.length === 0) return [];

  const wantedIds = new Set(input.wanted.map((w) => w.giftId));
  const options =
    base.floors.length > 0
      ? { ...input.options, lastFloor: base.floors[base.floors.length - 1]!.floor }
      : input.options;

  // A fusion ingredient that lost its floor drops the wanted result it feeds, not itself.
  const roots = wantedRoots({ ...input, options }, data, indexes);

  // Floors a conflicting gift's pack could have taken, honouring pins and bans.
  const banned = new Set(options.bannedPacks);
  const contested = new Set<number>();
  for (const giftId of conflicts) {
    const packs = (indexes.packsByGift.get(giftId) ?? []).filter((id) => !banned.has(id));
    for (const floor of base.floors) {
      const offered =
        indexes.packsByFloor[modeForFloor(floor.floor, options, indexes)].get(floor.floor) ?? [];
      const pinned = options.pinnedPacks[floor.floor];
      if (packs.some((id) => offered.includes(id) && (pinned === undefined || pinned === id)))
        contested.add(floor.floor);
    }
  }
  const occupants = base.floors
    .filter((floor) => floor.reason === 'required' && contested.has(floor.floor))
    .flatMap((floor) => floor.pickups.flatMap((p) => roots(p.giftId)));

  // A gift the user marked as required is never the one to give up — as long as the input tells
  // required gifts apart from the rest. When everything is required (the CLI default) there is no
  // preference to honour and every side of the conflict is a candidate.
  const tiered = input.wanted.some((w) => !w.required);
  const required = new Set(tiered ? input.wanted.filter((w) => w.required).map((w) => w.giftId) : []);
  // Sides of the conflict first, then the gifts holding the contested floors: with one conflict
  // the former always clear it, so the cap never cuts off a drop that would.
  const conflictRoots = [...new Set(conflicts.flatMap((id) => roots(id)))]
    .filter((id) => !required.has(id))
    .sort((a, b) => a - b);
  const others = [...new Set(occupants)]
    .filter((id) => !required.has(id) && !conflictRoots.includes(id))
    .sort((a, b) => a - b);
  const candidates = [...conflictRoots, ...others].slice(0, maxRuns);
  const conflictsLeft = (plan: RoutePlan): number =>
    new Set(plan.unresolved.filter((u) => u.reason === 'pack-conflict').flatMap((u) => roots(u.giftId))).size;

  const covered = (plan: RoutePlan, wanted: number[]): string => {
    const unresolved = new Set(plan.unresolved.map((u) => u.giftId));
    return wanted
      .filter((id) => !unresolved.has(id))
      .sort((a, b) => a - b)
      .join(',');
  };
  const unresolvedKey = (plan: RoutePlan): string =>
    plan.unresolved.map((u) => `${u.giftId}:${u.reason}`).join(',');
  const mainCovered = covered(base, [...wantedIds]);
  const mainUnresolved = unresolvedKey(base);

  const variants: RouteVariant[] = [];
  const seenCovered = new Set<string>();
  for (const giftId of candidates) {
    const wanted = input.wanted.filter((w) => w.giftId !== giftId);
    const plan = planRoute({ ...input, wanted, options }, data, indexes);
    const key = covered(
      plan,
      wanted.map((w) => w.giftId),
    );
    if (key === mainCovered && unresolvedKey(plan) === mainUnresolved) continue;
    if (seenCovered.has(key)) continue;
    seenCovered.add(key);
    variants.push({ dropped: [giftId], plan });
  }

  const sorted = variants
    .map((variant) => ({ variant, left: conflictsLeft(variant.plan) }))
    .sort(
      (a, b) =>
        a.left - b.left ||
        b.variant.plan.stats.coveredWanted - a.variant.plan.stats.coveredWanted ||
        a.variant.plan.stats.requiredPacks - b.variant.plan.stats.requiredPacks ||
        a.variant.dropped[0]! - b.variant.dropped[0]!,
    )
    .map((entry) => entry.variant)
    .slice(0, max);

  // No single drop clears it: offer the main plan's own losses together, if that really fits.
  if (conflictRoots.length >= 2 && !sorted.some((v) => conflictsLeft(v.plan) === 0)) {
    const dropped = new Set(conflictRoots);
    const wanted = input.wanted.filter((w) => !dropped.has(w.giftId));
    const plan = planRoute({ ...input, wanted, options }, data, indexes);
    if (conflictsLeft(plan) === 0) return [{ dropped: conflictRoots, plan }, ...sorted].slice(0, max);
  }
  return sorted;
}

/**
 * How many goals have to go for the rest to fit, as far as the alternatives know: the size of the
 * first variant when it clears every conflict, else `null` (none found within the run budget).
 */
export function minDrops(variants: readonly RouteVariant[]): number | null {
  const first = variants[0];
  if (!first || first.plan.unresolved.some((u) => u.reason === 'pack-conflict')) return null;
  return first.dropped.length;
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
   * together (as `planAlternatives` builds it). `null` when neither was found.
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
}

/** Lost goals a forced plan is made for: each costs one `planRoute`. */
export const MAX_TRADEOFFS = 3;

/**
 * The goals a plan loses to the conflict, ingredients mapped to the goal they feed. A copy lost
 * as `ingredient-shared` counts for the fusion it actually starved — the goal that is itself
 * unresolved — not for every fusion that eats the ingredient (one copy was planned for another).
 */
export function conflictRootsOf(
  plan: RoutePlan,
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
): number[] {
  const conflicts = plan.unresolved.filter(
    (u) => u.reason === 'pack-conflict' || u.reason === 'ingredient-shared',
  );
  if (conflicts.length === 0) return [];
  const roots = wantedRoots(input, data, indexes);
  const unresolved = new Set(plan.unresolved.map((u) => u.giftId));
  return [
    ...new Set(
      conflicts.flatMap((u) =>
        u.reason === 'pack-conflict' ? roots(u.giftId) : roots(u.giftId).filter((r) => unresolved.has(r)),
      ),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Each candidate goal left out on its own, measured by how many conflicting goals that clears.
 *
 * Unlike `planAlternatives` nothing is merged or cut to a short list: every candidate gets its bar,
 * because a drop that clears nothing is worth knowing too. Effects do not add up — two goals that
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
  const base = main ?? planRoute(input, data, indexes);
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

  const conflictFloors = new Set<number>();
  const banned = new Set(options.bannedPacks);
  for (const u of base.unresolved) {
    if (u.reason !== 'pack-conflict') continue;
    const packs = (indexes.packsByGift.get(u.giftId) ?? []).filter((id) => !banned.has(id));
    for (const floor of base.floors) {
      const offered =
        indexes.packsByFloor[modeForFloor(floor.floor, options, indexes)].get(floor.floor) ?? [];
      const pinned = options.pinnedPacks[floor.floor];
      if (packs.some((id) => offered.includes(id) && (pinned === undefined || pinned === id)))
        conflictFloors.add(floor.floor);
    }
  }
  const occupants = base.floors
    .filter((floor) => floor.reason === 'required' && conflictFloors.has(floor.floor))
    .flatMap((floor) => floor.pickups.flatMap((p) => roots(p.giftId)));
  const observed = base.start.observed.flatMap((o) => roots(o.giftId));
  const start = base.start.startGift === null ? [] : roots(base.start.startGift);
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
    step() {
      if (forced < forceQueue.length) {
        const lost = forceQueue[forced++]!;
        const wanted = input.wanted.map((w) => ({
          ...w,
          required: w.giftId === lost || (tiered && w.required),
        }));
        const plan = planRoute({ ...scoped, wanted }, data, indexes);
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
      const plan = planRoute(
        { ...scoped, wanted: input.wanted.filter((w) => w.giftId !== next.giftId) },
        data,
        indexes,
      );
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
          const plan = planRoute(
            { ...scoped, wanted: input.wanted.filter((w) => !dropped.has(w.giftId)) },
            data,
            indexes,
          );
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
