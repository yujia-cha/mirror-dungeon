import { Tableau } from './lp.ts';
import { requirementKey } from './requirements.ts';
import type { Difficulty, Rules } from './schema.ts';
import type { GameIndexes, PlanOptions, Requirement } from './types.ts';

/**
 * Other packs offered on `floor` that carry every one of `giftIds` — the packs a player could take
 * instead, with the same gifts to show for it.
 *
 * 인연 얽힘 (9208) is the plain case: seven 죄악 packs all drop it, so naming only the one the search
 * picked would hide six equally good choices. `giftPool` is the whole pool a pack can offer, so a
 * pack's own 전용 gifts are in it too.
 */
export function alternativePacksOn(
  floor: number,
  mode: Difficulty,
  giftIds: readonly number[],
  indexes: GameIndexes,
  options: { exclude?: number; banned?: ReadonlySet<number> } = {},
): number[] {
  if (giftIds.length === 0) return [];
  const offered = indexes.packsByFloor[mode].get(floor) ?? [];
  return offered.filter((candidate) => {
    if (candidate === options.exclude) return false;
    if (options.banned?.has(candidate)) return false;
    const pack = indexes.packById.get(candidate);
    return pack ? giftIds.every((giftId) => pack.giftPool.includes(giftId)) : false;
  });
}

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
  /**
   * Gifts the player left a played floor without picking up. The pack visited there hands every
   * other gift of its own over for free, but not these: a copy has to come from a pack still ahead.
   */
  failed?: ReadonlySet<number>;
  /** Prune with the floor-window lower bound (`boundExceeds` below). On unless set to false. */
  lowerBound?: boolean;
  /**
   * How many more nodes the search may spend once its misses are proven optimal (`rootBound`
   * below), comparing plans that miss the same number on packs and floors alone. Defaults to
   * `TIE_BREAK_NODES`.
   */
  tieBreakNodes?: number;
  /** Start from the greedy seeds (below). On unless set to false; tests compare the two. */
  seed?: boolean;
  /**
   * Close the gap the relaxation leaves with a branch and bound on the packs (M87). On unless set
   * to false; tests compare the two.
   */
  branch?: boolean;
  /** How many relaxations the branch and bound may solve. Defaults to `BRANCH_NODES`. */
  branchNodes?: number;
  /**
   * 기프트 관측 slots the search may spend (M87): up to `slots` copies of the `gifts` listed, one
   * per gift, are handed over at run start instead of by a pack. Without it nothing is observed.
   */
  observation?: { slots: number; gifts: ReadonlySet<number> };
  /**
   * What the copies are for (M87). Without it every copy counts as a goal of its own, which is what
   * the search minimised up to M84; `planRoute` always passes it.
   */
  goals?: SearchGoals;
}

/**
 * The goals behind the copies. The user counts goals — the gifts they picked — and a fusion goal
 * is several copies: missing any one of them loses the whole goal, and every further copy of it is
 * worth nothing to that goal any more.
 */
export interface SearchGoals {
  /**
   * `requirementKey` -> the goals that copy keeps alive: every wanted gift up its `neededFor`
   * chain, and the gift itself when it is wanted. A copy with no entry is a goal of its own.
   */
  roots: ReadonlyMap<string, readonly number[]>;
  /** Goals that must not be lost (CLI `--must`). */
  required?: ReadonlySet<number>;
  /** Goals already lost before the search — no pack choice can save them. */
  lost?: ReadonlySet<number>;
  /**
   * Goals whose ingredients are no goals of their own (`ingredientsAsGoals: false`). A copy that
   * only serves such goals is worth nothing once they are lost, so the search stops chasing it.
   * Any other copy stays worth supplying for its own sake — the ingredients of a lost fusion stay
   * goals of their own by default — and only the third term (copies missed) counts it.
   */
  resultOnly?: ReadonlySet<number>;
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
  /**
   * Copies left unrouted because every goal they serve was lost already (`SearchGoals`). They are
   * not misses of their own: what is missing is the copy that lost the goal. `planRoute` drops
   * them like any ingredient of a fusion that can no longer happen.
   */
  abandonedKeys: string[];
  /** The goals the plan loses, by gift id (`SearchGoals` only; empty without it). */
  lostGoals: number[];
  /** Copies the plan hands to 기프트 관측 (`SearchInput.observation`), as `requirementKey`s. */
  observedKeys: string[];
  /** Preferred packs the search found no floor for. */
  unplacedPacks: number[];
  nodes: number;
  /** Relaxations solved for the root bound and the branch and bound (M87). */
  relaxations: number;
  /** The node cap stopped the search: a better plan may exist. */
  capped: boolean;
  /**
   * The tie-break budget stopped the search. The misses are optimal — the root bound proves it — but
   * a plan with as many misses and fewer packs or earlier floors may exist.
   */
  tieBreakCut: boolean;
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
 * The nodes left for tie-breaking once the misses are proven optimal (M83). Past that point only
 * pack count and floor sum are at stake, and on large boards proving those minimal was what ran the
 * search into the node cap. On 120 random boards 1,000 already left the packs of every one as they
 * were with no budget at all (M84); 2,000 keeps some margin at 10~40ms on the largest boards.
 */
const TIE_BREAK_NODES = 2_000;

/** The pivots one relaxation may take before it gives up (no bound rather than a wrong one). */
const LP_PIVOTS = 20_000;

/** The relaxations the branch and bound may solve before it stops without a proof (M87). */
const BRANCH_NODES = 400;

/** The packs strong branching tries at each split of the branch and bound (M87). */
const STRONG_BRANCH = 4;

/** The most ways `scoreExactly` tries to share a gift's packs among its copies. */
const EXACT_CHOICES = 256;

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
  const tieBreakNodes = input.tieBreakNodes ?? TIE_BREAK_NODES;
  const banned = new Set(options.bannedPacks);

