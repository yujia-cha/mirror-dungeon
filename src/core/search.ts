import { requirementKey } from './requirements.ts';
import type { Difficulty, Rules } from './schema.ts';
import type { GameIndexes, PlanOptions, Requirement } from './types.ts';

/**
 * Which run mode a floor is played in, given the single Hard switch point.
 *
 * Which floors are 평행중첩 or EXTREME is a property of the season, so it comes from the data
 * (`rules.floors`, via `indexes.fixedModeByFloor`) and not from the numbers 6 and 11: a season that
 * opens 1~5 only has neither band.
 */
export function modeForFloor(floor: number, options: PlanOptions, indexes: GameIndexes): Difficulty {
  const fixed = indexes.fixedModeByFloor.get(floor);
  if (fixed) return fixed;
  if (options.hardFromFloor !== null && floor >= options.hardFromFloor) return 'hard';
  return 'normal';
}

export interface Slot {
  floor: number;
  mode: Difficulty;
  packId: number;
}

export interface SearchInput {
  requirements: Requirement[];
  floors: number[];
  options: PlanOptions;
  rules: Rules;
  indexes: GameIndexes;
  /** Hard node cap; when it trips the best greedy result so far is returned. */
  nodeCap?: number;
  /**
   * Floors already played, with the pack taken there. They are fixed like pins, their packs cannot
   * be visited again, and the gifts those packs supply count as picked up there.
   */
  passed?: Map<number, number>;
}

export interface SearchResult {
  /** floor -> packId for the packs the plan forces. */
  assignment: Map<number, number>;
  /** `requirementKey` -> the floor that supplies that copy. */
  supplier: Map<string, number>;
  /** The gifts no floor could supply, one entry per copy that went missing. */
  unresolvedGiftIds: number[];
  /** The same misses as `requirementKey`s, in the same order. */
  unresolvedKeys: string[];
  /** Preferred packs the search found no floor for. */
  unplacedPacks: number[];
  nodes: number;
  capped: boolean;
}

/** A gift to supply, or a preferred pack to place somewhere (`giftId` null). */
interface Candidate {
  /** `requirementKey`, or null for a preferred pack. */
  key: string | null;
  giftId: number | null;
  packId: number | null;
  required: boolean;
  /** The packs that could supply it. Empty when a floor already played supplies it for free. */
  packs: number[];
  /** A pack already settled hands this copy over at no cost. */
  freePack: number | null;
}

/**
 * How far the search may go before it gives up and returns the best plan it has.
 *
 * Realistic boards finish far inside this — a 32-goal board proves its answer optimal in a few
 * hundred nodes — so the cap only bites on goal lists far too large to fit a run at all. There it
 * buys little: doubling it on such boards saves at most one more gift and costs twice the time.
 */
const DEFAULT_NODE_CAP = 60_000;

/**
 * Assign theme packs to floors so that as many wanted gifts as possible are obtainable.
 *
 * The search chooses a PACK for each gift and leaves the floors to bipartite matching. A gift is
 * supplied by one or two packs, while a pack fits around ten floors, so branching over (floor,
 * pack) pairs multiplies the two and branching over packs alone does not: the same board that
 * needs a million nodes when floors are part of the branching is settled in a few hundred here.
 * Whether a set of packs fits on distinct floors is a matching question, which is polynomial, and
 * the cheapest floors for a fixed set follow from the same matching (see `cheapestPlacement`).
 *
 * Constraints enforced here:
 *   - one pack per floor, and a pack cannot be visited twice in a run
 *   - a floor only accepts packs available in that floor's mode (which encodes Hard-only packs,
 *     평행중첩 and EXTREME)
 *   - pinned floors keep their pack; banned packs are never used
 */
