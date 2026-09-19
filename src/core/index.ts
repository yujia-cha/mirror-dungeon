/**
 * The route planner.
 *
 * Pure TypeScript: no React, no DOM, no network. It runs in the browser, in Vitest and in
 * scripts/route-cli.ts, and the same input always produces the same output.
 */
import type { Difficulty, GameData } from './schema.ts';
import type {
  FloorPlan,
  FusionStep,
  GameIndexes,
  ObservedGift,
  PlanInput,
  PlanOptions,
  PlanWarning,
  Requirement,
  RequirementRoute,
  RoutePlan,
  Unresolved,
} from './types.ts';
import { analyseDeck, evaluateConditions } from './deck.ts';
import { expandRequirements, scarcity } from './requirements.ts';
import { assignPacks, modeForFloor, observationCost, type SearchResult } from './search.ts';
import { requirementKey } from './requirements.ts';
import { chooseStart, observable } from './starting.ts';
import { josa } from './text.ts';

export { planAlternatives } from './alternatives.ts';
export type { RouteVariant, AlternativeOptions } from './alternatives.ts';
export { conflictGroups, wantedRoots } from './conflicts.ts';
export type { ConflictGroup, ConflictCandidate } from './conflicts.ts';
export { buildIndexes } from './data/indexes.ts';
export { analyseDeck, dominantKeyword, evaluateConditions } from './deck.ts';
export { chooseRecipe, expandRequirements, scarcity } from './requirements.ts';
export { assignPacks, modeForFloor, observationCost } from './search.ts';
export { chooseStart, observable } from './starting.ts';
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
 * Planning past floor 5 requires 평행중첩, which in turn requires floors 1-5 cleared on Hard.
 * Rather than produce an impossible plan, the options are corrected and the change is reported.
 */
function normaliseOptions(
  options: PlanOptions,
  data: GameData,
  indexes: GameIndexes,
  deck: number[],
): { options: PlanOptions; warnings: PlanWarning[]; droppedObservations: number[] } {
  const warnings: PlanWarning[] = [];
  let next = { ...options };

  // Pinned observations: known, observable, unique, and within the slot limit. The ones dropped
  // here join the pins the plan itself cannot use in a single warning (see planRoute).
  const observedGifts = [...new Set(next.observedGifts ?? [])].filter((id) => {
    const gift = indexes.giftById.get(id);
    return gift !== undefined && observable(gift, data.rules);
  });
  const kept = observedGifts.slice(0, data.rules.giftObservation.max);
  const droppedObservations = (next.observedGifts ?? []).filter((id) => !kept.includes(id));
  next = { ...next, observedGifts: kept };

  const maxFloor = Math.max(...data.rules.floors.normal, ...data.rules.floors.parallel, ...data.rules.floors.extreme);
  const lastFloor = Math.min(maxFloor, Math.max(1, Math.round(next.lastFloor)));
  if (lastFloor !== next.lastFloor) next = { ...next, lastFloor };

  // Run progress: the floor about to be entered stays within the plan, and a gift is either in
  // hand or missed, never both (in hand wins).
  const currentFloor = Number.isFinite(next.currentFloor) ? Math.min(lastFloor, Math.max(1, Math.round(next.currentFloor as number))) : 1;
  const knownGift = (id: unknown): id is number => typeof id === 'number' && indexes.giftById.has(id);
  const ownedGifts = [...new Set((next.ownedGifts ?? []).filter(knownGift))];
  const unobtainableGifts = [...new Set((next.unobtainableGifts ?? []).filter(knownGift))].filter((id) => !ownedGifts.includes(id));
  next = { ...next, currentFloor, ownedGifts, unobtainableGifts };

  if (next.deployed) {
    const inDeck = new Set(deck);
    const deployed = [...new Set(next.deployed)].filter((id) => inDeck.has(id)).slice(0, data.rules.deployment.max);
    next = { ...next, deployed };
  }

  // Pack choices: known packs only, no contradiction between a ban and a preference, and a pin
  // only on a floor that actually offers the pack in that floor's mode.
  const known = (id: unknown): id is number => typeof id === 'number' && indexes.packById.has(id);
  const bannedPacks = [...new Set((next.bannedPacks ?? []).filter(known))];
  const bannedSet = new Set(bannedPacks);
  const preferredPacks = [...new Set((next.preferredPacks ?? []).filter(known))].filter((id) => !bannedSet.has(id));
  const pinnedPacks: Record<number, number> = {};
  const dropped: number[] = [];
  for (const [floorText, packId] of Object.entries(next.pinnedPacks ?? {})) {
    const floor = Number(floorText);
    const offered = Number.isInteger(floor) && floor >= 1 && floor <= lastFloor
      ? (indexes.packsByFloor[modeForFloor(floor, { ...next, lastFloor }, indexes)].get(floor) ?? [])
      : [];
    if (known(packId) && offered.includes(packId) && !bannedSet.has(packId)) pinnedPacks[floor] = packId;
    else if (typeof packId === 'number') dropped.push(packId);
  }
  const preferredDropped = (next.preferredPacks ?? []).filter((id) => !preferredPacks.includes(id));
  const bannedDropped = (next.bannedPacks ?? []).filter((id) => !bannedPacks.includes(id));
  const droppedAll = [...new Set([...dropped, ...preferredDropped, ...bannedDropped])];
  if (droppedAll.length > 0) {
    warnings.push({
      code: 'pack-option-dropped',
      packIds: droppedAll,
      detail: {
        ko: '알 수 없거나 그 층에 나오지 않거나 서로 모순되는 팩 지정은 제외했습니다.',
        en: 'Pack choices that are unknown, not offered on that floor, or contradictory were dropped.',
      },
    });
  }
  next = { ...next, bannedPacks, preferredPacks, pinnedPacks };

  if (next.lastFloor > 5 && data.rules.difficulty.parallelRequiresAllHard && next.hardFromFloor !== 1) {
    next = { ...next, hardFromFloor: 1 };
    warnings.push({
      code: 'parallel-requires-hard',
      detail: {
        ko: '평행중첩(6층 이상)은 1~5층을 전부 Hard로 클리어해야 들어갈 수 있어, 1층부터 Hard로 계획했습니다.',
        en: 'Floors 6+ need floors 1-5 cleared on Hard, so the plan switches to Hard from floor 1.',
      },
    });
  }

  return { options: next, warnings, droppedObservations };
}

