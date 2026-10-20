/**
 * Pack conflicts: which goals a plan loses to them, and which floors they fight over. The decision
 * card names the contested floors (`conflictGroups`); the drop analysis and the resolutions start
 * from the same goals (`wantedRoots`) and the same floors (`contestedFloors`).
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanInput, PlanOptions, RoutePlan } from './types.ts';
import { analyseDeck } from './deck.ts';
import { normaliseOptions, runStateOf } from './options.ts';
import { expandRequirements, goalRoots } from './requirements.ts';
import { modeForFloor } from './search.ts';

/**
 * Map a gift back to the wanted gift(s) it serves: a wanted gift is its own root, and a fusion
 * ingredient serves every wanted result above it, however deep (`goalRoots` — the search counts
 * goals in the same unit since M87).
 *
 * The recipes are expanded the way `planRoute` expands them — normalised options and the run's
 * state — because the run changes the tree: a fusion result in hand needs none of its ingredients.
 * Expanding without it made an owned result the root of an ingredient another goal still needs, so
 * a goal already in hand was counted as lost to the conflict (M154).
 */
export function wantedRoots(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
): (giftId: number) => number[] {
  const { options } = normaliseOptions(input.options, data, indexes, input.deck);
  const stats = analyseDeck(input.deck, indexes, data.rules.deployment, options.deployed);
  const { fusions } = expandRequirements(
    input.wanted,
    indexes,
    stats,
    data.rules.fusion.maxShopSlots,
    runStateOf(options),
  );
  return goalRoots(input.wanted, fusions).ofGift;
}

/**
 * `wantedRoots` once per goal set (M160). One analysis plans the same deck and run many times with
 * goals left out or pins released, and the roots depend on the goals alone — neither a pin nor a
 * goal's `required` flag changes which wanted gift an ingredient feeds — so the expansion is made
 * once per distinct goal list. Only for inputs that differ in those two ways: a different deck or
 * run needs a memo of its own.
 */
export function wantedRootsMemo(
  data: GameData,
  indexes: GameIndexes,
): (input: PlanInput) => (giftId: number) => number[] {
  const memo = new Map<string, (giftId: number) => number[]>();
  return (input) => {
    const key = input.wanted.map((w) => w.giftId).join(',');
    let roots = memo.get(key);
    if (!roots) {
      roots = wantedRoots(input, data, indexes);
      memo.set(key, roots);
    }
    return roots;
  };
}

/**
 * The goals a plan loses to the conflict, ingredients mapped to the goal they feed. A copy lost
 * as `ingredient-shared` counts for the fusion it actually starved — the goal that is itself
 * unresolved — not for every fusion that eats the ingredient (one copy was planned for another).
 *
 * `input` is the input `plan` was made from: a plan with a goal left out is measured against the
 * goals it still has, or the roots would map an ingredient to a goal that is no longer there. A
 * caller that has the roots of that input already passes them as `roots`.
 */
export function conflictRootsOf(
  plan: RoutePlan,
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  roots?: (giftId: number) => number[],
): number[] {
  const conflicts = plan.unresolved.filter(
    (u) => u.reason === 'pack-conflict' || u.reason === 'ingredient-shared',
  );
  if (conflicts.length === 0) return [];
  const rootsOf = roots ?? wantedRoots(input, data, indexes);
  const unresolved = new Set(plan.unresolved.map((u) => u.giftId));
  return [
    ...new Set(
      conflicts.flatMap((u) =>
        u.reason === 'pack-conflict' ? rootsOf(u.giftId) : rootsOf(u.giftId).filter((r) => unresolved.has(r)),
      ),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Floors a `pack-conflict` gift's pack could have taken, honouring pack entries and bans: offered
 * there in that floor's mode, and — on a played floor — the pack actually taken.
 */
export function contestedFloors(plan: RoutePlan, options: PlanOptions, indexes: GameIndexes): Set<number> {
  const banned = new Set(options.bannedPacks);
  const contested = new Set<number>();
  for (const u of plan.unresolved) {
    if (u.reason !== 'pack-conflict') continue;
    const packs = (indexes.packsByGift.get(u.giftId) ?? []).filter((id) => !banned.has(id));
    for (const floor of plan.floors) {
      const offered =
        indexes.packsByFloor[modeForFloor(floor.floor, options, indexes)].get(floor.floor) ?? [];
      const pinned = options.pinnedPacks[floor.floor];
      if (packs.some((id) => offered.includes(id) && (pinned === undefined || pinned === id)))
        contested.add(floor.floor);
    }
  }
  return contested;
}

export interface ConflictGroup {
  /** Contiguous contested floors. */
  floors: number[];
}

/** The contested floors, in runs of contiguous floors: the chips on the decision card. */
export function conflictGroups(plan: RoutePlan, options: PlanOptions, indexes: GameIndexes): ConflictGroup[] {
  const groups: ConflictGroup[] = [];
  for (const floor of [...contestedFloors(plan, options, indexes)].sort((a, b) => a - b)) {
    const last = groups[groups.length - 1]?.floors;
    if (last && last[last.length - 1] === floor - 1) last.push(floor);
    else groups.push({ floors: [floor] });
  }
  return groups;
}