export function assignPacks(input: SearchInput): SearchResult {
  const { requirements, floors, options, indexes } = input;
  const nodeCap = input.nodeCap ?? DEFAULT_NODE_CAP;
  const banned = new Set(options.bannedPacks);

  // Floors already settled — played floors and pins — keep their pack and are not up for grabs.
  const passed = input.passed ?? new Map<number, number>();
  const settled = new Map<number, number>(passed);
  for (const [floorText, packId] of Object.entries(options.pinnedPacks)) {
    const floor = Number(floorText);
    if (floors.includes(floor) && !banned.has(packId) && !settled.has(floor)) settled.set(floor, packId);
  }
  const settledPacks = new Set(settled.values());
  const openFloors = floors.filter((floor) => !settled.has(floor)).sort((a, b) => a - b);

  /** The open floors a pack could take, in floor order. */
  const floorsOf = new Map<number, number[]>();
  const floorsFor = (packId: number): number[] => {
    const known = floorsOf.get(packId);
    if (known) return known;
    const out = openFloors.filter((floor) =>
      (indexes.packsByFloor[modeForFloor(floor, options, indexes)].get(floor) ?? []).includes(packId),
    );
    floorsOf.set(packId, out);
    return out;
  };

  const candidates: Candidate[] = [];
  const unresolvedGiftIds: number[] = [];
  const unresolvedKeys: string[] = [];
  const unplacedPacks: number[] = [];

  // A preferred pack is a requirement of its own: some floor that offers it, no gift attached.
  for (const packId of options.preferredPacks) {
    if (banned.has(packId) || settledPacks.has(packId)) continue;
    if (floorsFor(packId).length === 0) {
      unplacedPacks.push(packId);
      continue;
    }
    candidates.push({ key: null, giftId: null, packId, required: true, packs: [packId], freePack: null });
  }

  /*
   * Copies of one gift need packs of their own. A run never offers an E.G.O 기프트 you already hold,
   * and a fusion consumes what it eats, so a second copy has to come from a second pack (a 복각 pack
   * on a later floor, say) — or from 기프트 관측, which the caller arranges after this search. The
   * settled packs hand out one copy each for the same reason.
   */
  const freeLeft = new Map<number, number[]>();
  for (const requirement of requirements) {
    if (requirement.via !== 'route') continue;
    const supplying = (indexes.packsByGift.get(requirement.giftId) ?? []).filter((p) => !banned.has(p));
    let pool = freeLeft.get(requirement.giftId);
    if (!pool) {
      // A pack already settled on a played or pinned floor hands the gift over at no cost.
      pool = supplying.filter((packId) => settledPacks.has(packId));
      freeLeft.set(requirement.giftId, pool);
    }
    const freePack = pool.shift() ?? null;
    const packs = freePack !== null ? [] : supplying.filter((packId) => floorsFor(packId).length > 0);
    const key = requirementKey(requirement);
    if (freePack === null && packs.length === 0) {
      unresolvedGiftIds.push(requirement.giftId);
      unresolvedKeys.push(key);
      continue;
    }
    candidates.push({ key, giftId: requirement.giftId, packId: null, required: requirement.required, packs, freePack });
  }

  /*
   * Settled gifts first (they decide nothing), then most constrained: fewest packs, then required
   * before optional, then id for determinism. Priority is not enforced by this order — `better()`
   * compares `missedRequired` before everything else, so a plan that drops a required gift can
   * never win however it was reached. Letting a required candidate jump the queue regardless of
   * how loose it is used to make a single 반드시 gift lower the total coverage.
   */
  candidates.sort(
    (a, b) =>
      Number(b.freePack !== null) - Number(a.freePack !== null) ||
      a.packs.length - b.packs.length ||
      Number(b.required) - Number(a.required) ||
      (a.giftId ?? a.packId ?? 0) - (b.giftId ?? b.packId ?? 0) ||
      (a.key ?? '').localeCompare(b.key ?? '', 'en'),
  );

  // Counters kept in step with the DFS stack: recomputing them per node was the hot spot.
  const chosen: number[] = [];
  const chosenPacks = new Set<number>();
  const supplierPack = new Map<string, number>();
  /** giftId -> the packs its copies already took, so no two copies share one. */
  const packsTaken = new Map<number, Set<number>>();
  const missed: string[] = [];
  const missedPacks: number[] = [];
  let missedRequired = 0;
  let missedOptional = 0;
  let nodes = 0;
  let capped = false;

  /**
   * The placement the DFS carries: floor -> pack, for the chosen packs only. Adding a pack needs
   * one augmenting path (Kuhn), which can move packs that were already placed, so the floors it
   * rewrote are logged and played back in reverse to undo it. (Snapshotting the whole map instead
   * costs a copy per branch, and the branch count is what this search is made of.)
   */
  const placed = new Map<number, number>();
  const augment = (packId: number, undo: [number, number | undefined][]): boolean => {
    const seen = new Set<number>();
    const grow = (pack: number): boolean => {
      for (const floor of floorsOf.get(pack) ?? []) {
        if (seen.has(floor)) continue;
        seen.add(floor);
        const holder = placed.get(floor);
        if (holder === undefined || grow(holder)) {
          undo.push([floor, holder]);
          placed.set(floor, pack);
          return true;
        }
      }
      return false;
    };
    return grow(packId);
  };
  const restore = (undo: [number, number | undefined][]): void => {
    for (let i = undo.length - 1; i >= 0; i -= 1) {
      const [floor, holder] = undo[i]!;
      if (holder === undefined) placed.delete(floor);
      else placed.set(floor, holder);
    }
  };

  const best = {
    missedRequired: Number.POSITIVE_INFINITY,
    missedOptional: Number.POSITIVE_INFINITY,
    packCount: Number.POSITIVE_INFINITY,
    floorSum: Number.POSITIVE_INFINITY,
    placement: new Map<number, number>(),
    supplierPack: new Map<string, number>(),
    missed: [] as string[],
    missedPacks: [] as number[],
  };

  /**
   * The cheapest floors that still hold every chosen pack.
   *
   * Floor sets that can be matched to the packs form a transversal matroid, so walking the floors
   * in increasing order and keeping each one that raises the maximum matching gives the smallest
   * floor sum — the plan prefers early floors when nothing else separates two routes.
   */
  const cheapestPlacement = (chosenPacks: number[]): Map<number, number> | null => {
    if (chosenPacks.length === 0) return new Map();
    // By pack id, so the floors a plan hands out do not depend on the order the DFS met the gifts.
    const packs = [...chosenPacks].sort((a, b) => a - b);
    const kept = new Set<number>();
    let have = 0;
    const match = (allowed: Set<number>): Map<number, number> => {
      const takenBy = new Map<number, number>();
      const grow = (pack: number, seen: Set<number>): boolean => {
        const open = floorsOf.get(pack) ?? [];
        // An empty floor first: displacing a pack that is already happy only shuffles the answer.
        for (const floor of open) {
          if (!allowed.has(floor) || seen.has(floor) || takenBy.has(floor)) continue;
          seen.add(floor);
          takenBy.set(floor, pack);
          return true;
        }
        for (const floor of open) {
          if (!allowed.has(floor) || seen.has(floor)) continue;
          seen.add(floor);
          const holder = takenBy.get(floor)!;
          if (grow(holder, seen)) {
            takenBy.set(floor, pack);
            return true;
          }
        }
        return false;
      };
      for (const pack of packs) grow(pack, new Set());
      return takenBy;
    };
    for (const floor of openFloors) {
      if (have >= packs.length) break;
      kept.add(floor);
      const size = match(kept).size;
      if (size > have) have = size;
      else kept.delete(floor);
    }
    if (have < packs.length) return null;
    return match(kept);
  };

  /** Lexicographic order: required misses, then optional misses, then packs, then floors. */
  const beatenAlready = (packCount: number): boolean => {
    if (missedRequired !== best.missedRequired) return missedRequired > best.missedRequired;
    if (missedOptional !== best.missedOptional) return missedOptional > best.missedOptional;
    return packCount > best.packCount;
  };

  const record = (): void => {
    const packCount = settled.size + chosen.length;
    if (beatenAlready(packCount)) return;
    const placement = cheapestPlacement(chosen);
    if (!placement) return;
    let floorSum = 0;
    for (const floor of placement.keys()) floorSum += floor;
    const tied =
      missedRequired === best.missedRequired &&
      missedOptional === best.missedOptional &&
      packCount === best.packCount;
    if (tied && floorSum >= best.floorSum) return;
    best.missedRequired = missedRequired;
    best.missedOptional = missedOptional;
    best.packCount = packCount;
    best.floorSum = floorSum;
    best.placement = placement;
    best.supplierPack = new Map(supplierPack);
    best.missed = [...missed];
    best.missedPacks = [...missedPacks];
  };

  const dfs = (index: number): void => {
    if (capped) return;
    nodes += 1;
    if (nodes > nodeCap) {
      capped = true;
      return;
    }
    if (index >= candidates.length) {
      record();
      return;
    }
    /*
     * Prune against the best complete plan found so far. Every term only grows as the search
     * descends — misses are never taken back, packs are never dropped — so a partial plan already
     * worse on an earlier term can never recover.
     */
    if (beatenAlready(settled.size + chosen.length)) return;

    const candidate = candidates[index]!;
    if (candidate.freePack !== null) {
      dfs(index + 1);
      return;
    }

    const taken = candidate.giftId === null ? undefined : packsTaken.get(candidate.giftId);
    const open = taken ? candidate.packs.filter((packId) => !taken.has(packId)) : candidate.packs;
    // Reusing a pack already chosen costs nothing, so try those first.
    const reuse = open.filter((packId) => chosenPacks.has(packId));
    const fresh = open.filter((packId) => !chosenPacks.has(packId));
    for (const packId of [...reuse, ...fresh]) {
      const isNew = !chosenPacks.has(packId);
      const undo: [number, number | undefined][] = [];
      if (isNew) {
        if (!augment(packId, undo)) {
          // No floor left for this pack alongside the ones already chosen.
          restore(undo);
          continue;
        }
        chosen.push(packId);
        chosenPacks.add(packId);
      }
      let mine: Set<number> | undefined;
      if (candidate.giftId !== null) {
        supplierPack.set(candidate.key!, packId);
        mine = packsTaken.get(candidate.giftId);
        if (!mine) {
          mine = new Set();
          packsTaken.set(candidate.giftId, mine);
        }
        mine.add(packId);
      }
      dfs(index + 1);
      if (candidate.giftId !== null) {
        supplierPack.delete(candidate.key!);
        mine!.delete(packId);
      }
      if (isNew) {
        chosen.pop();
        chosenPacks.delete(packId);
        restore(undo);
      }
      if (capped) return;
    }

    // Giving up on this gift is also a branch: two exclusives can be mutually exclusive.
    if (candidate.giftId !== null) missed.push(candidate.key!);
    else missedPacks.push(candidate.packId!);
    if (candidate.required) missedRequired += 1;
    else missedOptional += 1;
    dfs(index + 1);
    if (candidate.required) missedRequired -= 1;
    else missedOptional -= 1;
    if (candidate.giftId !== null) missed.pop();
    else missedPacks.pop();
  };

  dfs(0);

  const assignment = new Map<number, number>(settled);
  for (const [floor, packId] of best.placement) assignment.set(floor, packId);
  const floorOfPack = new Map<number, number>();
  for (const [floor, packId] of [...assignment].sort((a, b) => a[0] - b[0])) {
    if (!floorOfPack.has(packId)) floorOfPack.set(packId, floor);
  }
  const supplier = new Map<string, number>();
  const giftOfKey = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.giftId === null) continue;
    giftOfKey.set(candidate.key!, candidate.giftId);
    const packId = candidate.freePack ?? best.supplierPack.get(candidate.key!);
    const floor = packId === undefined || packId === null ? undefined : floorOfPack.get(packId);
    if (floor !== undefined) supplier.set(candidate.key!, floor);
  }
  const missedKeys = [...unresolvedKeys, ...best.missed].sort(
    (a, b) => (giftOfKey.get(a) ?? Number(a.split(':')[0])) - (giftOfKey.get(b) ?? Number(b.split(':')[0])) || a.localeCompare(b, 'en'),
  );

  return {
    assignment,
    supplier,
    unresolvedGiftIds: missedKeys.map((key) => giftOfKey.get(key) ?? Number(key.split(':')[0])),
    unresolvedKeys: missedKeys,
    unplacedPacks: [...unplacedPacks, ...best.missedPacks].sort((a, b) => a - b),
    nodes,
    capped,
  };
}

/**
 * Starlight for forcing `count` packs through theme-pack observation.
 * The cost rises by `step` per use in a run, and by a further multiplier for a pack never visited.
 */
export function observationCost(count: number, rules: Rules, assumeUnvisited: boolean): number {
  const { base, step, unvisitedMultiplier } = rules.themeObservation;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const cost = base + step * i;
    total += assumeUnvisited ? Math.ceil(cost * unvisitedMultiplier) : cost;
  }
  return total;
}
