/**
 * Ways to resolve a conflict (M144): the fewest goals to remove, and whether releasing one of the
 * player's own observation pins does it with fewer — or with none.
 *
 * The key fact. With the pins fixed the planner already minimises the goals it loses — call that k
 * (the conflicting goals, `conflictRootsOf`). So:
 * - no set of fewer than k removals can resolve it: put the removed goals back into a plan that
 *   fits the rest and it loses at most as many goals as were removed, and k is the least it can
 *   lose;
 * - removing the plan's own k lost goals always resolves it: the plan itself, without them, fits.
 * The job is therefore to list the k-sized removal sets, not to search every subset, and to see
 * whether releasing pins lowers k.
 *
 * 1. Release stage (goals kept). Each non-empty subset of the releasable pins — the player's own
 *    (`observedGifts`, applied as pinned in the plan), never one already in hand (an observation
 *    spent, M134) — is planned with those pins released and the planner free to recommend again.
 *    Releasing more can only widen its choice, so the subset with everything released is planned
 *    first: when it gains nothing, no subset can and the stage is over. Otherwise the subsets go in
 *    size order, and a superset of one that already reached the best is not planned. The release
 *    states kept are the ones that beat every smaller state they contain (the empty one included).
 *    Skipped once the start is closed (`startDecided`, or past floor 1): observation cannot change.
 * 2. Minimal removal stage, per kept state (the current pins first). Its plan's lost goals are the
 *    first solution. More are enumerated in Lawler's way: for a solution S found with goals F kept
 *    by force and R removed, the i-th child keeps S's i-th goal too (`required`) and removes the
 *    ones before it; a child whose plan still loses exactly k − |R| goals, none of them kept by
 *    force, is a new solution. The children partition what is left, so every k-sized solution is
 *    found exactly once and nothing else is planned. Goals in every solution of a state are
 *    `essential` (「꼭 빼야 함」) once its enumeration finished.
 * 3. Other ways: the goals one pack serves in the main plan (`sharesPackWith` on the bars), as a
 *    group, when the group is no superset of a solution found. Larger than k, they are 「다른 방법」.
 *
 * Ranking: goals removed → pins released → goals got → packs → releases, then removals, by id.
 *
 * One `planRoute` per step, a snapshot after each, and `finish()` — the same shape as
 * `createDropEffects`, so the worker spends its budget on it the same way. The steps are bounded by
 * `maxRuns`, and `extend()` lifts it only to `RESOLUTION_RUN_CAP`: a k of 4 among many rivals has
 * more solutions than anyone reads.
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanInput, RoutePlan, WantedGift } from './types.ts';
import { conflictRootsOf } from './alternatives.ts';
import { wantedRoots } from './conflicts.ts';
import { planRoute } from './index.ts';
import { modeForFloor } from './search.ts';

/**
 * The minimal ways of one release state, summed up for the card: the goals every way removes
 * (「꼭 빼야 함」) and the pool the rest are taken from. `any` says the pool is free — every `pick`
 * of it was found to fit (「이 중 아무거나」); otherwise only the listed ways are known to.
 */
export interface ResolutionChoice {
  releases: number[];
  /** Goals each way removes: k of this state. */
  removals: number;
  essential: number[];
  pool: number[];
  pick: number;
  any: boolean;
  /** The state was enumerated to the end; before that `essential` is empty and `any` false. */
  complete: boolean;
  /** Minimal ways found. */
  ways: number;
}

/** One way to make the goals fit. */
export interface Resolution {
  /** The player's own observation pins released, by gift id. */
  releases: number[];
  /** Goals removed, by gift id. */
  removals: number[];
  /**
   * The fewest removals with these releases (k of that release state). False for 「다른 방법」: a
   * same-pack group that fits but removes more than it has to.
   */
  minimal: boolean;
  /**
   * Of `removals`, the goals every minimal way with the same releases removes (「꼭 빼야 함」). Only
   * said once that release state was enumerated to the end; empty before.
   */
  essential: number[];
  /** Goals the plan behind it gets. */
  got: number;
  /** Packs the plan behind it enters (with forced goals still in it, for an enumerated way). */
  packs: number;
  /** The search behind it, or the main plan's, was cut short (`searchCapped`): 「근사」. */
  approx: boolean;
}

