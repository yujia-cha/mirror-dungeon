/**
 * The route planner.
 *
 * Pure TypeScript: no React, no DOM, no network. It runs in the browser, in Vitest and in
 * scripts/route-cli.ts, and the same input always produces the same output.
 */
import type { GameData } from './schema.ts';
import type {
  FloorPlan,
  FusionStep,
  GameIndexes,
  ObservedGift,
  PlanInput,
  PlanOptions,
  RequirementRoute,
  RoutePlan,
  Unresolved,
} from './types.ts';
import { analyseDeck, evaluateConditions } from './deck.ts';
import { expandRequirements, goalRoots, scarcity } from './requirements.ts';
import { normaliseOptions, observationBudget, runStateOf } from './options.ts';
import {
  alternativePacksOn,
  assignPacks,
  modeForFloor,
  observationCost,
  rewardPacksOf,
  type SearchGoals,
} from './search.ts';
import { requirementKey } from './requirements.ts';
import { chooseStart, observable, startGiftBudget } from './starting.ts';
import { msg } from './messages.ts';

export { createDropEffects, MAX_TRADEOFFS, planDropEffects } from './alternatives.ts';
export type {
  DropAnalysis,
  DropEffect,
  DropEffectOptions,
  DropEffectSteps,
  DropRole,
  RouteVariant,
  Tradeoff,
} from './alternatives.ts';
export {
  compareResolutions,
  createResolutions,
  MAX_GROUP_SIZE,
  MAX_PACK_GROUPS,
  planResolutions,
  RESOLUTION_RUN_CAP,
  RESOLUTION_RUNS,
} from './resolutions.ts';
export type {
  Resolution,
  ResolutionAnalysis,
  ResolutionChoice,
  ResolutionOptions,
  ResolutionSteps,
} from './resolutions.ts';
export { conflictGroups, conflictRootsOf, contestedFloors, wantedRoots } from './conflicts.ts';
export type { ConflictGroup } from './conflicts.ts';
export { buildIndexes } from './data/indexes.ts';
export { analyseDeck, dominantKeyword, evaluateConditions } from './deck.ts';
export {
  giftEffectsReport,
  identityMeets,
  relevanceReason,
  reportRequirement,
  requirementLabel,
  skillGiftLookup,
  slotsMeeting,
} from './effects.ts';
export type {
  EffectReport,
  GiftEffectsReport,
  GiftRelevance,
  RequirementReport,
  SkillGiftIndexFile,
  SkillGiftLookup,
} from './effects.ts';
export { chooseRecipe, expandRequirements, goalRoots, scarcity } from './requirements.ts';
export { alternativePacksOn, assignPacks, modeForFloor, observationCost } from './search.ts';
export { chooseStart, largestStartPool, observable, startGiftBudget } from './starting.ts';
export { observationBudget } from './options.ts';
export * from './types.ts';
export * from './schema.ts';

/** Default options: one Normal clear of floors 1-5; observations are left to the planner. */
export function defaultOptions(): PlanOptions {
  return {
    lastFloor: 5,
    hardFromFloor: null,
    startKeyword: 'auto',
    observedGifts: [],
    assumeUnvisitedPacks: false,
    pinnedPacks: {},
    bannedPacks: [],
    preferredPacks: [],
    currentFloor: 1,
    ownedGifts: [],
    unobtainableGifts: [],
  };
}

/**
 * The contiguous run of floors around `floor` on which `packId` could equally have been placed:
 * offered on that floor, and not already taken by another required pack. This is what
 * lets the UI say "any one of floors 4-5" instead of pinning a floor the search merely happened to
 * pick first.
 *
 * **A window crosses difficulty bands.** Plenty of packs are offered both on Hard 5 and across
 * 평행중첩 6-10 (1호선, 2호선, the 죄악 packs …), and for those the player really may take the pack
 * on any of floors 5-10. Clipping the window at the band boundary used to hide that: a pack the
 * search happened to place on floor 5 reported a window of exactly {5,5}, and every pack in 6-10
 * reported {6,10}, so the stage offered one pack on floor 5 when six were interchangeable. Per-floor
 * legality is enforced by the `packsByFloor` lookup below, which is keyed by each floor's own mode,
 * so a Hard-only pack still cannot wander into a Normal floor without the band check.
 */
