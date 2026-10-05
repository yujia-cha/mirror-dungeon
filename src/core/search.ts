import { maximizeLp } from './lp.ts';
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
  /** Start from the greedy seed (below). On unless set to false; tests compare the two. */
  seed?: boolean;
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
   * How many of window `w`'s gifts from candidate `index` on still need a pack of their own: the
   * open ones whose packs are pairwise disjoint.
   */
  const claimed = new Set<number>();
  const windowNeed = (w: number, index: number): number => {
    let need = 0;
    claimed.clear();
    for (const { candidate, k } of inside[w]!) {
      if (k < index) continue;
      if (candidate.packs.some((packId) => chosenPacks.has(packId) || claimed.has(packId))) continue;
      need += 1;
      for (const packId of candidate.packs) claimed.add(packId);
    }
    return need;
  };
  /** The floors of window `w` the chosen packs leave free. */
  const windowRoom = (w: number): number => {
    const { mask, cap } = windows[w]!;
    let room = cap;
    for (const packId of chosen) if ((mask >> classify(packId)) & 1) room -= 1;
    return room;
  };

  /**
   * Whether the gifts from candidate `index` on are bound to miss more than `slack` more — the room
   * this branch has left before it is no better than the best plan. Stops at the first window that
   * shows it.
   */
  const boundExceeds = (index: number, slack: number): boolean => {
    for (let w = 0; w < windows.length; w += 1) {
      const room = windowRoom(w);
      // Not enough gifts left in here to overflow it, whatever they are.
      if (inside[w]!.length - room <= slack) continue;
      if (windowNeed(w, index) - room > slack) return true;
    }
    return false;
  };

  /**
   * The fewest misses any plan can have, computed before the DFS (below). Once the best plan's
   * misses reach it they are optimal, and the rest of the search only breaks ties on packs and
   * floors — which `tieBreakNodes` caps (M83).
   */
  let rootBound = 0;

  /** Lexicographic order: required misses, then optional misses, then packs, then floors. */
  const beatenAlready = (packCount: number): boolean => {
    if (missedRequired !== best.missedRequired) return missedRequired > best.missedRequired;
    if (missedOptional !== best.missedOptional) return missedOptional > best.missedOptional;
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
      packCount === best.packCount;
    if (tied && (seeded ? floorSum > best.floorSum : floorSum >= best.floorSum)) return;
    seeded = false;
    best.missedRequired = missedRequired;
    best.missedOptional = missedOptional;
    best.packCount = packCount;
    best.floorSum = floorSum;
    best.placement = placement;
    best.supplierPack = new Map(supplierPack);
    best.missed = [...missed];
    best.missedPacks = [...missedPacks];
    // A required miss could still be traded for optional ones, so only a plan missing optional
    // goals alone is proven by the bound, which counts both.
    if (provenAt === null && missedRequired === 0 && missedOptional <= rootBound) provenAt = nodes;
  };

  /**
   * Dominance (M84). A copy that a chosen pack can supply takes one: a new pack instead, or a miss,
   * ends with the same packs or worse, and the DFS tries the chosen packs first, so it has met that
   * plan already. And among new packs no later candidate lists, only the window matters — they
   * supply nothing else — so one per window class is enough.
   */
  const lastUse = new Map<number, number>();
  /** No later copy of the same gift: any chosen pack serves this one alike, so the first will do. */
  const lastCopy: boolean[] = [];
  const copyAfter = new Set<number>();
  for (let k = candidates.length - 1; k >= 0; k -= 1) {
    const { giftId } = candidates[k]!;
    lastCopy[k] = giftId === null || !copyAfter.has(giftId);
    if (giftId !== null) copyAfter.add(giftId);
  }
  candidates.forEach((candidate, k) => {
    for (const packId of candidate.packs) lastUse.set(packId, k);
  });
  const freshClasses = new Set<number>();

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
     * descends — misses are never taken back, packs are never dropped — so a partial plan already
     * worse on an earlier term can never recover.
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
    if (reuse.length > 0) return;

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

  /*
   * What to supply, per gift: its copies share one pack list and each needs a pack of its own, so a
   * gift with n copies is covered n times at most, once per chosen pack it lists. A preferred pack
   * is a "gift" of its own with one copy.
   */
  const groups: { copies: number; required: boolean; packs: number[] }[] = [];
  {
    const groupOfGift = new Map<number, number>();
    for (const candidate of candidates) {
      if (candidate.freePack !== null) continue;
      const known = candidate.giftId === null ? undefined : groupOfGift.get(candidate.giftId);
      if (known !== undefined) {
        groups[known]!.copies += 1;
        continue;
      }
      if (candidate.giftId !== null) groupOfGift.set(candidate.giftId, groups.length);
      groups.push({ copies: 1, required: candidate.required, packs: candidate.packs });
    }
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

  /*
   * The greedy seed (M84): take the pack that supplies the most copies still missing, as long as the
   * packs taken still fit on distinct floors. The DFS meets the hard decisions — whether to give up
   * a gift only one pack supplies — first, and on a large board never gets back to them before the
   * node cap; this plan starts it from a good bar instead.
   */
  if (input.seed !== false) {
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
          if (have[group]! < groups[group]!.copies) g += groups[group]!.required ? groups.length + 1 : 1;
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

    // Hand each copy, in DFS order, a picked pack its gift has not used yet.
    const seedSupplier = new Map<string, number>();
    const seedMissed: string[] = [];
    const seedMissedPacks: number[] = [];
    const usedBy = new Map<number, Set<number>>();
    const usedPacks = new Set<number>();
    let seedRequired = 0;
    let seedOptional = 0;
    for (const candidate of candidates) {
      if (candidate.freePack !== null) continue;
      let used = candidate.giftId === null ? undefined : usedBy.get(candidate.giftId);
      if (!used) {
        used = new Set();
        if (candidate.giftId !== null) usedBy.set(candidate.giftId, used);
      }
      const packId = candidate.packs.find((p) => picked.has(p) && !used.has(p));
      if (packId !== undefined) {
        used.add(packId);
        usedPacks.add(packId);
        if (candidate.key !== null) seedSupplier.set(candidate.key, packId);
        continue;
      }
      if (candidate.giftId !== null) seedMissed.push(candidate.key!);
      else seedMissedPacks.push(candidate.packId!);
      if (candidate.required) seedRequired += 1;
      else seedOptional += 1;
    }
    const placement = cheapestPlacement([...usedPacks]);
    if (placement) {
      seeded = true;
      best.missedRequired = seedRequired;
      best.missedOptional = seedOptional;
      best.packCount = settled.size + usedPacks.size;
      best.floorSum = [...placement.keys()].reduce((sum, floor) => sum + floor, 0);
      best.placement = placement;
      best.supplierPack = seedSupplier;
      best.missed = seedMissed;
      best.missedPacks = seedMissedPacks;
    }
  }

  /*
   * The root bound: the worst window's excess (M82's bound with nothing chosen), and — when that
   * does not already prove the seed — the linear relaxation of the whole board (M84). The window
   * bound counts only gifts with pairwise disjoint packs; on large boards most gifts share packs
   * with others and it falls well short, while the relaxation is exact on every board measured.
   *
   * Relaxation: x_p ∈ [0, 1] per pack, cov_g per gift with cov_g ≤ copies and cov_g ≤ Σ x_p over
   * its packs, and Σ x_p ≤ floors for every window. Every plan is a solution, so no plan supplies
   * more copies than the optimum, and no plan misses fewer than the copies less that.
   */
  if (useBound) {
    for (let w = 0; w < windows.length; w += 1)
      rootBound = Math.max(rootBound, windowNeed(w, 0) - windowRoom(w));
    if (best.missedRequired === 0 && best.missedOptional > rootBound) {
      const P = groupPacks.length;
      const column = new Map(groupPacks.map((packId, j) => [packId, j]));
      const c = [...new Array<number>(P).fill(0), ...new Array<number>(groups.length).fill(1)];
      const rows: number[][] = [];
      const b: number[] = [];
      groups.forEach((group, g) => {
        const row = new Array<number>(P + groups.length).fill(0);
        row[P + g] = 1;
        for (const packId of group.packs) row[column.get(packId)!] = -1;
        rows.push(row);
        b.push(0);
        const cap = new Array<number>(P + groups.length).fill(0);
        cap[P + g] = 1;
        rows.push(cap);
        b.push(group.copies);
      });
      for (let j = 0; j < P; j += 1) {
        const row = new Array<number>(P + groups.length).fill(0);
        row[j] = 1;
        rows.push(row);
        b.push(1);
      }
      for (const { mask, cap } of windows) {
        const row = new Array<number>(P + groups.length).fill(0);
        groupPacks.forEach((packId, j) => {
          if ((mask >> classify(packId)) & 1) row[j] = 1;
        });
        rows.push(row);
        b.push(cap);
      }
      const supplied = maximizeLp(c, rows, b);
      if (supplied !== null) {
        const copies = groups.reduce((sum, group) => sum + group.copies, 0);
        rootBound = Math.max(rootBound, copies - Math.floor(supplied + 1e-6));
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
  const missedKeys = [...unresolvedKeys, ...best.missed].sort(
    (a, b) =>
      (giftOfKey.get(a) ?? Number(a.split(':')[0])) - (giftOfKey.get(b) ?? Number(b.split(':')[0])) ||
      a.localeCompare(b, 'en'),
  );

  return {
    assignment,
    supplier,
    unresolvedGiftIds: missedKeys.map((key) => giftOfKey.get(key) ?? Number(key.split(':')[0])),
    unresolvedKeys: missedKeys,
    unplacedPacks: [...unplacedPacks, ...best.missedPacks].sort((a, b) => a - b),
    nodes,
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