export interface ResolutionAnalysis {
  /** Conflicting goals in the main plan: k with the pins as they are. */
  conflicts: number;
  /** The pins the release stage could release; empty once the start is closed. */
  releasable: number[];
  /** Every way found, best first (see the ranking above). */
  methods: Resolution[];
  /** The minimal ways per release state, fewest removals first. */
  choices: ResolutionChoice[];
  /**
   * The main plan's search was cut short (k is the search's, not a proof), or a plan the analysis
   * made was (a way may have been missed).
   */
  approx: boolean;
  /** `planRoute` calls spent. */
  runs: number;
  /** Every step was taken — no state or group was left for the budget or the cap. */
  complete: boolean;
}

export interface ResolutionOptions {
  /** `planRoute` calls allowed before `extend()`. */
  maxRuns?: number;
  /** Plan an input; the worker passes a memo shared with the bars. Default `planRoute`. */
  planner?: (input: PlanInput) => RoutePlan;
}

export interface ResolutionSteps {
  conflicts: number;
  done(): boolean;
  step(): void;
  snapshot(): ResolutionAnalysis;
  finish(): ResolutionAnalysis;
  /** Lift `maxRuns` to `RESOLUTION_RUN_CAP` (the card's 「더 계산」). */
  extend(): void;
}

/** Calls the analysis may spend before the player asks for more. */
export const RESOLUTION_RUNS = 32;
/** Calls it may spend at all. */
export const RESOLUTION_RUN_CAP = 96;
/** Same-pack groups tried as 「다른 방법」, and their largest size. */
export const MAX_PACK_GROUPS = 4;
export const MAX_GROUP_SIZE = 4;

const byId = (a: number, b: number): number => a - b;
const choose = (n: number, r: number): number => {
  let out = 1;
  for (let i = 1; i <= r; i += 1) out = (out * (n - r + i)) / i;
  return Math.round(out);
};
const keyOf = (ids: readonly number[]): string => [...ids].sort(byId).join(',');
const lexical = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
};

/** Ranking: goals removed → pins released → goals got → packs → releases, then removals, by id. */
export function compareResolutions(a: Resolution, b: Resolution): number {
  return (
    a.removals.length - b.removals.length ||
    a.releases.length - b.releases.length ||
    b.got - a.got ||
    a.packs - b.packs ||
    lexical(a.releases, b.releases) ||
    lexical(a.removals, b.removals)
  );
}

interface Found {
  removals: number[];
  got: number;
  packs: number;
  approx: boolean;
  minimal: boolean;
}

interface Node {
  forced: number[];
  removed: number[];
}

interface State {
  releases: number[];
  input: PlanInput;
  k: number;
  found: Map<string, Found>;
  queue: Node[];
}

export function planResolutions(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  main?: RoutePlan,
  opts: ResolutionOptions = {},
): ResolutionAnalysis {
  const steps = createResolutions(input, data, indexes, main, opts);
  while (!steps.done()) steps.step();
  return steps.finish();
}