function windowFor(
  packId: number,
  floor: number,
  floors: number[],
  options: PlanOptions,
  assignment: Map<number, number>,
  indexes: GameIndexes,
  rewardPacks: ReadonlySet<number>,
): { from: number; to: number } {
  // Floors a pack could be visited on, in this plan: offered there, in that floor's own mode —
  // and not the dungeon's last floor for a pack whose 클리어 보상 the route wants (M173, the same
  // rule as the search's `floorsFor`; a window drawn to that floor would offer an entry there).
  // `floors` are the floors still ahead, and no pack entry names one of those (M118).
  const candidates = (id: number): number[] =>
    floors.filter(
      (g) =>
        !(g === indexes.finalFloor && rewardPacks.has(id)) &&
        (indexes.packsByFloor[modeForFloor(g, options, indexes)].get(g) ?? []).includes(id),
    );
  // Played floors are settled and never move, so only packs still on plannable floors compete.
  const others = [...assignment.entries()].filter(([own, id]) => id !== packId && floors.includes(own));
  const otherCandidates = others.map(([, id]) => candidates(id));

  // Floor g is possible for this pack when every other required pack still fits somewhere else:
  // a bipartite matching of the other packs onto the remaining floors (Kuhn's algorithm; the
  // plan forces at most a handful of packs, so this is tiny and deterministic).
  const fits = (g: number): boolean => {
    const owner = new Map<number, number>();
    const tryPlace = (i: number, seen: Set<number>): boolean => {
      for (const candidate of otherCandidates[i]!) {
        if (candidate === g || seen.has(candidate)) continue;
        seen.add(candidate);
        const current = owner.get(candidate);
        if (current === undefined || tryPlace(current, seen)) {
          owner.set(candidate, i);
          return true;
        }
      }
      return false;
    };
    return otherCandidates.every((_, i) => tryPlace(i, new Set()));
  };

  // Only the unbroken run around `floor` is reported, so a pack offered on Hard 5 and again on
  // EXTREME 11-15 does not claim the 평행중첩 floors in between.
  const possible = new Set(candidates(packId).filter((g) => g === floor || fits(g)));
  let from = floor;
  while (possible.has(from - 1)) from -= 1;
  let to = floor;
  while (possible.has(to + 1)) to += 1;
  return { from, to };
}

/**
 * The floors of the run: `rows` is every floor the plan reports on, `plannable` the ones still
 * ahead of the player (a fresh run plans them all).
 */
function floorsFor(options: PlanOptions, data: GameData): { rows: number[]; plannable: number[] } {
  const all = [...data.rules.floors.normal, ...data.rules.floors.parallel, ...data.rules.floors.extreme].sort(
    (a, b) => a - b,
  );
  const rows = [...new Set(all)].filter((floor) => floor <= options.lastFloor);
  const currentFloor = options.currentFloor ?? 1;
  return { rows, plannable: rows.filter((floor) => floor >= currentFloor) };
}

/**
 * The routes a copy the run will hold comes by. A routed copy counts only once the search placed it
 * (`supplier`); one left unplaced, dropped or given up is no copy the run will hold, so it neither
 * makes a second copy 「두 번째 몫」 (`ingredient-shared`) nor a shared ingredient (M160).
 */
const HELD_ROUTES: ReadonlySet<RequirementRoute> = new Set([
  'route',
  'observation',
  'startGift',
  'generalDrop',
  'owned',
]);