/**
 * The contiguous run of floors around `floor` on which `packId` could equally have been placed:
 * same mode, offered on that floor, and not already taken by another required or pinned pack.
 * This is what lets the UI say "any one of floors 4-5" instead of pinning a floor the search
 * merely happened to pick first.
 */
function windowFor(
  packId: number,
  floor: number,
  mode: Difficulty,
  floors: number[],
  options: PlanOptions,
  assignment: Map<number, number>,
  indexes: GameIndexes,
): { from: number; to: number } {
  // Floors a pack could be visited on, in this plan: same run mode as the assigned floor (so a
  // Hard-only pack never wanders into Normal floors), offered there, and not pinned to another.
  const candidates = (id: number, own: number): number[] =>
    floors.filter((g) => {
      if (modeForFloor(g, options, indexes) !== modeForFloor(own, options, indexes)) return false;
      if (!(indexes.packsByFloor[modeForFloor(g, options, indexes)].get(g) ?? []).includes(id)) return false;
      const pinnedHere = options.pinnedPacks[g];
      return pinnedHere === undefined || pinnedHere === id;
    });
  // Played floors are settled and never move, so only packs still on plannable floors compete.
  const others = [...assignment.entries()].filter(([own, id]) => id !== packId && floors.includes(own));
  const otherCandidates = others.map(([own, id]) => candidates(id, own));

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

  const possible = new Set(candidates(packId, floor).filter((g) => g === floor || fits(g)));
  let from = floor;
  while (possible.has(from - 1)) from -= 1;
  let to = floor;
  while (possible.has(to + 1)) to += 1;
  void mode;
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

export function planRoute(input: PlanInput, data: GameData, indexes: GameIndexes): RoutePlan {
  const startedAt = Date.now();
  const { options, warnings, droppedObservations } = normaliseOptions(input.options, data, indexes, input.deck);
  const { rows, plannable: floors } = floorsFor(options, data);
  const currentFloor = options.currentFloor ?? 1;
  const midRun = currentFloor > 1;
  // Played floors: the pack taken there is settled and its gifts count as picked up there.
  const passed = new Map<number, number>();
  for (const floor of rows) {
    if (floor >= currentFloor) break;
    const packId = options.pinnedPacks[floor];
    if (packId !== undefined) passed.set(floor, packId);
  }
  const run = { owned: new Set(options.ownedGifts ?? []), failed: new Set(options.unobtainableGifts ?? []) };

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
        detail: {
          ko: '이번 시즌에 획득할 수 없는 기프트입니다.',
          en: 'Not obtainable in the current season.',
        },
      });
      continue;
    }
    if (gift.acquisition.kind === 'hiddenBattle') {
      // A random extra battle on EXTREME floors drops it; no pack choice makes that certain.
      const hidden = data.rules.hiddenBattle;
      const floorsText = hidden && hidden.floors.length > 0 ? `${hidden.floors[0]}~${hidden.floors[hidden.floors.length - 1]}` : '11~15';
      const pct = hidden?.probabilityPerFloor !== null && hidden?.probabilityPerFloor !== undefined ? Math.round(hidden.probabilityPerFloor * 100) : null;
      requirement.via = 'unresolved';
      unresolved.push({
        giftId: requirement.giftId,
        reason: 'chance-only',
        detail: {
          ko: `${floorsText}층 히든 전투 보상${pct !== null ? `(층당 ${pct}%)` : ''}으로만 나오는 기프트입니다. 루트로 확정할 수 없습니다.`,
          en: `Only a random hidden-battle reward on floors ${floorsText.replace('~', '-')}${pct !== null ? ` (${pct}% per floor)` : ''}; no route can guarantee it.`,
        },
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
        detail: {
          ko: 'Hard 난이도에서만 얻을 수 있는 기프트입니다. 난이도를 Hard로 바꾸세요.',
          en: 'Obtainable on Hard difficulty only. Switch the plan to Hard.',
        },
      });
      requirement.via = 'unresolved';
    }
  }

  // ---- 4. Pinned observations ---------------------------------------------
  // 기프트 관측 hands over up to `budget` gifts at run start. The user's pins are the one explicit
  // decision in this stage, so they go first — before the free starting gift and before the
  // planner's own recommendations — and they apply to any planned gift not yet in hand: one the
  // route would visit a pack for, or a general drop that observation turns into a certainty.
  const budget = data.rules.giftObservation.max;
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

  // A pin on a gift already in hand, or one the plan already gave up on, is skipped without a
  // word: the run made it moot (the app keeps pins after floor 1, when they are owned) or the
  // unresolved list already explains it. Only a pin on a gift that is no goal at all is reported.
  const notPlanned: number[] = [];
  for (const giftId of options.observedGifts) {
    if (observed.length >= budget) break;
    if (plannable(giftId) && canObserve(giftId)) observe(giftId, true, null);
    else if (!known(giftId)) notPlanned.push(giftId);
  }
  const trimmed = [...new Set([...droppedObservations, ...notPlanned])];
  if (trimmed.length > 0) {
    warnings.push({
      code: 'observation-trimmed',
      giftIds: trimmed,
      detail: {
        ko: `관측으로 지정한 기프트 중 관측할 수 없거나, 한도(${budget}개)를 넘거나, 이번 계획의 목표가 아닌 것은 제외했습니다.`,
        en: `Some pinned observations were dropped: not observable, over the ${budget}-slot limit, or not a goal of this plan.`,
      },
    });
  }

  // ---- 5. The free starting-keyword gift ----------------------------------
  // Mid-run the start was chosen long ago (whatever it gave is in hand), so only the keyword stands.
  // A general drop in the pool is worth taking here too: free, and certain instead of likely.
  const start = chooseStart(
    midRun ? [] : requirements.filter((r) => r.via === 'route' || r.via === 'generalDrop'),
    indexes,
    data.rules,
    stats,
    options.startKeyword,
  );
  // One gift, so one copy: a second requirement for it still has to be routed.
  const startTarget = requirements.find(
    (r) => r.giftId === start.startGift && (r.via === 'route' || r.via === 'generalDrop'),
  );
  if (startTarget) startTarget.via = 'startGift';

  // ---- 6. Recommended observations and the pack search -------------------
  const runSearch = (ignorePriority: boolean) =>
    assignPacks({
      requirements: requirements
        .filter((r) => r.via === 'route')
        .map((r) => (ignorePriority && r.required ? { ...r, required: false } : r)),
      floors,
      options,
      rules: data.rules,
      indexes,
      passed,
    });

  /**
   * 「반드시」 must never cost coverage.
   *
   * The search ranks required misses above every other term, so one required gift can drag the plan
   * into sacrificing several optional ones — even when the rescue below was going to hand that gift
   * over through an observation slot anyway. So whenever the priority-aware plan leaves something
   * out, plan again with every goal equal and take that instead if it covers more AND every
   * required gift it drops fits in the free slots. Priority still decides the genuine conflicts:
   * when no slot can save the required gift, the priority-aware plan stands.
   */
  const searchWithFallback = (): SearchResult => {
    const primary = runSearch(false);
    if (midRun || primary.unresolvedGiftIds.length === 0) return primary;
    if (!requirements.some((r) => r.via === 'route' && r.required)) return primary;
    const blind = runSearch(true);
    if (blind.unresolvedGiftIds.length >= primary.unresolvedGiftIds.length) return primary;
    const dropped = blind.unresolvedGiftIds.filter((id) =>
      requirements.some((r) => r.giftId === id && r.required),
    );
    if (dropped.length > budget - observed.length || !dropped.every(canObserve)) return primary;
    return blind;
  };

  /**
   * The slots the pins left go, in order: to gifts the route cannot reach (directly, or by
   * observing whatever occupies the floor they need); then to gifts whose pack the route would
   * otherwise be forced to visit, so the run keeps more floors free. The search runs at most twice.
   */
  let search = searchWithFallback();

  // Observation happens at run start, so mid-run only the pins the player reports still apply.
  // b) rescue: what the search had to leave out
  if (!midRun && search.unresolvedGiftIds.length > 0 && observed.length < budget) {
    // Required gifts are rescued first; among equals the scarcer one, then the lower id.
    const isRequired = (giftId: number): number => (requirements.some((r) => r.giftId === giftId && r.required) ? 1 : 0);
    const missed = search.unresolvedKeys
      .map((key, i) => ({ key, giftId: search.unresolvedGiftIds[i]! }))
      .sort(
        (a, b) =>
          isRequired(b.giftId) - isRequired(a.giftId) ||
          scarcity(a.giftId, indexes) - scarcity(b.giftId, indexes) ||
          a.giftId - b.giftId ||
          a.key.localeCompare(b.key, 'en'),
      );
    let changed = false;
    for (const { key, giftId } of missed) {
      if (observed.length >= budget) break;
      if (canObserve(giftId)) {
        observe(giftId, false, null, key);
        changed = true;
        continue;
      }
      // Not observable itself: observe the sole occupant of a floor its pack could use instead.
      const swap = soleOccupantToFree(giftId, search, requirements, floors, options, indexes, canObserve);
      if (swap) {
        observe(swap.giftId, false, swap.packId, swap.key);
        changed = true;
      }
    }
    if (changed) search = searchWithFallback();
  }

  // c) flexibility: free a forced pack whose only job is one observable gift
  while (!midRun && observed.length < budget) {
    const forced = [...search.assignment.entries()]
      .filter(([floor, packId]) => options.pinnedPacks[floor] === undefined && !options.preferredPacks.includes(packId))
      .map(([floor, packId]) => {
        const pickups = requirements.filter((r) => r.via === 'route' && search.supplier.get(requirementKey(r)) === floor);
        return { floor, packId, pickups };
      })
      .filter(({ pickups }) => pickups.length === 1 && canObserve(pickups[0]!.giftId))
      .map((entry) => {
        const window = windowFor(entry.packId, entry.floor, modeForFloor(entry.floor, options, indexes), floors, options, search.assignment, indexes);
        return { ...entry, width: window.to - window.from, giftId: entry.pickups[0]!.giftId, key: requirementKey(entry.pickups[0]!) };
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
  const startStarlight = observed.length === 0 ? 0 : (data.rules.giftObservation.costTable[observed.length - 1] ?? 0);

  // What is still left to ordinary drops, now that observation and the start gift have had their say.
  const generalDrops = requirements.filter((r) => r.via === 'generalDrop').map((r) => r.giftId);

  // ---- 7. Fusions, and ingredients no longer worth routing for ------------
  const schedule = (): { fusions: FusionStep[]; obtainedAtFloor: Map<string, number>; resultFloor: Map<number, number> } => {
    // Keyed by `requirementKey`: two fusions eating the same ingredient get one floor each.
    const obtainedAtFloor = new Map<string, number>();
    for (const requirement of requirements) {
      const key = requirementKey(requirement);
      if (requirement.via === 'startGift' || requirement.via === 'observation' || requirement.via === 'owned') {
        obtainedAtFloor.set(key, 0);
      } else if (requirement.via === 'generalDrop') {
        obtainedAtFloor.set(key, currentFloor);
      } else if (requirement.via === 'route') {
        const floor = search.supplier.get(key);
        if (floor !== undefined) obtainedAtFloor.set(key, floor);
      }
    }
    const fusions: FusionStep[] = [];
    // A fusion result is not a requirement of its own, so a parent recipe reads it from here.
    const resultFloor = new Map<number, number>();
    const floorOf = (ingredient: number, result: number): number | undefined =>
      obtainedAtFloor.get(requirementKey({ giftId: ingredient, neededFor: result })) ?? resultFloor.get(ingredient);
    for (const fusion of expansion.fusions) {
      const floorsNeeded = fusion.ingredients.map((id) => floorOf(id, fusion.result));
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
      if (!unreachable) resultFloor.set(fusion.result, earliestFloor);
    }
    return { fusions, obtainedAtFloor, resultFloor };
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
    const wantedById = new Map(input.wanted.map((w) => [w.giftId, w]));
    const parents = new Map<number, number[]>();
    for (const fusion of expansion.fusions) {
      for (const id of fusion.ingredients) parents.set(id, [...(parents.get(id) ?? []), fusion.result]);
    }
    const rootsOf = (result: number, seen = new Set<number>()): number[] => {
      const out: number[] = wantedById.has(result) ? [result] : [];
      if (seen.has(result)) return out;
      seen.add(result);
      for (const parent of parents.get(result) ?? []) out.push(...rootsOf(parent, seen));
      return out;
    };
    const resultOnly = (result: number): boolean => {
      const roots = rootsOf(result);
      return roots.length > 0 && roots.every((id) => wantedById.get(id)?.ingredientsAsGoals === false);
    };
    const dropped = new Set<number>();
    for (const fusion of [...scheduled.fusions].reverse()) {
      if (!resultOnly(fusion.result)) continue;
      const parentDropped = (parents.get(fusion.result) ?? []).some((id) => dropped.has(id));
      if (fusion.unreachable || (!wantedById.has(fusion.result) && parentDropped)) dropped.add(fusion.result);
    }
    for (const result of dropped) {
      const ids: number[] = [];
      for (const requirement of requirements) {
        if (requirement.neededFor !== result || requirement.via !== 'route') continue;
        if (search.unresolvedKeys.includes(requirementKey(requirement))) continue; // this one is what is missing
        const floor = search.supplier.get(requirementKey(requirement));
        if (floor !== undefined && passed.has(floor)) continue; // already picked up on a played floor
        requirement.via = 'dropped';
        ids.push(requirement.giftId);
      }
      if (ids.length > 0) droppedFor.set(result, ids.sort((a, b) => a - b));
    }
    if (droppedFor.size > 0) {
      search = searchWithFallback();
      scheduled = schedule();
    }
  }
  const { fusions, obtainedAtFloor, resultFloor } = scheduled;

  const bannedPacks = new Set(options.bannedPacks);
  for (const [i, giftId] of search.unresolvedGiftIds.entries()) {
    const gift = indexes.giftById.get(giftId);
    const packs = indexes.packsByGift.get(giftId) ?? [];
    const offeredSomewhere = (packId: number): boolean =>
      floors.some((floor) => (indexes.packsByFloor[modeForFloor(floor, options, indexes)].get(floor) ?? []).includes(packId));
    const anySlot = packs.some((packId) => !bannedPacks.has(packId) && offeredSomewhere(packId));
    const onlyBanned = !anySlot && packs.length > 0 && packs.some(offeredSomewhere);
    /*
     * A second copy that no second source could cover. The gift itself is reachable — another
     * requirement for it did get a floor — so `pack-conflict` would send the reader hunting for a
     * floor clash that is not there. What is missing is the copy, not the pack.
     */
    const otherCopyPlanned = requirements.some(
      (r) =>
        r.giftId === giftId &&
        requirementKey(r) !== search.unresolvedKeys[i] &&
        (r.via !== 'route' || search.supplier.has(requirementKey(r))),
    );
    if (otherCopyPlanned) {
      const eaters = requirements
        .filter((r) => r.giftId === giftId && r.neededFor !== null)
        .map((r) => indexes.giftById.get(r.neededFor!)?.name.ko ?? String(r.neededFor));
      unresolved.push({
        giftId,
        reason: 'ingredient-shared',
        detail: {
          ko: `${josa(String(gift?.name.ko ?? giftId), '은/는')} 한 런에서 한 번만 얻을 수 있는데 ${josa(eaters.join('·'), '이/가')} 함께 먹습니다. 두 번째 몫을 줄 팩이 더 없습니다.`,
          en: 'Two fusions eat this ingredient, and no second pack can supply the second copy.',
        },
      });
      continue;
    }
    unresolved.push({
      giftId,
      reason: anySlot ? 'pack-conflict' : onlyBanned ? 'pack-banned' : 'no-pack-in-range',
      detail: anySlot
        ? {
            ko: '다른 전용 기프트와 층이 겹쳐 한 런에 같이 넣을 수 없습니다.',
            en: 'Its pack competes for the same floor as another wanted exclusive.',
          }
        : onlyBanned
          ? {
              ko: '이 기프트를 주는 팩을 모두 포기했습니다.',
              en: 'Every pack that supplies it has been given up.',
            }
          : midRun
            ? {
                ko: `${josa(String(gift?.name.ko ?? giftId), '을/를')} 주는 팩이 남은 층에 없습니다.`,
                en: 'No pack that supplies it appears on the floors still ahead.',
              }
            : {
                ko: `${josa(String(gift?.name.ko ?? giftId), '을/를')} 주는 팩이 계획한 층 범위에 없습니다.`,
                en: 'No pack that supplies it appears within the planned floors.',
              },
    });
  }
  /*
   * Two fusions eating one ingredient are planned with a copy each, from different packs (or one
   * from 기프트 관측). The game will not offer a gift you are already holding, though, so the order
   * matters in a way no plan can check: fuse the first, which consumes it, and only then does the
   * second copy come back into the pool. Say so rather than let the route look unconditional.
   */
  {
    const planned = new Set<RequirementRoute>(['route', 'observation', 'startGift', 'generalDrop', 'owned']);
    const copies = new Map<number, number>();
    for (const requirement of requirements) {
      if (!planned.has(requirement.via)) continue;
      // A routed copy the search could not place is not a copy the run will hold.
      if (requirement.via === 'route' && !search.supplier.has(requirementKey(requirement))) continue;
      copies.set(requirement.giftId, (copies.get(requirement.giftId) ?? 0) + 1);
    }
    const shared = [...copies].filter(([, n]) => n > 1).map(([giftId]) => giftId).sort((a, b) => a - b);
    if (shared.length > 0) {
      warnings.push({
        code: 'shared-ingredient',
        giftIds: shared,
        detail: {
          ko: `${josa(shared.map((id) => indexes.giftById.get(id)?.name.ko ?? String(id)).join('·'), '은/는')} 두 조합이 함께 먹습니다. 같은 기프트는 한 번에 하나만 가질 수 있으니, 먼저 조합해 소모한 뒤에야 두 번째 것이 다시 나옵니다.`,
          en: 'Two fusions eat the same ingredient. A gift you hold is never offered again, so the first fusion has to happen before the second copy can drop.',
        },
      });
    }
  }

  if (search.unplacedPacks.length > 0) {
    warnings.push({
      code: 'pack-option-dropped',
      packIds: search.unplacedPacks,
      detail: {
        ko: '포함하기로 한 팩 중 남은 층에 넣을 수 없는 것이 있습니다.',
        en: 'Some packs you chose to include have no floor left in the plan.',
      },
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

  const forcedFloors = [...search.assignment.keys()].filter((floor) => floor >= currentFloor).sort((a, b) => a - b);
  let observationIndex = 0;

  const floorPlans: FloorPlan[] = rows.map((floor): FloorPlan => {
    const mode = modeForFloor(floor, options, indexes);
    const isPassed = floor < currentFloor;
    const packId = isPassed ? (passed.get(floor) ?? null) : (search.assignment.get(floor) ?? null);
    const pinned = packId !== null && (isPassed || options.pinnedPacks[floor] === packId);
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
      pickups.length > 0 && !isPassed
        ? (indexes.packsByFloor[mode].get(floor) ?? [])
            .filter((candidate) => candidate !== packId && !bannedPacks.has(candidate))
            .filter((candidate) => {
              const pack = indexes.packById.get(candidate);
              return pack ? pickups.every((p) => pack.giftPool.includes(p.giftId)) : false;
            })
        : [];

    const window =
      packId === null
        ? null
        : pinned
          ? { from: floor, to: floor }
          : windowFor(packId, floor, mode, floors, options, search.assignment, indexes);

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
  for (const fusion of fusions) {
    if (!fusion.unreachable) continue;
    const droppedIngredients = droppedFor.get(fusion.result);
    const missing = fusion.ingredients.filter(
      (id) =>
        !obtainedAtFloor.has(requirementKey({ giftId: id, neededFor: fusion.result })) &&
        !resultFloor.has(id) &&
        !droppedIngredients?.includes(id),
    );
    unresolved.push({
      giftId: fusion.result,
      reason: 'fusion-ingredient-unresolved',
      missing,
      ...(droppedIngredients ? { droppedIngredients } : {}),
      detail: droppedIngredients
        ? {
            ko: `재료 ${missing.join(', ')}을(를) 구할 수 없어 조합할 수 없습니다. 나머지 재료(${droppedIngredients.join(', ')})만을 위한 방문은 취소했습니다.`,
            en: `Cannot be fused: ingredients ${missing.join(', ')} are not obtainable. Visits for the remaining ingredients (${droppedIngredients.join(', ')}) alone were dropped.`,
          }
        : {
            ko: `재료 ${missing.join(', ')}을(를) 구할 수 없어 조합할 수 없습니다.`,
            en: `Cannot be fused: ingredients ${missing.join(', ')} are not obtainable in this plan.`,
          },
    });
  }

  // ---- 10. Warnings -------------------------------------------------------
  const conditions = evaluateConditions(
    input.wanted.map((w) => w.giftId),
    stats,
    indexes,
  );

  // Only real gates can go unmet; a count with no threshold has nothing to fail.
  const unmet = conditions.filter((c) => c.gate && !c.satisfied);
  if (unmet.length > 0) {
    warnings.push({
      code: 'condition-unmet',
      giftIds: [...new Set(unmet.map((c) => c.giftId))].sort((a, b) => a - b),
      detail: {
        ko: `조건을 충족하지 못하는 기프트가 ${new Set(unmet.map((c) => c.giftId)).size}개 있습니다. 효과가 발동하지 않습니다.`,
        en: `${new Set(unmet.map((c) => c.giftId)).size} gift(s) will not activate with this deck.`,
      },
    });
  }

  if (generalDrops.length > 0) {
    warnings.push({
      code: 'general-drop-not-guaranteed',
      giftIds: [...new Set(generalDrops)].sort((a, b) => a - b),
      detail: {
        ko: '범용 기프트는 어느 팩에서나 나올 수 있을 뿐 확정 획득이 아닙니다. 상점과 새로고침을 함께 쓰세요.',
        en: 'General gifts can drop from any pack but are never guaranteed; use the shop and refreshes.',
      },
    });
  }

  const lateFusions = fusions.filter((f) => !f.unreachable && f.earliestFloor >= options.lastFloor);
  if (lateFusions.length > 0) {
    warnings.push({
      code: 'fusion-late',
      giftIds: lateFusions.map((f) => f.result),
      detail: {
        ko: '마지막 층에서야 재료가 모이는 조합이 있습니다. 그 층의 상점이나 휴식 노드를 반드시 들러야 합니다.',
        en: 'Some fusions only become possible on the final floor; you must reach a shop or rest node there.',
      },
    });
  }

  const slotHeavy = fusions.filter((f) => f.exceedsShopSlots);
  if (slotHeavy.length > 0) {
    warnings.push({
      code: 'fusion-slots',
      giftIds: slotHeavy.map((f) => f.result),
      detail: {
        ko: `재료가 ${data.rules.fusion.maxShopSlots}개를 넘어 일반 상점에서는 한 번에 조합할 수 없습니다. 하위 재료부터 조합하세요.`,
        en: `Needs more than ${data.rules.fusion.maxShopSlots} fusion slots, so fuse the sub-ingredients first.`,
      },
    });
  }

  if (startObserved.length > 0 && !data.rules.giftObservation.verified) {
    warnings.push({
      code: 'gift-observation-unverified',
      detail: {
        ko: '기프트 관측 별빛 비용표는 인게임 확인이 필요한 값입니다(구버전 기준).',
        en: 'The gift-observation starlight cost is taken from an older season and needs in-game confirmation.',
      },
    });
  }

  if (search.capped) {
    warnings.push({
      code: 'search-capped',
      detail: {
        ko: '탐색 한도에 도달해 최선에 가까운 결과만 보여 줍니다. 원하는 기프트를 줄이면 더 정확해집니다.',
        en: 'The search hit its node cap, so this is a near-best plan. Fewer wanted gifts will sharpen it.',
      },
    });
  }

  if (!planIsHard) {
    const hardOnlyPacks = requirements
      .filter((r) => r.via === 'route')
      .flatMap((r) => indexes.packsByGift.get(r.giftId) ?? [])
      .map((packId) => indexes.packById.get(packId))
      .filter((pack) => pack && pack.availability.normal.length === 0 && pack.availability.hard.length > 0);
    if (hardOnlyPacks.length > 0) {
      warnings.push({
        code: 'hard-required',
        detail: {
          ko: 'Hard에서만 등장하는 팩이 필요한 기프트가 있습니다. 난이도를 Hard로 올리면 루트가 넓어집니다.',
          en: 'Some wanted gifts only come from Hard-only packs; switching to Hard widens the route.',
        },
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
      startGift: start.startGift,
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
      elapsedMs: Date.now() - startedAt,
    },
  };
}

/**
 * For a gift the search left out and that cannot itself be observed: find a floor its pack could
 * take whose current pack exists only to supply one observable gift. Observing that gift frees the
 * floor. Lowest floor first, then lowest gift id, for determinism.
 */
function soleOccupantToFree(
  giftId: number,
  search: SearchResult,
  requirements: Requirement[],
  floors: number[],
  options: PlanOptions,
  indexes: GameIndexes,
  canObserve: (giftId: number) => boolean,
): { giftId: number; packId: number; key: string } | null {
  const banned = new Set(options.bannedPacks);
  const packs = (indexes.packsByGift.get(giftId) ?? []).filter((id) => !banned.has(id));
  const usable = floors.filter((floor) => {
    if (options.pinnedPacks[floor] !== undefined) return false;
    const offered = indexes.packsByFloor[modeForFloor(floor, options, indexes)].get(floor) ?? [];
    return packs.some((id) => offered.includes(id));
  });
  for (const floor of usable.sort((a, b) => a - b)) {
    const packId = search.assignment.get(floor);
    if (packId === undefined) continue;
    const pickups = requirements
      .filter((r) => r.via === 'route' && search.supplier.get(requirementKey(r)) === floor)
      .sort((a, b) => a.giftId - b.giftId);
    const only = pickups[0];
    if (pickups.length === 1 && only && canObserve(only.giftId)) {
      return { giftId: only.giftId, packId, key: requirementKey(only) };
    }
  }
  return null;
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
  return out.sort((a, b) => a.giftId - b.giftId || a.reason.localeCompare(b.reason));
}

/** Requirements with their final routing decision, for callers that want to show the breakdown. */
export function requirementSummary(requirements: Requirement[]): Record<Requirement['via'], number[]> {
  const out: Record<Requirement['via'], number[]> = {
    route: [],
    startGift: [],
    observation: [],
    generalDrop: [],
    fusion: [],
    owned: [],
    dropped: [],
    unresolved: [],
  };
  for (const requirement of requirements) out[requirement.via].push(requirement.giftId);
  for (const key of Object.keys(out) as Requirement['via'][]) out[key].sort((a, b) => a - b);
  return out;
}