  // Floors already settled — played floors and pins — keep their pack and are not up for grabs.
  const passed = input.passed ?? new Map<number, number>();
  const visitedPacks = new Set(passed.values());
  const failed = input.failed ?? new Set<number>();
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
    // A pack is visited once per run. One already settled on a played or pinned floor has no open
    // floor left whatever the mode tables say: it hands over one copy of each of its gifts for
    // free (see `freeLeft` below), and a second copy has to come from another pack. Without this
    // the second copy could pick the settled pack again and put it on two floors at once.
    const out = settledPacks.has(packId)
      ? []
      : openFloors.filter((floor) =>
          (indexes.packsByFloor[modeForFloor(floor, options, indexes)].get(floor) ?? []).includes(packId),
        );
    floorsOf.set(packId, out);
    return out;
  };

  /*
   * 기프트 관측 (M87): observing a gift is a pack of its own — it supplies one copy of that gift, at
   * no floor, and the observations together hold `observeSlots` of them. Its id is the gift's id
   * negated, which no theme pack has. The DFS spends a slot where it would place a pack, the
   * relaxation gets one more window (the slots), and the plan says which copies it observed.
   */
  const observeSlots = input.observation?.slots ?? 0;
  const observationPack = (giftId: number): number => -giftId;
  const isObservation = (packId: number): boolean => packId < 0;

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
      // A pack already settled on a played or pinned floor hands the gift over at no cost — unless
      // the player already left that pack's floor without it. A pack pinned on a floor still ahead
      // is not the one it was missed on, so that one still counts.
      const missedOn = failed.has(requirement.giftId) ? visitedPacks : null;
      pool = supplying.filter((packId) => settledPacks.has(packId) && !missedOn?.has(packId));
      freeLeft.set(requirement.giftId, pool);
    }
    const freePack = pool.shift() ?? null;
    const packs = freePack !== null ? [] : supplying.filter((packId) => floorsFor(packId).length > 0);
    // 기프트 관측 is one more source, a pack of its own that takes a slot instead of a floor.
    if (freePack === null && observeSlots > 0 && input.observation!.gifts.has(requirement.giftId))
      packs.push(observationPack(requirement.giftId));
    const key = requirementKey(requirement);
    if (freePack === null && packs.length === 0) {
      unresolvedGiftIds.push(requirement.giftId);
      unresolvedKeys.push(key);
      continue;
    }
    candidates.push({
      key,
      giftId: requirement.giftId,
      packId: null,
      required: requirement.required,
      packs,
      freePack,
    });
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

  /*
   * Goals (M87). The plan is judged by the goals it keeps, not the copies it supplies: a fusion goal
   * is several copies, and one missing copy loses all of it. Each candidate maps to the goals it
   * keeps alive (`rootsOf`, by index into `goalIds`). Without `input.goals` every candidate is a
   * goal of its own, and the search below is exactly the copy count M84 minimised.
   *
   * Goals already lost before the search are no goals here: the caller's `lost`, and those whose
   * copy no pack in range carries (the `unresolvedKeys` above). A copy that serves only those is
   * worth its own supply alone — the third term — or nothing at all (`abandonable`).
   */
  const goalInput = input.goals;
  const lostBefore = new Set<number>(goalInput?.lost ?? []);
  if (goalInput) {
    for (const key of unresolvedKeys) for (const goal of goalInput.roots.get(key) ?? []) lostBefore.add(goal);
  }
  /** The gift id behind each goal index, or null for a goal that is one candidate of its own. */
  const goalIds: (number | null)[] = [];
  const goalRequired: boolean[] = [];
  const goalIndex = new Map<number, number>();
  const rootsOf: number[][] = [];
  /** Supplying this copy is worthless once every goal it serves is lost. */
  const abandonable: boolean[] = [];
  candidates.forEach((candidate, k) => {
    abandonable[k] = false;
    if (candidate.freePack !== null) {
      rootsOf[k] = [];
      return;
    }
    const known = goalInput && candidate.key !== null ? goalInput.roots.get(candidate.key) : undefined;
    if (!known || known.length === 0) {
      rootsOf[k] = [goalIds.length];
      goalIds.push(null);
      goalRequired.push(candidate.required);
      return;
    }
    const live: number[] = [];
    for (const goal of known) {
      if (lostBefore.has(goal)) continue;
      let index = goalIndex.get(goal);
      if (index === undefined) {
        index = goalIds.length;
        goalIndex.set(goal, index);
        goalIds.push(goal);
        goalRequired.push(goalInput!.required?.has(goal) ?? false);
      }
      if (!live.includes(index)) live.push(index);
    }
    rootsOf[k] = live.sort((a, b) => a - b);
    abandonable[k] = known.every((goal) => goalInput!.resultOnly?.has(goal) ?? false);
  });
  /** The wanted gift's own copy (not one a fusion eats). */
  const direct = candidates.map((candidate) => candidate.key?.endsWith(':direct') ?? false);
  /** How many copies each goal has lost on the current DFS path: lost once it is above zero. */
  const dead = new Int32Array(goalIds.length);

  // Counters kept in step with the DFS stack: recomputing them per node was the hot spot.
  const chosen: number[] = [];
  const chosenPacks = new Set<number>();
  const supplierPack = new Map<string, number>();
  /** giftId -> the packs its copies already took, so no two copies share one. */
  const packsTaken = new Map<number, Set<number>>();
  const missed: string[] = [];
  const abandoned: string[] = [];
  const missedPacks: number[] = [];
  /** Goals lost on the current path, required and not. */
  let missedRequired = 0;
  let missedOptional = 0;
  /** Copies missed on the current path while they still served something (not the abandoned). */
  let missedCopies = 0;
  /** Observation slots spent on the current path. */
  let observedNow = 0;
  let nodes = 0;
  let capped = false;
  let tieBreakCut = false;
  /** Either limit hit: unwind without exploring further. */
  let halted = false;
  /** The node count when the best plan's misses first met the root bound, or null. */
  let provenAt: number | null = null;

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
    missedCopies: Number.POSITIVE_INFINITY,
    packCount: Number.POSITIVE_INFINITY,
    floorSum: Number.POSITIVE_INFINITY,
    placement: new Map<number, number>(),
    supplierPack: new Map<string, number>(),
    missed: [] as string[],
    abandoned: [] as string[],
    missedPacks: [] as number[],
    lost: [] as number[],
  };
  const lostNow = (): number[] => {
    const out: number[] = [];
    for (let g = 0; g < goalIds.length; g += 1)
      if (dead[g]! > 0 && goalIds[g] !== null) out.push(goalIds[g]!);
    return out;
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

  /*
   * The floor-window lower bound (M82).
   *
   * Packs whose open floors are the same form one window class, and every window is a run of floors
   * (MD7: 115 packs, 11 classes). For a run of open floors [a, b], every pack whose window lies
   * inside it competes for its b - a + 1 floors — Hall's condition, one constraint per distinct set
   * of classes. A gift still to decide whose packs all sit inside such a run needs one of them, and
   * gifts whose pack choices are pairwise disjoint need distinct packs. So if those gifts, plus the
   * chosen packs already inside the run, outnumber its floors, at least the excess will be missed —
   * however the rest of the branch goes. That is a bound on what the DFS can still achieve, which is
   * what pruning needs: a better first answer (M81's seed) did not cut a single node, because the
   * time goes into proving that nothing beats the answer the DFS already has.
   *
   * M87 turns the copies into goals (`windowGoals`): the excess copies are missed, and missing them
   * loses at least the fewest goals that can hold that many of them.
   */
  const windowKey = new Map<string, number>();
  const classOf = new Map<number, number>();
  const classFloors: number[][] = [];
  const classify = (packId: number): number => {
    const known = classOf.get(packId);
    if (known !== undefined) return known;
    const open = floorsFor(packId);
    const key = open.join(',');
    let id = windowKey.get(key);
    if (id === undefined) {
      id = classFloors.length;
      windowKey.set(key, id);
      classFloors.push(open);
    }
    classOf.set(packId, id);
    return id;
  };
  const candidateClasses = candidates.map((candidate) =>
    candidate.freePack !== null
      ? 0
      : candidate.packs.reduce((mask, packId) => mask | (1 << classify(packId)), 0),
  );
  /** One entry per distinct set of classes a run of open floors fully contains: its mask and size. */
  const windows: { mask: number; cap: number }[] = [];
  const useBound = input.lowerBound !== false && classFloors.length > 0 && classFloors.length <= 30;
  if (useBound) {
    const position = new Map(openFloors.map((floor, i) => [floor, i]));
    const smallest = new Map<number, number>();
    for (let from = 0; from < openFloors.length; from += 1) {
      for (let to = from; to < openFloors.length; to += 1) {
        let mask = 0;
        classFloors.forEach((open, id) => {
          if (open.length === 0) return;
          const first = position.get(open[0]!)!;
          const last = position.get(open[open.length - 1]!)!;
          if (first >= from && last <= to) mask |= 1 << id;
        });
        if (mask === 0) continue;
        const cap = to - from + 1;
        const known = smallest.get(mask);
        if (known === undefined || cap < known) smallest.set(mask, cap);
      }
    }
    for (const [mask, cap] of smallest) windows.push({ mask, cap });
  }

  /**
   * The bound is checked in the first half of the decisions only. A cut there saves a whole subtree;
   * near the leaves the subtrees are small and the check costs about what it saves.
   */
  const boundDepth = Math.ceil(candidates.length / 2);
  /** Per window: the gift candidates whose every pack lies inside it, in DFS order. */
  const inside = windows.map(({ mask }) =>
    candidates
      .map((candidate, k) => ({ candidate, k }))
      .filter(
        ({ candidate, k }) =>
          candidate.freePack === null && candidate.giftId !== null && (candidateClasses[k]! & ~mask) === 0,
      ),
  );

  /**
   * Window `w`'s gifts from candidate `index` on that still need a pack of their own: the open ones
   * whose packs are pairwise disjoint. Left in `need` (candidate indexes).
   */
  const claimed = new Set<number>();
  const need: number[] = [];
  const windowNeed = (w: number, index: number): number => {
    need.length = 0;
    claimed.clear();
    for (const { candidate, k } of inside[w]!) {
      if (k < index) continue;
      if (candidate.packs.some((packId) => chosenPacks.has(packId) || claimed.has(packId))) continue;
      need.push(k);
      for (const packId of candidate.packs) claimed.add(packId);
    }
    return need.length;
  };
  /** The floors of window `w` the chosen packs leave free. */
  const windowRoom = (w: number): number => {
    const { mask, cap } = windows[w]!;
    let room = cap;
    for (const packId of chosen) if ((mask >> classify(packId)) & 1) room -= 1;
    return room;
  };
  /**
   * The fewest goals lost by missing `excess` of the copies in `need`. A copy whose goals are all
   * lost already costs nothing; any other loses every goal it serves, so the lost goals must between
   * them hold every missed copy — and no set of t goals holds more than its t largest counts.
   */
  const perGoal = new Int32Array(goalIds.length);
  const touched: number[] = [];
  const windowGoals = (excess: number): number => {
    if (excess <= 0) return 0;
    let left = excess;
    touched.length = 0;
    for (const k of need) {
      let live = false;
      for (const g of rootsOf[k]!) {
        if (dead[g]! > 0) continue;
        live = true;
        if (perGoal[g] === 0) touched.push(g);
        perGoal[g] = perGoal[g]! + 1;
      }
      if (!live) left -= 1;
    }
    const counts = touched.map((g) => perGoal[g]!).sort((a, b) => b - a);
    for (const g of touched) perGoal[g] = 0;
    let goals = 0;
    for (const count of counts) {
      if (left <= 0) break;
      left -= count;
      goals += 1;
    }
    return goals;
  };

  /**
   * Whether the gifts from candidate `index` on are bound to lose more than `slack` more goals — the
   * room this branch has left before it is no better than the best plan. Stops at the first window
   * that shows it.
   */
  const boundExceeds = (index: number, slack: number): boolean => {
    for (let w = 0; w < windows.length; w += 1) {
      const room = windowRoom(w);
      // Not enough gifts left in here to overflow it, whatever they are.
      if (inside[w]!.length - room <= slack) continue;
      const excess = windowNeed(w, index) - room;
      if (excess <= slack) continue;
      if (windowGoals(excess) > slack) return true;
    }
    return false;
  };

  /**
   * The fewest goals any plan can lose, computed before the DFS (below). Once the best plan's
   * losses reach it they are optimal, and the rest of the search only breaks ties on copies, packs
   * and floors — which `tieBreakNodes` caps (M83).
   */
  let rootBound = 0;

  /** Lexicographic order: required goals lost, other goals lost, copies missed, packs, floors. */
  const beatenAlready = (packCount: number): boolean => {
    if (missedRequired !== best.missedRequired) return missedRequired > best.missedRequired;
    if (missedOptional !== best.missedOptional) return missedOptional > best.missedOptional;
    if (missedCopies !== best.missedCopies) return missedCopies > best.missedCopies;
    return packCount > best.packCount;
  };

  /**
   * The best plan is the greedy seed (below) until the DFS finds one at least as good. The seed only
   * sets the bar: on a tie the DFS's own plan wins, so a search that finishes returns exactly what it
   * returned without a seed.
   */
  let seeded = false;
  /** Bumped whenever `chosen` changes, so `record` can tell a pack set it has placed already. */
  let chosenVersion = 0;
  let placedFor = -1;
  let lastPlacement: Map<number, number> | null = null;
  let lastFloorSum = 0;
  const record = (): void => {
    const packCount = settled.size + chosen.length;
    if (beatenAlready(packCount)) return;
    // Leaves under the same chosen packs share their floors; only the suppliers differ.
    if (placedFor !== chosenVersion) {
      placedFor = chosenVersion;
      lastPlacement = cheapestPlacement(chosen);
      lastFloorSum = 0;
      for (const floor of lastPlacement?.keys() ?? []) lastFloorSum += floor;
    }
    const placement = lastPlacement;
    if (!placement) return;
    const floorSum = lastFloorSum;
    const tied =
      missedRequired === best.missedRequired &&
      missedOptional === best.missedOptional &&
      missedCopies === best.missedCopies &&
      packCount === best.packCount;
    if (tied && (seeded ? floorSum > best.floorSum : floorSum >= best.floorSum)) return;
    seeded = false;
    best.missedRequired = missedRequired;
    best.missedOptional = missedOptional;
    best.missedCopies = missedCopies;
    best.packCount = packCount;
    best.floorSum = floorSum;
    best.placement = placement;
    best.supplierPack = new Map(supplierPack);
    best.missed = [...missed];
    best.abandoned = [...abandoned];
    best.missedPacks = [...missedPacks];
    best.lost = lostNow();
    // A required loss could still be traded for optional ones, so only a plan losing optional
    // goals alone is proven by the bound, which counts both.
    if (provenAt === null && missedRequired === 0 && missedOptional <= rootBound) provenAt = nodes;
  };

  /**
   * Dominance (M84, restated for goals in M87). A copy that a chosen pack can supply takes one: a
   * new pack instead ends with the same packs or worse — any later copy of the gift that would have
   * used the chosen pack can take the new one, both still supplied — and the DFS tries the chosen
   * packs first, so it has met that plan already. Missing the copy instead is dominated only when
   * no later copy of the same gift serves different goals: then a plan that hands the chosen pack
   * to a later copy and misses this one swaps into one that does the opposite and loses the same
   * goals. When the later copies serve other goals the miss is a branch of its own, because which
   * copy goes without decides which goal is lost. And among new packs no later candidate lists,
   * only the window matters — they supply nothing else — so one per window class is enough.
   */
  const lastUse = new Map<number, number>();
  /** No later copy of the same gift: any chosen pack serves this one alike, so the first will do. */
  const lastCopy: boolean[] = [];
  /** Every later copy of the same gift is interchangeable with this one. */
  const sameLater: boolean[] = [];
  {
    const signature = (k: number): string => {
      const roots = rootsOf[k]!;
      if (roots.length === 1 && goalIds[roots[0]!] === null) return `own:${candidates[k]!.required}`;
      return `${roots.join(',')}:${abandonable[k]}`;
    };
    const laterSigs = new Map<number, Set<string>>();
    for (let k = candidates.length - 1; k >= 0; k -= 1) {
      const { giftId } = candidates[k]!;
      const later = giftId === null ? undefined : laterSigs.get(giftId);
      lastCopy[k] = later === undefined;
      const mine = signature(k);
      sameLater[k] = later === undefined || [...later].every((sig) => sig === mine);
      if (giftId === null || candidates[k]!.freePack !== null) continue;
      if (later) later.add(mine);
      else laterSigs.set(giftId, new Set([mine]));
    }
  }
  candidates.forEach((candidate, k) => {
    for (const packId of candidate.packs) lastUse.set(packId, k);
  });
  const freshClasses = new Set<number>();

  /**
   * Whether copy `k` serves nothing on the current path: every goal it serves is lost, or it serves
   * none and keeps no ingredient goal of its own either (`abandonable`). A copy whose goals were all
   * lost before the search, of a fusion whose ingredients stay goals of their own, is still worth a
   * pack — it is the third term. So is a wanted gift's own copy: its goal is lost only on paper when
   * the copy another goal eats went missing (`goalRoots`), and the player still keeps this one.
   */
  const worthless = (k: number): boolean => {
    if (direct[k]) return false;
    const roots = rootsOf[k]!;
    if (roots.length === 0) return abandonable[k]!;
    for (const g of roots) if (dead[g] === 0) return false;
    return true;
  };
  const miss = (k: number): void => {
    const candidate = candidates[k]!;
    if (candidate.giftId !== null) missed.push(candidate.key!);
    else missedPacks.push(candidate.packId!);
    missedCopies += 1;
    for (const g of rootsOf[k]!) {
      if (dead[g] === 0) {
        if (goalRequired[g]) missedRequired += 1;
        else missedOptional += 1;
      }
      dead[g] = dead[g]! + 1;
    }
  };
  const unmiss = (k: number): void => {
    const candidate = candidates[k]!;
    for (const g of rootsOf[k]!) {
      dead[g] = dead[g]! - 1;
      if (dead[g] === 0) {
        if (goalRequired[g]) missedRequired -= 1;
        else missedOptional -= 1;
      }
    }
    missedCopies -= 1;
    if (candidate.giftId !== null) missed.pop();
    else missedPacks.pop();
  };

  const dfs = (index: number): void => {
    if (halted) return;
    nodes += 1;
    if (nodes > nodeCap) {
      capped = true;
      halted = true;
      return;
    }
    if (provenAt !== null && nodes > provenAt + tieBreakNodes) {
      tieBreakCut = true;
      halted = true;
      return;
    }
    if (index >= candidates.length) {
      record();
      return;
    }
    /*
     * Prune against the best complete plan found so far. Every term only grows as the search
     * descends — goals once lost stay lost, misses are never taken back, packs are never dropped —
     * so a partial plan already worse on an earlier term can never recover.
     */
    if (beatenAlready(settled.size + chosen.length)) return;
    // However the misses still to come split, they make the branch worse once they reach the best
    // plan's: on the first term, or — the required ones equal — on the second.
    if (
      useBound &&
      index < boundDepth &&
      missedRequired === best.missedRequired &&
      boundExceeds(index, best.missedOptional - missedOptional)
    )
      return;

    const candidate = candidates[index]!;
    if (candidate.freePack !== null) {
      dfs(index + 1);
      return;
    }
    // Every goal this copy serves is lost on this path already: supplying it buys nothing and may
    // cost a pack, so it is only left out (M87). It is no miss of its own — the copy that lost the
    // goal is — so no term counts it, and leaving it out is never worse than any other branch.
    if (worthless(index)) {
      abandoned.push(candidate.key!);
      dfs(index + 1);
      abandoned.pop();
      return;
    }

    const taken = candidate.giftId === null ? undefined : packsTaken.get(candidate.giftId);
    const open = taken ? candidate.packs.filter((packId) => !taken.has(packId)) : candidate.packs;
    // Reusing a pack already chosen costs nothing, so try those first — and only those, if any.
    const reuse = open.filter((packId) => chosenPacks.has(packId));
    let fresh: number[] = [];
    if (reuse.length === 0) {
      freshClasses.clear();
      fresh = open.filter((packId) => {
        if (chosenPacks.has(packId)) return false;
        if (lastUse.get(packId)! > index) return true;
        const id = classify(packId);
        if (freshClasses.has(id)) return false;
        freshClasses.add(id);
        return true;
      });
    }
    const branches = reuse.length === 0 ? fresh : lastCopy[index] ? reuse.slice(0, 1) : reuse;
    for (const packId of branches) {
      const observing = isObservation(packId);
      if (observing && observedNow >= observeSlots) continue;
      const isNew = !observing && !chosenPacks.has(packId);
      const undo: [number, number | undefined][] = [];
      if (observing) observedNow += 1;
      if (isNew) {
        if (!augment(packId, undo)) {
          // No floor left for this pack alongside the ones already chosen.
          restore(undo);
          continue;
        }
        chosen.push(packId);
        chosenPacks.add(packId);
        chosenVersion += 1;
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
      if (observing) observedNow -= 1;
      if (candidate.giftId !== null) {
        supplierPack.delete(candidate.key!);
        mine!.delete(packId);
      }
      if (isNew) {
        chosen.pop();
        chosenPacks.delete(packId);
        chosenVersion += 1;
        restore(undo);
      }
      if (halted) return;
    }
    if (reuse.length > 0 && sameLater[index]) return;

    // Giving up on this gift is also a branch: two exclusives can be mutually exclusive.
    miss(index);
    dfs(index + 1);
    unmiss(index);
  };

  /*
   * What to supply, per gift: its copies share one pack list and each needs a pack of its own, so a
   * gift with n copies is covered n times at most, once per chosen pack it lists. A preferred pack
   * is a "gift" of its own with one copy.
   */
  const groups: { copies: number[]; required: boolean; packs: number[] }[] = [];
  const groupOf: number[] = [];
  {
    const groupOfGift = new Map<number, number>();
    candidates.forEach((candidate, k) => {
      groupOf[k] = -1;
      if (candidate.freePack !== null) return;
      const known = candidate.giftId === null ? undefined : groupOfGift.get(candidate.giftId);
      if (known !== undefined) {
        groups[known]!.copies.push(k);
        groupOf[k] = known;
        return;
      }
      if (candidate.giftId !== null) groupOfGift.set(candidate.giftId, groups.length);
      groupOf[k] = groups.length;
      groups.push({ copies: [k], required: candidate.required, packs: candidate.packs });
    });
  }
  const groupPacks = [...new Set(groups.flatMap((group) => group.packs))].sort((a, b) => a - b);
  const groupsOfPack = new Map<number, number[]>();
  groups.forEach((group, g) => {
    for (const packId of group.packs) {
      const list = groupsOfPack.get(packId) ?? [];
      list.push(g);
      groupsOfPack.set(packId, list);
    }
  });
  /** The copies of each goal, by candidate index. */
  const copiesOfGoal: number[][] = goalIds.map(() => []);
  rootsOf.forEach((roots, k) => {
    for (const g of roots) copiesOfGoal[g]!.push(k);
  });

  /*
   * The greedy seeds (M84, M87). The DFS meets the hard decisions — whether to give up a gift only
   * one pack supplies — first, and on a large board never gets back to them before the node cap; a
   * good plan up front starts it from a good bar instead. Two are built and the better one kept:
   * the M84 seed takes the pack that supplies the most copies still missing, the goal seed completes
   * the goal that needs the fewest new packs. Neither is the better one on every board.
   *
   * `score` rates a set of packs the way `record` would: each gift's packs go to its copies, the
   * copies of goals that can still be completed first, and the rest of the terms follow.
   */
  type Seed = {
    missedRequired: number;
    missedOptional: number;
    missedCopies: number;
    packs: Set<number>;
    supplier: Map<string, number>;
    missed: string[];
    abandoned: string[];
    missedPacks: number[];
    lost: number[];
  };
  const score = (picked: ReadonlySet<number>, reserved: ReadonlyMap<number, number>): Seed => {
    const supplied = new Map<number, number>(reserved);
    // A goal is completable when each of its copies has a picked pack its gift has not handed out.
    const freeOf = groups.map((group) => {
      const used = new Set<number>();
      for (const k of group.copies) if (supplied.has(k)) used.add(supplied.get(k)!);
      return group.packs.filter((packId) => picked.has(packId) && !used.has(packId));
    });
    const short = groups.map((group, g) => {
      let open = 0;
      for (const k of group.copies) if (!supplied.has(k)) open += 1;
      return open > freeOf[g]!.length;
    });
    // The fewest contested copies among a copy's goals: a goal with none can surely be completed.
    const urgency = (k: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const g of rootsOf[k]!) {
        let contested = 0;
        for (const c of copiesOfGoal[g]!) if (!supplied.has(c) && short[groupOf[c]!]) contested += 1;
        best = Math.min(best, contested);
      }
      return best;
    };
    groups.forEach((group, g) => {
      const open = group.copies.filter((k) => !supplied.has(k));
      if (open.length === 0) return;
      const order = short[g]
        ? open.map((k) => ({ k, u: urgency(k) })).sort((a, b) => a.u - b.u || a.k - b.k)
        : open.map((k) => ({ k, u: 0 }));
      const free = freeOf[g]!;
      order.forEach(({ k }, i) => {
        if (i < free.length) supplied.set(k, free[i]!);
      });
    });
    // Count like the DFS: a goal is lost when any copy goes without, and a copy that serves only
    // lost goals is abandoned rather than supplied — the first copy of a lost goal in DFS order is
    // the miss, the rest are abandoned, which is a plan the DFS reaches too.
    const lostGoal = new Array<boolean>(goalIds.length).fill(false);
    candidates.forEach((candidate, k) => {
      if (candidate.freePack === null && !supplied.has(k)) for (const g of rootsOf[k]!) lostGoal[g] = true;
    });
    const seed: Seed = {
      missedRequired: 0,
      missedOptional: 0,
      missedCopies: 0,
      packs: new Set(),
      supplier: new Map(),
      missed: [],
      abandoned: [],
      missedPacks: [],
      lost: [],
    };
    lostGoal.forEach((lost, g) => {
      if (!lost) return;
      if (goalRequired[g]) seed.missedRequired += 1;
      else seed.missedOptional += 1;
      if (goalIds[g] !== null) seed.lost.push(goalIds[g]!);
    });
    const deadSoFar = new Array<boolean>(goalIds.length).fill(false);
    candidates.forEach((candidate, k) => {
      if (candidate.freePack !== null) return;
      const roots = rootsOf[k]!;
      const packId = supplied.get(k);
      const useless = direct[k]
        ? false
        : roots.length === 0
          ? abandonable[k]!
          : roots.every((g) => lostGoal[g]);
      if (packId !== undefined && !useless) {
        if (!isObservation(packId)) seed.packs.add(packId);
        if (candidate.key !== null) seed.supplier.set(candidate.key, packId);
        return;
      }
      if (!direct[k] && (roots.length === 0 ? abandonable[k]! : roots.every((g) => deadSoFar[g]))) {
        seed.abandoned.push(candidate.key!);
        return;
      }
      seed.missedCopies += 1;
      for (const g of roots) deadSoFar[g] = true;
      if (candidate.giftId !== null) seed.missed.push(candidate.key!);
      else seed.missedPacks.push(candidate.packId!);
    });
    return seed;
  };
  const compareSeeds = (a: Seed, b: Seed): number =>
    a.missedRequired - b.missedRequired ||
    a.missedOptional - b.missedOptional ||
    a.missedCopies - b.missedCopies ||
    a.packs.size - b.packs.size;

  /**
   * A seed's packs with the observation slots spent on top: on the lost goals that the fewest
   * observations complete, first. The seeds only — the DFS and the branch and bound weigh every
   * observation against every pack.
   */
  const observeFor = (picked: ReadonlySet<number>, reserved: ReadonlyMap<number, number>): Seed => {
    const plan = score(picked, reserved);
    if (observeSlots === 0) return plan;
    const withSlots = new Set(picked);
    let left = observeSlots;
    const options = goalIds
      .map((_, g) => {
        const gifts = new Set<number>();
        let open = 0;
        for (const k of copiesOfGoal[g]!) {
          const { key, giftId } = candidates[k]!;
          if (key === null || giftId === null) return null;
          if (plan.supplier.has(key)) continue;
          open += 1;
          gifts.add(giftId);
        }
        return open === 0 || open !== gifts.size ? null : { g, gifts: [...gifts] };
      })
      .filter((option): option is { g: number; gifts: number[] } => option !== null)
      .sort((a, b) => a.gifts.length - b.gifts.length || a.g - b.g);
    for (const { gifts } of options) {
      const packs = gifts.map(observationPack);
      if (packs.length > left) continue;
      if (!gifts.every((giftId) => groups.some((group) => group.packs.includes(observationPack(giftId)))))
        continue;
      if (packs.some((packId) => withSlots.has(packId))) continue;
      for (const packId of packs) withSlots.add(packId);
      left -= packs.length;
    }
    const observed = score(withSlots, reserved);
    return compareSeeds(observed, plan) < 0 ? observed : plan;
  };

  let seedPlan: Seed | null = null;
  if (input.seed !== false) {
    // M84: the pack that supplies the most copies still missing, while the packs taken fit.
    {
      const have = new Array<number>(groups.length).fill(0);
      const picked = new Set<number>();
      const undos: [number, number | undefined][][] = [];
      const left = [...groupPacks];
      for (;;) {
        let pick = -1;
        let gain = 0;
        for (const packId of left) {
          if (picked.has(packId)) continue;
          let g = 0;
          for (const group of groupsOfPack.get(packId)!) {
            if (have[group]! < groups[group]!.copies.length)
              g += groups[group]!.required ? groups.length + 1 : 1;
          }
          if (g > gain) {
            gain = g;
            pick = packId;
          }
        }
        if (pick < 0) break;
        const undo: [number, number | undefined][] = [];
        if (augment(pick, undo)) {
          picked.add(pick);
          undos.push(undo);
          for (const group of groupsOfPack.get(pick)!) have[group] = have[group]! + 1;
        } else {
          restore(undo);
          left.splice(left.indexOf(pick), 1);
        }
      }
      for (let i = undos.length - 1; i >= 0; i -= 1) restore(undos[i]!);
      seedPlan = observeFor(picked, new Map());
    }
    // M87: complete one goal at a time, the one needing the fewest new packs (required ones first).
    if (goalInput) {
      const picked = new Set<number>();
      const undos: [number, number | undefined][][] = [];
      /** candidate -> the pack reserved for it. */
      const reserved = new Map<number, number>();
      const usedFor = groups.map(() => new Set<number>());
      const done = new Array<boolean>(goalIds.length).fill(false);
      const hopeless = new Array<boolean>(goalIds.length).fill(false);
      /** What completing goal `g` takes: the copies to reserve and the new packs, or null. */
      const plan = (g: number): { take: [number, number][]; fresh: number[] } | null => {
        const open = copiesOfGoal[g]!.filter((k) => !reserved.has(k));
        const take: [number, number][] = [];
        const fresh: number[] = [];
        const claim = new Map<number, Set<number>>();
        const claimed = (group: number): Set<number> => {
          let set = claim.get(group);
          if (!set) claim.set(group, (set = new Set()));
          return set;
        };
        const waiting: number[] = [];
        for (const k of open) {
          const group = groupOf[k]!;
          const packId = groups[group]!.packs.find(
            (p) => picked.has(p) && !usedFor[group]!.has(p) && !claimed(group).has(p),
          );
          if (packId === undefined) waiting.push(k);
          else {
            claimed(group).add(packId);
            take.push([k, packId]);
          }
        }
        // Cover the rest with new packs, the one serving the most of them first.
        while (waiting.length > 0) {
          const counts = new Map<number, number>();
          for (const k of waiting) {
            const group = groupOf[k]!;
            for (const p of groups[group]!.packs) {
              if (isObservation(p) || picked.has(p) || usedFor[group]!.has(p) || claimed(group).has(p))
                continue;
              counts.set(p, (counts.get(p) ?? 0) + 1);
            }
          }
          let pick = -1;
          let most = 0;
          for (const [p, count] of [...counts].sort((a, b) => a[0] - b[0])) {
            if (count > most) {
              most = count;
              pick = p;
            }
          }
          if (pick < 0) return null;
          fresh.push(pick);
          for (let i = waiting.length - 1; i >= 0; i -= 1) {
            const k = waiting[i]!;
            const group = groupOf[k]!;
            if (!groups[group]!.packs.includes(pick) || claimed(group).has(pick)) continue;
            claimed(group).add(pick);
            take.push([k, pick]);
            waiting.splice(i, 1);
          }
        }
        return { take, fresh };
      };
      for (;;) {
        let pick: { g: number; take: [number, number][]; fresh: number[] } | null = null;
        for (let g = 0; g < goalIds.length; g += 1) {
          if (done[g] || hopeless[g]) continue;
          const option = plan(g);
          if (!option) {
            hopeless[g] = true;
            continue;
          }
          if (
            pick === null ||
            Number(goalRequired[g]) - Number(goalRequired[pick.g]) > 0 ||
            (goalRequired[g] === goalRequired[pick.g] &&
              (option.fresh.length - pick.fresh.length || option.take.length - pick.take.length) < 0)
          )
            pick = { g, ...option };
        }
        if (pick === null) break;
        const undo: [number, number | undefined][] = [];
        const added: number[] = [];
        let fits = true;
        for (const packId of pick.fresh) {
          if (!augment(packId, undo)) {
            fits = false;
            break;
          }
          added.push(packId);
        }
        if (!fits) {
          restore(undo);
          hopeless[pick.g] = true;
          continue;
        }
        undos.push(undo);
        for (const packId of added) picked.add(packId);
        for (const [k, packId] of pick.take) {
          reserved.set(k, packId);
          usedFor[groupOf[k]!]!.add(packId);
        }
        done[pick.g] = true;
        // Goals this completed on the way.
        for (let g = 0; g < goalIds.length; g += 1)
          if (!done[g] && copiesOfGoal[g]!.every((k) => reserved.has(k))) done[g] = true;
      }
      for (let i = undos.length - 1; i >= 0; i -= 1) restore(undos[i]!);
      const goalSeed = observeFor(picked, reserved);
      if (!seedPlan || compareSeeds(goalSeed, seedPlan) < 0) seedPlan = goalSeed;
    }
  }

  /*
   * The root bound: the worst window's excess (M82's bound with nothing chosen), and — when that
   * does not already prove the seed — the linear relaxation of the whole board (M84, by goals since
   * M87). The window bound counts only gifts with pairwise disjoint packs; on large boards most
   * gifts share packs with others and it falls well short.
   *
   * Relaxation: x_p ∈ [0, 1] per pack, and per goal g ∈ [0, 1] at most the supply of each of its
   * copies — Σ x_p over the copy's packs for a gift with one copy, else a share y_c ≤ 1 of the
   * gift's Σ x_p, which all its copies split. Every window holds Σ x_p ≤ floors. Every plan is a
   * solution, so no plan keeps more goals than the optimum, and none loses fewer than the goals
   * less that.
   *
   * By copies this relaxation was exact on every board measured (M84). By goals it is not: a goal
   * that needs two packs is half kept by half of each, and fusion goals need several, so on boards
   * with many fusions it promises a few goals too many. When it does not prove the best plan, a
   * branch and bound on the packs (`branchAndBound`) closes the gap.
   */
  let relaxations = 0;
  const P = groupPacks.length;
  const column = new Map(groupPacks.map((packId, j) => [packId, j]));
  /** The copies that take a share of their gift's supply: those of a gift with several that serve goals. */
  const shared = new Set<number>();
  groups.forEach((group) => {
    const serving = group.copies.filter((k) => rootsOf[k]!.length > 0);
    if (serving.length > 1) for (const k of serving) shared.add(k);
  });
  const sharedList = [...shared].sort((a, b) => a - b);
  const shareIndex = new Map(sharedList.map((k, i) => [k, i]));
  /*
   * The relaxation as one tableau: a column per pack (x), per shared copy (y) and per goal (g),
   * every one in [0, 1]. Rows: each gift's shares within its packs, each goal within each copy's
   * supply, each window within its floors, the observations within their slots. The branch and
   * bound fixes columns of a solved copy and solves on from there (`Tableau.fix`).
   */
  const Y = sharedList.length;
  const goalColumn = (g: number): number => P + Y + g;
  const relaxation = (): Tableau => {
    const width = P + Y + goalIds.length;
    const c = new Array<number>(width).fill(0);
    for (let g = 0; g < goalIds.length; g += 1) c[goalColumn(g)] = 1;
    const rows: number[][] = [];
    const b: number[] = [];
    const row = (): number[] => new Array<number>(width).fill(0);
    for (const group of groups) {
      const shares = group.copies.filter((k) => shared.has(k));
      if (shares.length === 0) continue;
      const sum = row();
      for (const k of shares) sum[P + shareIndex.get(k)!] = 1;
      for (const packId of group.packs) sum[column.get(packId)!] = -1;
      rows.push(sum);
      b.push(0);
    }
    for (let g = 0; g < goalIds.length; g += 1) {
      for (const k of copiesOfGoal[g]!) {
        const link = row();
        link[goalColumn(g)] = 1;
        const share = shareIndex.get(k);
        if (share !== undefined) link[P + share] = -1;
        else for (const packId of candidates[k]!.packs) link[column.get(packId)!] = -1;
        rows.push(link);
        b.push(0);
      }
    }
    for (const { mask, cap } of windows) {
      const fit = row();
      groupPacks.forEach((packId, j) => {
        if ((mask >> classify(packId)) & 1) fit[j] = 1;
      });
      rows.push(fit);
      b.push(cap);
    }
    if (observeSlots > 0) {
      const fit = row();
      groupPacks.forEach((packId, j) => {
        if (isObservation(packId)) fit[j] = 1;
      });
      rows.push(fit);
      b.push(observeSlots);
    }
    return Tableau.build(c, rows, b, new Array<number>(width).fill(1));
  };

  /**
   * The best goals a fixed set of packs keeps. Only a gift with fewer of the packs than copies has
   * a choice to make — which copies go without — and those few choices are tried in full (up to
   * `EXACT_CHOICES`, past which the greedy `score` stands in).
   */
  const scoreExactly = (picked: ReadonlySet<number>): Seed => {
    const short: { copies: number[]; packs: number[] }[] = [];
    groups.forEach((group) => {
      const packs = group.packs.filter((packId) => picked.has(packId));
      const serving = group.copies.filter((k) => rootsOf[k]!.length > 0);
      if (serving.length > packs.length && packs.length > 0) short.push({ copies: serving, packs });
    });
    let best = score(picked, new Map());
    const choose = (n: number, k: number): number =>
      k === 0 || k === n ? 1 : choose(n - 1, k - 1) + choose(n - 1, k);
    if (
      short.length === 0 ||
      short.reduce((product, s) => product * choose(s.copies.length, s.packs.length), 1) > EXACT_CHOICES
    )
      return best;
    const reserved = new Map<number, number>();
    const walk = (i: number): void => {
      if (i === short.length) {
        const tried = score(picked, reserved);
        if (compareSeeds(tried, best) < 0) best = tried;
        return;
      }
      const { copies, packs } = short[i]!;
      const pick = (from: number, taken: number): void => {
        if (taken === packs.length) {
          walk(i + 1);
          return;
        }
        for (let at = from; at <= copies.length - (packs.length - taken); at += 1) {
          reserved.set(copies[at]!, packs[taken]!);
          pick(at + 1, taken + 1);
          reserved.delete(copies[at]!);
        }
      };
      pick(0, 0);
    };
    walk(0);
    return best;
  };

  /**
   * Branch and bound on the packs (M87), when the relaxation does not prove the best plan: fix the
   * most fractional pack in, then out, and drop every subtree whose relaxation cannot keep more
   * goals than the best plan found. A subtree whose relaxation picks whole packs is settled by
   * `scoreExactly` on them — unless a gift with fewer packs than copies splits its packs between
   * the copies, which keeps half of two goals where a whole plan keeps one. Then the gift's packs
   * are fixed one by one, and once they all are, which copies get them (a share fixed to 1 or 0).
   * Returns the best plan it found that beats `kept` goals (null for none), and whether it searched
   * the whole tree — then no plan keeps more, which proves the bound.
   */
  const branchAndBound = (root: Tableau, kept: number): { plan: Seed | null; proven: boolean } => {
    let bar = kept;
    let found: Seed | null = null;
    let proven = true;
    const before = relaxations;
    const fractional = (v: number): boolean => v > 1e-6 && v < 1 - 1e-6;
    /** A node: its parent's solved relaxation, and the one column the node fixes on top. */
    type Node = {
      parent: Tableau;
      fixed: Int8Array;
      shares: Int8Array;
      column: number;
      value: number;
      /** Solved already, while choosing the column to branch on. */
      solved?: { lp: Tableau; status: 'optimal' | 'infeasible' | null };
    };
    /** The child of `lp` with `column` fixed to `value`, solved. */
    const child = (
      lp: Tableau,
      column: number,
      value: number,
    ): { lp: Tableau; status: 'optimal' | 'infeasible' | null } => {
      relaxations += 1;
      const next = lp.clone();
      next.fix(column, value);
      return { lp: next, status: next.resolve(LP_PIVOTS) };
    };
    const stack: Node[] = [];
    const solve = (lp: Tableau): { value: number; x: Float64Array; shares: Float64Array } => {
      const point = lp.point();
      return { value: lp.value(), x: point.subarray(0, P), shares: point.subarray(P, P + Y) };
    };
    let pending: { lp: Tableau; fixed: Int8Array; shares: Int8Array } | null = {
      lp: root,
      fixed: new Int8Array(P).fill(-1),
      shares: new Int8Array(Y).fill(-1),
    };
    while (pending || stack.length > 0) {
      if (relaxations - before >= (input.branchNodes ?? BRANCH_NODES)) return { plan: found, proven: false };
      let lp: Tableau;
      let fixed: Int8Array;
      let shares: Int8Array;
      if (pending) {
        ({ lp, fixed, shares } = pending);
        pending = null;
      } else {
        const next = stack.pop()!;
        // Siblings share their arrays, and reduced-cost fixing below writes to them.
        fixed = Int8Array.from(next.fixed);
        shares = Int8Array.from(next.shares);
        const done = next.solved ?? child(next.parent, next.column, next.value);
        lp = done.lp;
        const status = done.status;
        if (status === 'infeasible') continue;
        if (status === null) {
          proven = false;
          continue;
        }
      }
      const node = solve(lp);
      /*
       * Reduced-cost fixing: moving a column off its bound lowers the relaxation by at least its
       * reduced cost, so a column whose cost alone takes the bound below the next whole goal stays
       * where it is in this whole subtree. Fixing it where it stands changes nothing here and saves
       * the branches that would try it.
       */
      if (Math.floor(node.value + 1e-6) > bar) {
        for (let j = 0; j < P + Y; j += 1) {
          const off = lp.nonbasic(j);
          if (!off || node.value - off.cost >= bar + 1 - 1e-6) continue;
          if (j < P ? fixed[j] !== -1 : shares[j - P] !== -1) continue;
          if (j < P) fixed[j] = off.at;
          else shares[j - P] = off.at;
          lp.fix(j, off.at);
        }
      }
      if (Math.floor(node.value + 1e-6) <= bar) continue;
      let split = -1;
      /** Free fractional packs, most fractional first. */
      const candidatesFor: number[] = [];
      for (let j = 0; j < P; j += 1) if (fixed[j] === -1 && fractional(node.x[j]!)) candidatesFor.push(j);
      candidatesFor.sort((a, b) => Math.abs(node.x[a]! - 0.5) - Math.abs(node.x[b]! - 0.5) || a - b);
      if (candidatesFor.length > 0) split = candidatesFor[0]!;
      let splitShare = -1;
      if (split < 0) {
        const picked = new Set<number>();
        for (let j = 0; j < P; j += 1) if (node.x[j]! > 0.5) picked.add(groupPacks[j]!);
        let plan = cheapestPlacement([...picked].filter((packId) => !isObservation(packId)))
          ? scoreExactly(picked)
          : null;
        // The relaxation's own split, when whole, is a plan on these packs too — and the one to
        // take when there are too many splits for `scoreExactly` to try.
        if (plan && !sharedList.some((_, i) => fractional(node.shares[i]!))) {
          const reserved = new Map<number, number>();
          for (const group of groups) {
            const packs = group.packs.filter((packId) => picked.has(packId));
            let next = 0;
            for (const k of group.copies) {
              const i = shareIndex.get(k);
              if (i !== undefined && node.shares[i]! > 0.5 && next < packs.length)
                reserved.set(k, packs[next++]!);
            }
          }
          const split = score(picked, reserved);
          if (compareSeeds(split, plan) < 0) plan = split;
        }
        const keeps = plan && plan.missedRequired === 0 ? goalIds.length - plan.missedOptional : -1;
        if (plan && keeps > bar) {
          bar = keeps;
          found = plan;
        }
        if (Math.floor(node.value + 1e-6) <= bar) continue;
        // Whole packs, but some gift splits its packs between its copies.
        const splitGroups = new Set<number>();
        sharedList.forEach((k, i) => {
          if (fractional(node.shares[i]!)) splitGroups.add(groupOf[k]!);
        });
        for (const g of [...splitGroups].sort((a, b) => a - b)) {
          for (const packId of groups[g]!.packs) {
            const j = column.get(packId)!;
            if (fixed[j] === -1 && (split < 0 || j < split)) split = j;
          }
        }
        if (split < 0) {
          sharedList.forEach((_, i) => {
            if (splitShare < 0 && shares[i] === -1 && fractional(node.shares[i]!)) splitShare = i;
          });
          if (splitShare < 0) {
            proven = false;
            continue;
          }
        }
      }
      if (split >= 0) {
        /*
         * Strong branching: of the most fractional packs, split on the one whose two children
         * lower the bound the most (the product of the drops), solving both — the children are
         * kept, so the winner's cost nothing more. Most fractional alone needed thousands of
         * relaxations on boards a few dozen settle this way.
         */
        let solvedChildren: [Node['solved'], Node['solved']] = [undefined, undefined];
        if (candidatesFor.length > 1) {
          let bestScore = -1;
          for (const j of candidatesFor.slice(0, STRONG_BRANCH)) {
            const zero = child(lp, j, 0);
            const one = child(lp, j, 1);
            const drop = (side: { lp: Tableau; status: string | null }): number =>
              side.status === 'optimal' ? Math.max(node.value - side.lp.value(), 1e-6) : node.value;
            const score = drop(zero) * drop(one);
            if (score > bestScore) {
              bestScore = score;
              split = j;
              solvedChildren = [zero, one];
            }
          }
        }
        const out = Int8Array.from(fixed);
        out[split] = 0;
        const into = Int8Array.from(fixed);
        into[split] = 1;
        stack.push(
          { parent: lp, fixed: out, shares, column: split, value: 0, solved: solvedChildren[0] },
          { parent: lp, fixed: into, shares, column: split, value: 1, solved: solvedChildren[1] },
        );
      } else {
        const out = Int8Array.from(shares);
        out[splitShare] = 0;
        const into = Int8Array.from(shares);
        into[splitShare] = 1;
        stack.push(
          { parent: lp, fixed, shares: out, column: P + splitShare, value: 0 },
          { parent: lp, fixed, shares: into, column: P + splitShare, value: 1 },
        );
      }
    }
    return { plan: found, proven };
  };

  const beatsBest = (plan: Seed): boolean =>
    (plan.missedRequired - best.missedRequired ||
      plan.missedOptional - best.missedOptional ||
      plan.missedCopies - best.missedCopies ||
      settled.size + plan.packs.size - best.packCount) < 0;
  const adopt = (plan: Seed): boolean => {
    const placement = cheapestPlacement([...plan.packs]);
    if (!placement) return false;
    seeded = true;
    best.missedRequired = plan.missedRequired;
    best.missedOptional = plan.missedOptional;
    best.missedCopies = plan.missedCopies;
    best.packCount = settled.size + plan.packs.size;
    best.floorSum = [...placement.keys()].reduce((sum, floor) => sum + floor, 0);
    best.placement = placement;
    best.supplierPack = plan.supplier;
    best.missed = plan.missed;
    best.abandoned = plan.abandoned;
    best.missedPacks = plan.missedPacks;
    best.lost = plan.lost;
    return true;
  };

  if (seedPlan) adopt(seedPlan);

  if (useBound) {
    for (let w = 0; w < windows.length; w += 1)
      rootBound = Math.max(rootBound, windowGoals(windowNeed(w, 0) - windowRoom(w)));
    if (best.missedRequired === 0 && best.missedOptional > rootBound) {
      relaxations += 1;
      const root = relaxation();
      if (root.resolve(LP_PIVOTS) === 'optimal') {
        rootBound = Math.max(rootBound, goalIds.length - Math.floor(root.value() + 1e-6));
        if (best.missedOptional > rootBound && input.branch !== false) {
          const { plan, proven } = branchAndBound(root, goalIds.length - best.missedOptional);
          if (plan && beatsBest(plan)) adopt(plan);
          if (proven) rootBound = Math.max(rootBound, best.missedOptional);
        }
      }
    }
  }

  if (best.missedRequired === 0 && best.missedOptional <= rootBound) provenAt = 0;

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
  const byGift = (a: string, b: string): number =>
    (giftOfKey.get(a) ?? Number(a.split(':')[0])) - (giftOfKey.get(b) ?? Number(b.split(':')[0])) ||
    a.localeCompare(b, 'en');
  const missedKeys = [...unresolvedKeys, ...best.missed].sort(byGift);
  const lostGoals = goalInput
    ? [...new Set([...lostBefore].filter((goal) => !(goalInput.lost?.has(goal) ?? false)).concat(best.lost))]
    : [];

  return {
    assignment,
    supplier,
    unresolvedGiftIds: missedKeys.map((key) => giftOfKey.get(key) ?? Number(key.split(':')[0])),
    unresolvedKeys: missedKeys,
    abandonedKeys: [...best.abandoned].sort(byGift),
    observedKeys: [...best.supplierPack]
      .filter(([, packId]) => isObservation(packId))
      .map(([key]) => key)
      .sort(byGift),
    lostGoals: lostGoals.sort((a, b) => a - b),
    unplacedPacks: [...unplacedPacks, ...best.missedPacks].sort((a, b) => a - b),
    nodes,
    relaxations,
    capped,
    tieBreakCut,
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