export function planRoute(input: PlanInput, data: GameData, indexes: GameIndexes): RoutePlan {
  const { options, warnings, droppedObservations } = normaliseOptions(
    input.options,
    data,
    indexes,
    input.deck,
  );
  const { rows, plannable: floors } = floorsFor(options, data);
  const currentFloor = options.currentFloor ?? 1;
  const midRun = currentFloor > 1;
  // The start stage (start gifts, 기프트 관측) is over once floor 1 is left — or earlier, when the
  // player is past the observation screen and only floor 1's pack is still to come (M134).
  const startOver = midRun || options.startDecided === true;
  // Played floors: the pack taken there is settled and its gifts count as picked up there.
  const passed = new Map<number, number>();
  for (const floor of rows) {
    if (floor >= currentFloor) break;
    const packId = options.pinnedPacks[floor];
    if (packId !== undefined) passed.set(floor, packId);
  }
  // The same run every re-derivation of this plan sees (`runStateOf`): `passed` holds every pack
  // entry the options kept, since they keep entries for played floors only.
  const run = runStateOf(options);

  const stats = analyseDeck(input.deck, indexes, data.rules.deployment, options.deployed);
  const unresolved: Unresolved[] = [];

  // ---- 1. What do we actually have to obtain? -----------------------------
  const expansion = expandRequirements(input.wanted, indexes, stats, data.rules.fusion.maxShopSlots, run);
  unresolved.push(...expansion.unresolved);
  const requirements = expansion.requirements;

  // ---- 2. Gifts that need no routing -------------------------------------
  for (const requirement of requirements) {
    if (requirement.via !== 'route') continue;
    const gift = indexes.giftById.get(requirement.giftId);
    if (!gift) continue;
    if (!gift.obtainable) {
      requirement.via = 'unresolved';
      unresolved.push({
        giftId: requirement.giftId,
        reason: 'not-obtainable',
        detail: msg('unresolved.notObtainable'),
      });
      continue;
    }
    if (gift.acquisition.kind === 'hiddenBattle') {
      // A random extra battle on EXTREME floors drops it; no pack choice makes that certain.
      const hidden = data.rules.hiddenBattle;
      const [from, to] =
        hidden && hidden.floors.length > 0
          ? [hidden.floors[0], hidden.floors[hidden.floors.length - 1]]
          : [11, 15];
      const floors = { ko: `${from}~${to}`, en: `${from}-${to}` }; // 11~15 / 11-15
      const pct =
        hidden?.probabilityPerFloor !== null && hidden?.probabilityPerFloor !== undefined
          ? Math.round(hidden.probabilityPerFloor * 100)
          : null;
      requirement.via = 'unresolved';
      unresolved.push({
        giftId: requirement.giftId,
        reason: 'chance-only',
        detail:
          pct !== null
            ? msg('unresolved.chanceOnlyRate', { floors, pct })
            : msg('unresolved.chanceOnly', { floors }),
      });
      continue;
    }
    if (
      (gift.acquisition.kind === 'event' || gift.acquisition.kind === 'material') &&
      (indexes.packsByGift.get(requirement.giftId)?.length ?? 0) === 0
    ) {
      // In the season pool but reachable through no pack: a choice event hands it over, or it is a
      // 잔영 that only exists to be fused or sold. Letting it reach the search would blame the floor
      // range (`no-pack-in-range`), which is false — no range would help.
      requirement.via = 'unresolved';
      unresolved.push({
        giftId: requirement.giftId,
        reason: 'no-pack-path',
        detail: msg(gift.acquisition.kind === 'event' ? 'unresolved.eventOnly' : 'unresolved.materialOnly'),
      });
      continue;
    }
    // Any pack can drop it, so no pack is chosen for it — unless a pinned observation or the free
    // starting gift makes it certain below.
    if (indexes.freelyAvailableGifts.has(requirement.giftId)) requirement.via = 'generalDrop';
  }

  // ---- 3. Hard-only gifts on a Normal-only plan ---------------------------
  const planIsHard = options.hardFromFloor !== null;
  for (const requirement of requirements.filter((r) => r.via === 'route')) {
    const gift = indexes.giftById.get(requirement.giftId);
    if (gift?.hardOnly && !planIsHard) {
      unresolved.push({
        giftId: requirement.giftId,
        reason: 'hard-only',
        detail: msg('unresolved.hardOnly'),
      });
      requirement.via = 'unresolved';
    }
  }

  // ---- 4. Pinned observations ---------------------------------------------
  // 기프트 관측 hands over up to `budget` gifts at run start. The user's pins are the one explicit
  // decision in this stage, so they go first — before the free starting gift and before the
  // planner's own recommendations — and they apply to any planned gift not yet in hand: one the
  // route would visit a pack for, or a general drop that observation turns into a certainty. A pin
  // on a gift already in hand before floor 1 is left is one of those slots already spent.
  const budget = observationBudget(options, data);
  const observed: ObservedGift[] = [];
  /**
   * Spend one slot. Observation hands the gift over once, so exactly one requirement changes hands
   * — the copy named by `key` when the caller knows which one is stuck, else the first one.
   */
  const observe = (giftId: number, pinned: boolean, freedPack: number | null, key?: string): void => {
    const open = requirements.filter(
      (r) => r.giftId === giftId && (r.via === 'route' || r.via === 'generalDrop'),
    );
    const target = (key !== undefined ? open.find((r) => requirementKey(r) === key) : undefined) ?? open[0];
    if (target) target.via = 'observation';
    observed.push({ giftId, pinned, freedPack });
  };
  const canObserve = (giftId: number): boolean => {
    const gift = indexes.giftById.get(giftId);
    return gift !== undefined && observable(gift, data.rules) && !observed.some((o) => o.giftId === giftId);
  };
  const plannable = (giftId: number): boolean =>
    requirements.some((r) => r.giftId === giftId && (r.via === 'route' || r.via === 'generalDrop'));
  const known = (giftId: number): boolean => requirements.some((r) => r.giftId === giftId);

  // While floor 1 is still ahead (the observation window is open), a pin on a gift already in hand
  // is an observation already made — screen capture records the observed gift as 획득 the moment
  // the run starts, before floor 1 is left (M134). It keeps its slot: it is listed as observed,
  // pinned, and the planner only recommends what the slots it left can hold. Treating it as free
  // recommended a full set on top of it, more observations than the season has. Its requirement
  // stays `owned`, and it counts even when it is no goal any more — the starlight is spent either
  // way, so a plan without that goal (the drop analysis) must not get the slot back.
  //
  // A pin the plan already gave up on is skipped without a word: the unresolved list already
  // explains it. A pin on a gift that is no goal at all (and not in hand) is reported as trimmed.
  // Once floor 1 is left the observation is spent: a pin on a gift in hand is moot then (the app
  // keeps pins after floor 1, when they are owned), and a pin on a gift still to be found cannot
  // be applied any more — it is reported as `observation-after-start` instead of turning a gift
  // the run has yet to find into a certainty. The same goes from the moment the player is past the
  // observation screen on floor 1 (`startDecided`), except that pins on gifts in hand still hold
  // their slots there: the floor-1 rule above sees them before this one.
  const notPlanned: number[] = [];
  const afterStart: number[] = [];
  for (const giftId of options.observedGifts) {
    if (!midRun && run.owned.has(giftId)) {
      if (!observed.some((o) => o.giftId === giftId))
        observed.push({ giftId, pinned: true, freedPack: null });
      continue;
    }
    if (!known(giftId)) {
      notPlanned.push(giftId);
      continue;
    }
    if (!plannable(giftId)) continue;
    if (startOver) {
      afterStart.push(giftId);
      continue;
    }
    // The pins were trimmed to the budget by `normaliseOptions`, and no gift enters `observed`
    // twice, so the slots cannot run out here.
    if (canObserve(giftId)) observe(giftId, true, null);
  }
  if (afterStart.length > 0) {
    warnings.push({
      code: 'observation-after-start',
      giftIds: [...new Set(afterStart)].sort((a, b) => a - b),
      detail: msg('warn.observationAfterStart'),
    });
  }
  const trimmed = [...new Set([...droppedObservations, ...notPlanned])];
  if (trimmed.length > 0) {
    warnings.push({
      code: 'observation-trimmed',
      giftIds: trimmed,
      detail: msg('warn.observationTrimmed', { budget }),
    });
  }

  // ---- 5. The free starting-keyword gifts ---------------------------------
  // Once the start is over it was chosen already (whatever it gave is in hand), so only the
  // keyword stands. A general drop in the pool is worth taking here too: free, and certain instead
  // of likely.
  const start = chooseStart(
    startOver ? [] : requirements.filter((r) => r.via === 'route' || r.via === 'generalDrop'),
    indexes,
    data.rules,
    stats,
    options.startKeyword,
    startGiftBudget(options, data.rules),
  );
  // Each pick is one gift, so one copy: a second requirement for it still has to be routed.
  for (const giftId of start.startGifts) {
    const target = requirements.find(
      (r) => r.giftId === giftId && (r.via === 'route' || r.via === 'generalDrop'),
    );
    if (target) target.via = 'startGift';
  }

  // ---- 6. Recommended observations and the pack search -------------------
  /*
   * The search counts goals, not copies (M87): a fusion goal is lost with any one of its copies.
   * Goals the stages above already gave up on — an unresolved gift, and every wanted result above
   * it — are no goals for the search; their copies are still worth routing for their own sake
   * (the ingredients of a fusion that cannot happen stay goals of their own by default), but only
   * once every live goal has had its say. A copy dropped below (step 7) is not what lost its
   * fusion, so it does not make the fusion lost here: the copy that did is still in the search.
   */
  const roots = goalRoots(input.wanted, expansion.fusions, expansion.instances);
  const resultOnly = new Set(input.wanted.filter((w) => w.ingredientsAsGoals === false).map((w) => w.giftId));
  const requiredGoals = new Set(input.wanted.filter((w) => w.required).map((w) => w.giftId));
  const goalsFor = (): SearchGoals => {
    const lost = new Set<number>();
    for (const entry of unresolved) for (const goal of roots.ofGift(entry.giftId)) lost.add(goal);
    const keyed = new Map<string, number[]>();
    for (const requirement of requirements) {
      if (requirement.via === 'route')
        keyed.set(requirementKey(requirement), roots.ofRequirement(requirement));
    }
    return { roots: keyed, required: requiredGoals, lost, resultOnly };
  };
  // Packs whose 클리어 보상 the route wants stay off the dungeon's last floor (M173, search and
  // windows alike).
  const rewardPacks = rewardPacksOf(requirements, indexes);
  const runSearch = (slots = 0) =>
    assignPacks({
      requirements: requirements.filter((r) => r.via === 'route'),
      floors,
      options,
      rules: data.rules,
      indexes,
      passed,
      failed: run.failed,
      goals: goalsFor(),
      ...(slots > 0
        ? {
            observation: {
              slots,
              gifts: new Set(
                requirements.filter((r) => r.via === 'route' && canObserve(r.giftId)).map((r) => r.giftId),
              ),
            },
          }
        : {}),
    });

  /*
   * The slots the pins left go, in order: to what the route cannot reach without them; then to
   * gifts whose pack the route would otherwise be forced to visit, so the run keeps more floors
   * free.
   *
   * The first is the search's own call (M87): when the plain search leaves something out, it runs
   * again with the free slots as one more source — a pack of its own per observable gift, at no
   * floor — and weighs every observation against every pack. Up to M84 the slots went to the
   * misses one by one, scarcest first, which the search never saw: it could miss three copies of
   * one fusion where three single gifts would have cost the same, and the slots saved none of
   * them. Observing whatever holds the floor a non-observable gift needs (the old swap) is one of
   * the plans this search weighs, and so is a required gift kept by observation rather than by
   * the optional goals its pack would push out (the old 「반드시」 fallback).
   */
  let search = runSearch();

  // Observation happens at run start, so once it is over nothing is observed: pins were settled above.
  // b) rescue: what the search had to leave out
  if (!startOver && search.unresolvedGiftIds.length > 0 && observed.length < budget) {
    const rescue = runSearch(budget - observed.length);
    // Judged the way the search judges its own plans: required goals lost before the rest. By the
    // bare count a rescue that kept the one 반드시 goal at the price of two 보통 ones lost (M160).
    const losses = (result: typeof search): [required: number, optional: number] => {
      const required = result.lostGoals.filter((goal) => requiredGoals.has(goal)).length;
      return [required, result.lostGoals.length - required];
    };
    const [rescueRequired, rescueOptional] = losses(rescue);
    const [plainRequired, plainOptional] = losses(search);
    if (
      rescueRequired < plainRequired ||
      (rescueRequired === plainRequired && rescueOptional <= plainOptional)
    ) {
      // An observation that takes over a copy the plain plan had a pack for frees that pack's
      // floor — the swap the player is told about.
      const kept = new Set(rescue.assignment.values());
      for (const key of rescue.observedKeys) {
        const requirement = requirements.find((r) => r.via === 'route' && requirementKey(r) === key)!;
        const floor = search.supplier.get(key);
        const was = floor === undefined ? undefined : search.assignment.get(floor);
        observe(requirement.giftId, false, was !== undefined && !kept.has(was) ? was : null, key);
      }
      search = rescue;
    }
  }

  // c) flexibility: free a forced pack whose only job is one observable gift. The start is open
  // only on floor 1, so no floor has been played and every assigned pack is the search's own.
  while (!startOver && observed.length < budget) {
    const forced = [...search.assignment.entries()]
      .filter(([, packId]) => !options.preferredPacks.includes(packId))
      .map(([floor, packId]) => {
        const pickups = requirements.filter(
          (r) => r.via === 'route' && search.supplier.get(requirementKey(r)) === floor,
        );
        return { floor, packId, pickups };
      })
      .filter(({ pickups }) => pickups.length === 1 && canObserve(pickups[0]!.giftId))
      .map((entry) => {
        const window = windowFor(
          entry.packId,
          entry.floor,
          floors,
          options,
          search.assignment,
          indexes,
          rewardPacks,
        );
        return {
          ...entry,
          width: window.to - window.from,
          giftId: entry.pickups[0]!.giftId,
          key: requirementKey(entry.pickups[0]!),
        };
      })
      .sort(
        (a, b) =>
          a.width - b.width ||
          scarcity(a.giftId, indexes) - scarcity(b.giftId, indexes) ||
          b.floor - a.floor ||
          a.giftId - b.giftId,
      );
    const pick = forced[0];
    if (!pick) break;
    observe(pick.giftId, false, pick.packId, pick.key);
    // Dropping a floor's only requirement lowers the optimum by exactly one pack, so the edited
    // assignment stays optimal without another search.
    search.assignment.delete(pick.floor);
    search.supplier.delete(pick.key);
  }

  const startObserved = [
    ...observed.filter((o) => o.pinned),
    ...observed.filter((o) => !o.pinned).sort((a, b) => a.giftId - b.giftId),
  ];
  const startStarlight =
    observed.length === 0 ? 0 : (data.rules.giftObservation.costTable[observed.length - 1] ?? 0);

  // What is still left to ordinary drops, now that observation and the start gift have had their say.
  const generalDrops = requirements.filter((r) => r.via === 'generalDrop').map((r) => r.giftId);

  // ---- 7. Fusions, and ingredients no longer worth routing for ------------
  const schedule = (): {
    /** Aligned with `expansion.fusions`. */
    fusions: FusionStep[];
    /** The floor by which the `j`-th ingredient of fusion entry `entry` is in hand; undefined when it never is. */
    floorOf: (entry: number, j: number) => number | undefined;
  } => {
    // Keyed by `requirementKey`: two fusions eating the same ingredient get one floor each.
    const obtainedAtFloor = new Map<string, number>();
    for (const requirement of requirements) {
      const key = requirementKey(requirement);
      if (
        requirement.via === 'startGift' ||
        requirement.via === 'observation' ||
        requirement.via === 'owned'
      ) {
        obtainedAtFloor.set(key, 0);
      } else if (requirement.via === 'generalDrop') {
        obtainedAtFloor.set(key, currentFloor);
      } else if (requirement.via === 'route') {
        const floor = search.supplier.get(key);
        if (floor !== undefined) obtainedAtFloor.set(key, floor);
      }
    }
    const fusions: FusionStep[] = [];
    // A fusion result is not a requirement of its own, so a parent recipe reads it from here — by
    // the entry that makes it (`instances[].made`): an intermediate fused twice has a floor each.
    const resultFloor = new Map<number, number>();
    const floorOf = (entry: number, j: number): number | undefined => {
      const fusion = expansion.fusions[entry]!;
      const { copy, made } = expansion.instances[entry]!;
      const maker = made[j];
      return maker === null || maker === undefined
        ? obtainedAtFloor.get(
            requirementKey({ giftId: fusion.ingredients[j]!, neededFor: fusion.result, copy }),
          )
        : resultFloor.get(maker);
    };
    expansion.fusions.forEach((fusion, entry) => {
      const floorsNeeded = fusion.ingredients.map((_, j) => floorOf(entry, j));
      const unreachable = floorsNeeded.some((floor) => floor === undefined);
      const earliestFloor = unreachable ? 0 : Math.max(...(floorsNeeded as number[]), currentFloor);
      fusions.push({
        result: fusion.result,
        ingredients: fusion.ingredients,
        earliestFloor,
        unreachable,
        exceedsShopSlots: fusion.ingredients.length > data.rules.fusion.maxShopSlots,
      });
      // A fusion result can itself be an ingredient, so it becomes available from that floor on.
      if (!unreachable) resultFloor.set(entry, earliestFloor);
    });
    return { fusions, floorOf };
  };
  let scheduled = schedule();

  /**
   * A fusion that can no longer happen (an ingredient failed, or its only floor has passed) still
   * has the plan chasing the other ingredients. When every wanted result it serves is a goal only
   * as a whole (`ingredientsAsGoals: false`), those pickups stop being goals: their floors go back
   * to the planner and the search runs once more. Nested fusions follow their parent.
   */
  const droppedFor = new Map<number, number[]>();
  {
    const wantedIds = new Set(input.wanted.map((w) => w.giftId));
    // Per fusion entry, the entries that eat it (M166: an intermediate fused twice has one each).
    const eaters: number[][] = expansion.fusions.map(() => []);
    expansion.instances.forEach(({ made }, entry) => {
      for (const maker of made) if (maker !== null) eaters[maker]!.push(entry);
    });
    // Every wanted result above the fusion is a goal only as a whole (`roots` is the goal unit).
    const wholeOnly = (result: number): boolean => {
      const goals = roots.ofGift(result);
      return goals.length > 0 && goals.every((id) => resultOnly.has(id));
    };
    const dropped = new Set<number>();
    for (let entry = scheduled.fusions.length - 1; entry >= 0; entry -= 1) {
      const fusion = scheduled.fusions[entry]!;
      if (!wholeOnly(fusion.result)) continue;
      const parentDropped = eaters[entry]!.some((eater) => dropped.has(eater));
      if (fusion.unreachable || (!wantedIds.has(fusion.result) && parentDropped)) dropped.add(entry);
    }
    for (const entry of dropped) {
      const { result } = expansion.fusions[entry]!;
      const { copy } = expansion.instances[entry]!;
      const ids: number[] = [];
      for (const requirement of requirements) {
        if (
          requirement.neededFor !== result ||
          (requirement.copy ?? 0) !== copy ||
          requirement.via !== 'route'
        )
          continue;
        if (search.unresolvedKeys.includes(requirementKey(requirement))) continue; // this one is what is missing
        const floor = search.supplier.get(requirementKey(requirement));
        if (floor !== undefined && passed.has(floor)) continue; // already picked up on a played floor
        requirement.via = 'dropped';
        ids.push(requirement.giftId);
      }
      if (ids.length > 0)
        droppedFor.set(
          result,
          [...new Set([...(droppedFor.get(result) ?? []), ...ids])].sort((a, b) => a - b),
        );
    }
    if (droppedFor.size > 0) {
      search = runSearch();
      scheduled = schedule();
    }
  }
  const { fusions, floorOf } = scheduled;

  // Copies of a goal the search itself gave up on (M87) were not chased: they are dropped like the
  // ingredients of any fusion that can no longer happen, so the fusion's entry says so.
  for (const key of search.abandonedKeys) {
    const requirement = requirements.find((r) => r.via === 'route' && requirementKey(r) === key);
    if (!requirement || requirement.neededFor === null) continue;
    requirement.via = 'dropped';
    droppedFor.set(
      requirement.neededFor,
      [...(droppedFor.get(requirement.neededFor) ?? []), requirement.giftId].sort((a, b) => a - b),
    );
  }

  const bannedPacks = new Set(options.bannedPacks);
  /** A copy the run will hold (`HELD_ROUTES`): the unit the two copy counts below share. */
  const held = (requirement: (typeof requirements)[number]): boolean =>
    HELD_ROUTES.has(requirement.via) &&
    (requirement.via !== 'route' || search.supplier.has(requirementKey(requirement)));
  const finalFloorKeys = new Set(search.finalFloorKeys);
  for (const [i, giftId] of search.unresolvedGiftIds.entries()) {
    const gift = indexes.giftById.get(giftId);
    const giftName = { ko: String(gift?.name.ko ?? giftId), en: String(gift?.name.en || giftId) };
    // A pack taken on a played floor cannot be entered again, so it is no source any more even
    // where its window still reaches a floor ahead.
    const packs = (indexes.packsByGift.get(giftId) ?? []).filter((packId) => !run.visited.has(packId));
    const offeredSomewhere = (packId: number): boolean =>
      floors.some((floor) =>
        (indexes.packsByFloor[modeForFloor(floor, options, indexes)].get(floor) ?? []).includes(packId),
      );
    const anySlot = packs.some((packId) => !bannedPacks.has(packId) && offeredSomewhere(packId));
    const onlyBanned = !anySlot && packs.length > 0 && packs.some(offeredSomewhere);
    /*
     * A second copy that no second source could cover. The gift itself is reachable — another
     * requirement for it did get a floor — so `pack-conflict` would send the reader hunting for a
     * floor clash that is not there. What is missing is the copy, not the pack. A copy the plan
     * dropped or gave up on is no such other copy: counting it said 「두 번째 몫」 of a gift the
     * run would not hold once, and hid the floor clash from the decision card (M160).
     */
    const otherCopyPlanned = requirements.some(
      (r) => r.giftId === giftId && requirementKey(r) !== search.unresolvedKeys[i] && held(r),
    );
    if (otherCopyPlanned) {
      // One name per eating result: an intermediate fused twice (M166) eats both copies itself.
      const eaters = [
        ...new Set(
          requirements.filter((r) => r.neededFor !== null && r.giftId === giftId).map((r) => r.neededFor!),
        ),
      ];
      const eaterName = (lang: 'ko' | 'en'): string[] =>
        eaters.map((result) => indexes.giftById.get(result)?.name[lang] || String(result));
      unresolved.push({
        giftId,
        reason: 'ingredient-shared',
        // The English used to be a fixed sentence with no names in it, so a reader in English was
        // told two fusions were fighting over something without being told which, or over what.
        detail: msg('unresolved.ingredientShared', {
          gift: giftName,
          eaters: { ko: eaterName('ko').join('·'), en: eaterName('en').join(' and ') },
        }),
      });
      continue;
    }
    // The pack is offered on a floor ahead — the last one, where its boss hands out no clear
    // reward. Neither a floor clash nor a missing pack; the run ends first.
    if (finalFloorKeys.has(search.unresolvedKeys[i]!)) {
      unresolved.push({
        giftId,
        reason: 'final-floor',
        detail: msg('unresolved.finalFloor', { gift: giftName, floor: indexes.finalFloor }),
      });
      continue;
    }
    unresolved.push({
      giftId,
      reason: anySlot ? 'pack-conflict' : onlyBanned ? 'pack-banned' : 'no-pack-in-range',
      detail: anySlot
        ? msg('unresolved.packConflict')
        : onlyBanned
          ? msg('unresolved.packBanned')
          : msg(midRun ? 'unresolved.noPackAhead' : 'unresolved.noPackInRange', { gift: giftName }),
    });
  }
  /*
   * Two fusions eating one ingredient are planned with a copy each, from different packs (or one
   * from 기프트 관측). The game will not offer a gift you are already holding, though, so the order
   * matters in a way no plan can check: fuse the first, which consumes it, and only then does the
   * second copy come back into the pool. Say so rather than let the route look unconditional.
   */
  {
    const copies = new Map<number, number>();
    for (const requirement of requirements) {
      if (!held(requirement)) continue;
      copies.set(requirement.giftId, (copies.get(requirement.giftId) ?? 0) + 1);
    }
    const shared = [...copies]
      .filter(([, n]) => n > 1)
      .map(([giftId]) => giftId)
      .sort((a, b) => a - b);
    if (shared.length > 0) {
      warnings.push({
        code: 'shared-ingredient',
        giftIds: shared,
        detail: msg('warn.sharedIngredient', {
          gifts: shared.map((id) => indexes.giftById.get(id)?.name.ko ?? String(id)).join('·'),
        }),
      });
    }
  }

  if (search.unplacedPacks.length > 0) {
    warnings.push({
      code: 'pack-option-dropped',
      packIds: search.unplacedPacks,
      detail: msg('warn.packOptionUnplaced'),
    });
  }

  // ---- 8. Build the floor plan -------------------------------------------
  const pickupsByFloor = new Map<number, FloorPlan['pickups']>();
  for (const requirement of requirements) {
    if (requirement.via !== 'route') continue;
    const floor = search.supplier.get(requirementKey(requirement));
    if (floor === undefined) continue;
    const packId = search.assignment.get(floor);
    const pack = packId !== undefined ? indexes.packById.get(packId) : undefined;
    const list = pickupsByFloor.get(floor) ?? [];
    list.push({
      giftId: requirement.giftId,
      kind:
        pack?.exclusiveGifts.includes(requirement.giftId) ||
        indexes.giftById.get(requirement.giftId)?.acquisition.clearRewardOf === packId
          ? 'exclusive'
          : 'pool',
      neededFor: requirement.neededFor,
    });
    pickupsByFloor.set(floor, list);
  }

  const forcedFloors = [...search.assignment.keys()]
    .filter((floor) => floor >= currentFloor)
    .sort((a, b) => a - b);
  let observationIndex = 0;

  const floorPlans: FloorPlan[] = rows.map((floor): FloorPlan => {
    const mode = modeForFloor(floor, options, indexes);
    const isPassed = floor < currentFloor;
    const packId = isPassed ? (passed.get(floor) ?? null) : (search.assignment.get(floor) ?? null);
    // Only a played floor's pack is settled (M118); every pack ahead is the search's choice.
    const pinned = packId !== null && isPassed;
    const pickups = (pickupsByFloor.get(floor) ?? []).sort((a, b) => a.giftId - b.giftId);

    const needsObservation = packId !== null && !pinned;
    const canObserve = mode !== 'extreme' || data.rules.difficulty.extremeAllowsObservation;
    const starlight =
      needsObservation && canObserve
        ? observationCost(observationIndex + 1, data.rules, options.assumeUnvisitedPacks) -
          observationCost(observationIndex, data.rules, options.assumeUnvisitedPacks)
        : 0;
    if (needsObservation && canObserve) observationIndex += 1;

    // Packs on this floor that could have supplied the same pickups.
    const alternatives =
      !isPassed && packId !== null
        ? alternativePacksOn(
            floor,
            mode,
            pickups.map((p) => p.giftId),
            indexes,
            { exclude: packId, banned: bannedPacks },
          )
        : [];

    const window =
      packId === null
        ? null
        : pinned
          ? { from: floor, to: floor }
          : windowFor(packId, floor, floors, options, search.assignment, indexes, rewardPacks);

    return {
      floor,
      mode,
      packId,
      reason: packId === null ? 'free' : pinned ? 'pinned' : 'required',
      passed: isPassed,
      pickups,
      observation: { needed: needsObservation, possible: canObserve, starlight },
      alternatives,
      window,
    };
  });

  // ---- 9. Fusions that cannot happen ----------------------------------------
  // Named like `ingredient-shared`: a reader sees gifts, not ids.
  const giftNames = (ids: number[]): { ko: string; en: string } => {
    const name = (id: number, lang: 'ko' | 'en'): string =>
      indexes.giftById.get(id)?.name[lang] || String(id);
    return { ko: ids.map((id) => name(id, 'ko')).join('·'), en: ids.map((id) => name(id, 'en')).join(', ') };
  };
  fusions.forEach((fusion, entry) => {
    if (!fusion.unreachable) return;
    const droppedIngredients = droppedFor.get(fusion.result);
    const missing = fusion.ingredients.filter(
      (id, j) => floorOf(entry, j) === undefined && !droppedIngredients?.includes(id),
    );
    unresolved.push({
      giftId: fusion.result,
      reason: 'fusion-ingredient-unresolved',
      missing,
      ...(droppedIngredients ? { droppedIngredients } : {}),
      detail: droppedIngredients
        ? msg('unresolved.fusionMissingDropped', {
            missing: giftNames(missing),
            dropped: giftNames(droppedIngredients),
          })
        : msg('unresolved.fusionMissing', { missing: giftNames(missing) }),
    });
  });

  // ---- 10. Warnings -------------------------------------------------------
  const conditions = evaluateConditions(
    input.wanted.map((w) => w.giftId),
    stats,
    indexes,
  );

  // Only real gates can go unmet; a count with no threshold has nothing to fail.
  // A condition the deck list cannot judge (full resonance: `have` is null) is unknown, not unmet.
  const unmet = conditions.filter((c) => c.gate && c.have !== null && !c.satisfied);
  if (unmet.length > 0) {
    warnings.push({
      code: 'condition-unmet',
      giftIds: [...new Set(unmet.map((c) => c.giftId))].sort((a, b) => a - b),
      detail: msg('warn.conditionUnmet', { count: new Set(unmet.map((c) => c.giftId)).size }),
    });
  }

  if (generalDrops.length > 0) {
    warnings.push({
      code: 'general-drop-not-guaranteed',
      giftIds: [...new Set(generalDrops)].sort((a, b) => a - b),
      detail: msg('warn.generalDropNotGuaranteed'),
    });
  }

  const slotHeavy = fusions.filter((f) => f.exceedsShopSlots);
  if (slotHeavy.length > 0) {
    warnings.push({
      code: 'fusion-slots',
      giftIds: slotHeavy.map((f) => f.result),
      detail: msg('warn.fusionSlots', { max: data.rules.fusion.maxShopSlots }),
    });
  }

  if (startObserved.length > 0 && !data.rules.giftObservation.verified) {
    warnings.push({
      code: 'gift-observation-unverified',
      detail: msg('warn.giftObservationUnverified'),
    });
  }

  if (search.capped) {
    warnings.push({
      code: 'search-capped',
      detail: msg('warn.searchCapped'),
    });
  }

  if (!planIsHard) {
    // Hard would help only where the plan came up short: a routed gift the search could not place
    // whose every pack (bans aside) opens on Hard floors alone. A gift that has a Normal pack too
    // — routed or not — is no reason to switch (M160: 41 gifts in MD8 were warned about on a plan
    // that had placed them).
    const hardOnly = (packId: number): boolean => {
      const pack = indexes.packById.get(packId);
      return pack !== undefined && pack.availability.normal.length === 0 && pack.availability.hard.length > 0;
    };
    const hardLocked = [...new Set(search.unresolvedGiftIds)].some((giftId) => {
      const packs = (indexes.packsByGift.get(giftId) ?? []).filter((packId) => !bannedPacks.has(packId));
      return packs.length > 0 && packs.every(hardOnly);
    });
    if (hardLocked) {
      warnings.push({
        code: 'hard-required',
        detail: msg('warn.hardRequired'),
      });
    }
  }

  // ---- 11. Assemble ------------------------------------------------------
  const unresolvedIds = new Set(unresolved.map((u) => u.giftId));
  const coveredWanted = input.wanted.filter((w) => !unresolvedIds.has(w.giftId)).length;

  const starlight = startStarlight + floorPlans.reduce((sum, plan) => sum + plan.observation.starlight, 0);

  return {
    start: {
      keyword: start.keyword,
      startGifts: start.startGifts,
      autoKeyword: start.auto.keyword,
      autoStartGifts: start.auto.startGifts,
      observed: startObserved,
      starlight: startStarlight,
      starlightVerified: data.rules.giftObservation.verified,
    },
    floors: floorPlans,
    fusions,
    generalDrops: [...new Set(generalDrops)].sort((a, b) => a - b),
    conditions,
    unresolved: dedupeUnresolved(unresolved),
    warnings,
    stats: {
      requiredPacks: forcedFloors.length,
      starlight,
      coveredWanted,
      totalWanted: input.wanted.length,
      searchNodes: search.nodes,
      searchCapped: search.capped,
      searchTieCut: search.tieBreakCut,
      // Core keeps no clock (M160): the worker and the CLI measure the call and fill this in.
      elapsedMs: 0,
    },
  };
}

function dedupeUnresolved(entries: Unresolved[]): Unresolved[] {
  const seen = new Set<string>();
  const out: Unresolved[] = [];
  for (const entry of entries) {
    const key = `${entry.giftId}:${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  // The reasons are ASCII, so a plain comparison orders them the same on every runtime.
  return out.sort((a, b) => a.giftId - b.giftId || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}