export function createResolutions(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  main?: RoutePlan,
  opts: ResolutionOptions = {},
): ResolutionSteps {
  const planner = opts.planner ?? ((i: PlanInput) => planRoute(i, data, indexes));
  let maxRuns = opts.maxRuns ?? RESOLUTION_RUNS;
  const base = main ?? planner(input);
  // The same scope as the bars (`createDropEffects`), so the two can share plans.
  const options =
    base.floors.length > 0
      ? { ...input.options, lastFloor: base.floors[base.floors.length - 1]!.floor }
      : input.options;
  const scoped: PlanInput = { ...input, options };
  const lostIn = (plan: RoutePlan, of: PlanInput): number[] => conflictRootsOf(plan, of, data, indexes);
  const k0 = lostIn(base, scoped).length;
  const approx = base.stats.searchCapped;
  /** Any plan cut short so far: a node it failed may have hidden a way, so the list says 「근사」. */
  let cappedSeen = approx;
  let runs = 0;
  const run = (of: PlanInput): RoutePlan => {
    runs += 1;
    const plan = planner(of);
    if (plan.stats.searchCapped) cappedSeen = true;
    return plan;
  };

  if (k0 === 0) {
    const empty: ResolutionAnalysis = {
      conflicts: 0,
      releasable: [],
      methods: [],
      choices: [],
      approx,
      runs: 0,
      complete: true,
    };
    return {
      conflicts: 0,
      done: () => true,
      step: () => undefined,
      snapshot: () => empty,
      finish: () => empty,
      extend: () => undefined,
    };
  }

  // A goal the player made required is kept as if forced; with every goal required (the CLI) there
  // is no preference to honour and all are optional here, as in the bars' forced plans.
  const tiered = input.wanted.some((w) => !w.required);
  const startClosed = (options.currentFloor ?? 1) > 1 || options.startDecided === true;
  const inHand = new Set(options.ownedGifts ?? []);
  const pins = new Set(options.observedGifts);
  const releasable = startClosed
    ? []
    : [
        ...new Set(
          base.start.observed
            .filter((o) => o.pinned && pins.has(o.giftId) && !inHand.has(o.giftId))
            .map((o) => o.giftId),
        ),
      ].sort(byId);
  const released = (releases: readonly number[]): PlanInput =>
    releases.length === 0
      ? scoped
      : {
          ...scoped,
          options: {
            ...options,
            observedGifts: options.observedGifts.filter((id) => !releases.includes(id)),
          },
        };

  const record = (state: State, removals: number[], plan: RoutePlan, minimal: boolean): boolean => {
    const key = keyOf(removals);
    if (state.found.has(key)) return false;
    state.found.set(key, {
      removals: [...removals].sort(byId),
      got: plan.stats.coveredWanted,
      packs: plan.stats.requiredPacks,
      approx: approx || plan.stats.searchCapped,
      minimal,
    });
    return true;
  };
  /** Lawler's children of a solution `lost` found with `forced` kept and `removed` gone. */
  const children = (state: State, node: Node, lost: number[]): void => {
    const free = lost.filter((id) => !node.forced.includes(id)).sort(byId);
    free.forEach((giftId, i) =>
      state.queue.push({
        forced: [...node.forced, giftId],
        removed: [...node.removed, ...free.slice(0, i)],
      }),
    );
  };
  const open = (releases: number[], plan: RoutePlan): State => {
    const of = released(releases);
    const lost = lostIn(plan, of);
    const state: State = { releases, input: of, k: lost.length, found: new Map(), queue: [] };
    record(state, lost, plan, true);
    if (lost.length > 0) children(state, { forced: [], removed: [] }, lost);
    return state;
  };

  const states: State[] = [open([], base)];

  // ---- Stage 1: releases ----------------------------------------------------------------
  /** Planned release subsets, by key: their misses and plan. */
  const tried = new Map<string, { releases: number[]; k: number; plan: RoutePlan }>();
  tried.set('', { releases: [], k: k0, plan: base });
  const subsets: number[][] = [];
  for (let mask = 1; mask < 1 << releasable.length; mask += 1)
    subsets.push(releasable.filter((_, i) => (mask >> i) & 1));
  subsets.sort((a, b) => a.length - b.length || lexical(a, b));
  /** Everything released first: when that gains nothing, no subset can. */
  const releaseQueue: number[][] =
    releasable.length >= 2 ? [releasable, ...subsets.filter((s) => s.length < releasable.length)] : subsets;
  let releaseAt = 0;
  let releasesOpened = false;
  const contains = (outer: readonly number[], inner: readonly number[]): boolean =>
    inner.every((id) => outer.includes(id));
  const nextRelease = (): number[] | null => {
    while (releaseAt < releaseQueue.length) {
      const subset = releaseQueue[releaseAt]!;
      const all = tried.get(keyOf(releasable));
      // Everything released gained nothing: no subset can (releasing only widens the choice).
      if (all && all.k === k0 && subset.length < releasable.length) {
        releaseAt = releaseQueue.length;
        return null;
      }
      // A superset of a subset that already reached the floor (what releasing everything reaches)
      // can do no better and releases more.
      const dominated =
        all !== undefined &&
        [...tried.values()].some(
          (t) => t.releases.length < subset.length && t.k === all.k && contains(subset, t.releases),
        );
      if (dominated || tried.has(keyOf(subset))) {
        releaseAt += 1;
        continue;
      }
      return subset;
    }
    return null;
  };
  /** The release states worth enumerating: each beats every smaller state it contains. */
  const openReleaseStates = (): void => {
    releasesOpened = true;
    const kept = [...tried.values()]
      .filter((t) => t.releases.length > 0)
      .filter((t) =>
        [...tried.values()].every(
          (u) => u.releases.length >= t.releases.length || !contains(t.releases, u.releases) || t.k < u.k,
        ),
      )
      .sort((a, b) => a.k - b.k || a.releases.length - b.releases.length || lexical(a.releases, b.releases));
    for (const t of kept) states.push(open(t.releases, t.plan));
  };

  // ---- Stage 3: same-pack groups ------------------------------------------------------------
  const wantedIds = new Set(input.wanted.map((w) => w.giftId));
  const keep = new Set(tiered ? input.wanted.filter((w) => w.required).map((w) => w.giftId) : []);
  const groups: number[][] = (() => {
    const lostGoals = base.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId);
    const banned = new Set(options.bannedPacks);
    const contested = new Set<number>();
    for (const giftId of lostGoals) {
      const packs = (indexes.packsByGift.get(giftId) ?? []).filter((id) => !banned.has(id));
      for (const floor of base.floors) {
        const offered =
          indexes.packsByFloor[modeForFloor(floor.floor, options, indexes)].get(floor.floor) ?? [];
        if (packs.some((id) => offered.includes(id))) contested.add(floor.floor);
      }
    }
    const goalRoot = wantedRoots(scoped, data, indexes);
    const out = new Map<string, number[]>();
    for (const floor of base.floors) {
      if (floor.packId === null || floor.reason !== 'required' || !contested.has(floor.floor)) continue;
      const goals = [
        ...new Set(floor.pickups.flatMap((p) => goalRoot(p.giftId)).filter((id) => wantedIds.has(id))),
      ].sort(byId);
      if (goals.length < Math.max(2, k0) || goals.length > MAX_GROUP_SIZE) continue;
      if (goals.some((id) => keep.has(id))) continue;
      out.set(keyOf(goals), goals);
    }
    return [...out.values()].sort((a, b) => a.length - b.length || lexical(a, b)).slice(0, MAX_PACK_GROUPS);
  })();
  let groupAt = 0;
  const groupFound = new Map<string, Found>();
  const dominatedGroup = (group: readonly number[]): boolean =>
    [...states[0]!.found.values()].some((f) => contains(group, f.removals));

  let cursor = 0;
  const enumerating = (): boolean => states.some((s) => s.queue.length > 0);
  const pendingGroup = (): number[] | null => {
    while (groupAt < groups.length) {
      const group = groups[groupAt]!;
      if (!dominatedGroup(group) && !groupFound.has(keyOf(group))) return group;
      groupAt += 1;
    }
    return null;
  };
  const hasWork = (): boolean => !releasesOpened || enumerating() || pendingGroup() !== null;
  if (nextRelease() === null) openReleaseStates();

  const step = (): void => {
    if (runs >= maxRuns) return;
    if (!releasesOpened) {
      const subset = nextRelease()!;
      releaseAt += 1;
      const of = released(subset);
      const plan = run(of);
      tried.set(keyOf(subset), { releases: subset, k: lostIn(plan, of).length, plan });
      if (nextRelease() === null) openReleaseStates();
      return;
    }
    if (enumerating()) {
      // Round robin over the states, so one with many solutions does not starve the others.
      let state = states[cursor % states.length]!;
      while (state.queue.length === 0) {
        cursor += 1;
        state = states[cursor % states.length]!;
      }
      cursor += 1;
      const node = state.queue.shift()!;
      const forced = new Set(node.forced);
      const removed = new Set(node.removed);
      const wanted: WantedGift[] = state.input.wanted
        .filter((w) => !removed.has(w.giftId))
        .map((w) => ({ ...w, required: forced.has(w.giftId) || (tiered && w.required) }));
      const of = { ...state.input, wanted };
      const plan = run(of);
      const lost = lostIn(plan, of);
      if (lost.length === state.k - removed.size && lost.every((id) => !forced.has(id))) {
        if (record(state, [...node.removed, ...lost], plan, true)) children(state, node, lost);
      }
      return;
    }
    const group = pendingGroup();
    if (group === null) return;
    groupAt += 1;
    const of = { ...scoped, wanted: scoped.wanted.filter((w) => !group.includes(w.giftId)) };
    const plan = run(of);
    if (lostIn(plan, of).length > 0) return;
    const found: Found = {
      removals: group,
      got: plan.stats.coveredWanted,
      packs: plan.stats.requiredPacks,
      approx: approx || plan.stats.searchCapped,
      minimal: group.length === k0,
    };
    // A group of k is a minimal way the enumeration had not reached yet.
    if (found.minimal) states[0]!.found.set(keyOf(group), found);
    else groupFound.set(keyOf(group), found);
  };

  const snapshot = (): ResolutionAnalysis => {
    const complete = !hasWork();
    const methods: Resolution[] = [];
    const choices: ResolutionChoice[] = [];
    for (const state of states) {
      const minimal = [...state.found.values()].filter((f) => f.minimal);
      // 「꼭 빼야 함」 is a claim about every way, so it waits for the state's last child.
      const enumerated = state.queue.length === 0;
      const essential =
        enumerated && minimal.length > 0
          ? minimal[0]!.removals.filter((id) => minimal.every((f) => f.removals.includes(id)))
          : [];
      for (const f of state.found.values())
        methods.push({
          releases: state.releases,
          removals: f.removals,
          minimal: f.minimal,
          essential: f.minimal ? essential : [],
          got: f.got,
          packs: f.packs,
          approx: f.approx,
        });
      if (state.k === 0 || minimal.length === 0) continue;
      const pool = [...new Set(minimal.flatMap((f) => f.removals))]
        .filter((id) => !essential.includes(id))
        .sort(byId);
      const pick = state.k - essential.length;
      choices.push({
        releases: state.releases,
        removals: state.k,
        essential,
        pool,
        pick,
        any: enumerated && pick > 0 && pool.length > pick && minimal.length === choose(pool.length, pick),
        complete: enumerated,
        ways: minimal.length,
      });
    }
    for (const f of groupFound.values())
      methods.push({
        releases: [],
        removals: f.removals,
        minimal: false,
        essential: [],
        got: f.got,
        packs: f.packs,
        approx: f.approx,
      });
    methods.sort(compareResolutions);
    choices.sort(
      (a, b) =>
        a.removals - b.removals || a.releases.length - b.releases.length || lexical(a.releases, b.releases),
    );
    return { conflicts: k0, releasable, methods, choices, approx: cappedSeen, runs, complete };
  };

  let finished: { at: number; analysis: ResolutionAnalysis } | null = null;
  return {
    conflicts: k0,
    done: () => runs >= maxRuns || !hasWork(),
    step,
    snapshot,
    finish() {
      if (finished && finished.at === runs) return finished.analysis;
      const analysis = snapshot();
      finished = { at: runs, analysis };
      return analysis;
    },
    extend() {
      maxRuns = RESOLUTION_RUN_CAP;
    },
  };
}
