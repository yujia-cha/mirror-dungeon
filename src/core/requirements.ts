import type { Gift } from './schema.ts';
import { msg } from './messages.ts';
import type { DeckStats, GameIndexes, Requirement, Unresolved, WantedGift } from './types.ts';

const MAX_FUSION_DEPTH = 4;

export interface ExpandResult {
  /** Flat list of gifts that must actually be obtained, fusion ingredients included. */
  requirements: Requirement[];
  /**
   * Fusions to perform, in dependency order (ingredients before results). One entry per copy of a
   * result: an intermediate two results eat is fused twice, from two sets of ingredients (M166).
   */
  fusions: { result: number; ingredients: number[] }[];
  /**
   * Per entry of `fusions`: which copy of its result it is (`copy`, 0 the first — the `copy` its
   * ingredients' requirements carry), and per ingredient the entry of `fusions` that makes it, or
   * null for one picked up (a requirement). A wanted result that another goal eats is one entry
   * that both the goal and the first fusion eating it read.
   */
  instances: { copy: number; made: (number | null)[] }[];
  unresolved: Unresolved[];
}

/**
 * What the run has settled so far. `owned` gifts are in hand. `failed` gifts were not marked as
 * obtained before the player left the floor of the pack that was to supply them — a miss on that
 * pack, not on the run: any other pack on a floor still ahead may supply them again. `visited` is
 * the packs taken on played floors, which cannot be entered a second time.
 */
export interface RunState {
  owned: Set<number>;
  failed: Set<number>;
  visited: Set<number>;
}

const EMPTY_RUN: RunState = { owned: new Set(), failed: new Set(), visited: new Set() };

/**
 * How hard a gift is to obtain, as a rough count of the opportunities to pick it up. Lower is
 * harder. Used to pick between alternative recipes and to rank observation candidates.
 */
export function scarcity(giftId: number, indexes: GameIndexes): number {
  const gift = indexes.giftById.get(giftId);
  if (!gift) return 0;
  if (indexes.freelyAvailableGifts.has(giftId)) return 1000;
  return indexes.packsByGift.get(giftId)?.length ?? 0;
}

/**
 * Pick the recipe the player can actually execute.
 *
 * The game gives most results two recipes: a short one using an intermediate fusion, and a longer
 * one that spells that intermediate out. The long one often needs more fusion slots than a normal
 * shop has, and the game's own hint is to fuse the sub-ingredient first — so a recipe that fits the
 * shop wins, then the one with fewer nested fusions, then the more widely available ingredients.
 *
 * Except when the intermediate is itself a goal (`goals`): then the short recipe that eats it wins
 * right after the shop check. The goal is fused once and consumed into this one — taking the long
 * recipe instead spelled its ingredients out a second time, so the route chased 해진 우산 and 깨진
 * 안경 twice for 생강꽃, 안경 그리고 전해진 편지 + 부치지 못한 편지.
 */
export function chooseRecipe(
  gift: Gift,
  indexes: GameIndexes,
  maxShopSlots: number,
  goals: ReadonlySet<number> = new Set(),
): number[] | null {
  const recipes = gift.fusion?.recipes ?? [];
  if (recipes.length === 0) return null;
  const scored = recipes.map((recipe) => {
    const nested = recipe.ingredients.filter(
      (id) => indexes.giftById.get(id)?.acquisition.kind === 'fusionOnly',
    ).length;
    const availability = recipe.ingredients.reduce((sum, id) => sum + scarcity(id, indexes), 0);
    const feedsGoal = recipe.ingredients.filter((id) => id !== gift.id && goals.has(id)).length;
    return {
      recipe,
      nested,
      availability,
      feedsGoal,
      fitsShop: recipe.ingredients.length <= maxShopSlots,
    };
  });
  scored.sort(
    (a, b) =>
      Number(b.fitsShop) - Number(a.fitsShop) ||
      b.feedsGoal - a.feedsGoal ||
      a.nested - b.nested ||
      b.availability - a.availability ||
      a.recipe.ingredients.length - b.recipe.ingredients.length ||
      // Ids and commas: ASCII, so a plain comparison orders them the same on every runtime.
      compareAscii(a.recipe.ingredients.join(','), b.recipe.ingredients.join(',')),
  );
  return scored[0]!.recipe.ingredients;
}

/**
 * The single cross-keyword recipe: any `aCount` of the seven keyword capstones plus all `bCount`
 * of the attack-type ones. Keyword gifts matching the deck come first.
 */
function chooseMixedIngredients(gift: Gift, indexes: GameIndexes, stats: DeckStats): number[] | null {
  const mixed = gift.fusion?.mixed;
  if (!mixed) return null;
  const deckKeywords = stats.keywordCounts.formation;
  const rankedA = [...mixed.aPool].sort((a, b) => {
    const ka = indexes.giftById.get(a)?.keyword;
    const kb = indexes.giftById.get(b)?.keyword;
    const na = ka && ka !== 'None' ? (deckKeywords[ka as keyof typeof deckKeywords] ?? 0) : 0;
    const nb = kb && kb !== 'None' ? (deckKeywords[kb as keyof typeof deckKeywords] ?? 0) : 0;
    return nb - na || scarcity(b, indexes) - scarcity(a, indexes) || a - b;
  });
  const rankedB = [...mixed.bPool].sort((a, b) => scarcity(b, indexes) - scarcity(a, indexes) || a - b);
  return [...rankedA.slice(0, mixed.aCount), ...rankedB.slice(0, mixed.bCount)].sort((a, b) => a - b);
}

/** ASCII strings compare the same on every runtime; `localeCompare` goes through the ICU tables. */
const compareAscii = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What identifies a requirement: the gift AND the fusion it feeds — and which copy of that fusion
 * (M166: an intermediate two results eat is fused twice, and each fusing needs ingredients of its
 * own; the second copy's keys carry `#1`, the first copy's keys are as they always were).
 *
 * Two fusions that eat the same ingredient are two requirements, not one, because the shop consumes
 * what it fuses. Every map that says where a gift comes from is keyed by this, never by the gift id
 * alone — the two copies come from two different floors, and one of them may not be gettable at all.
 */
export const requirementKey = (r: Pick<Requirement, 'giftId' | 'neededFor' | 'copy'>): string =>
  `${r.giftId}:${r.neededFor ?? 'direct'}${r.copy ? `#${r.copy}` : ''}`;

/**
 * The goals a gift or a requirement keeps alive (M87): every wanted gift up the fusion chain above
 * it, and the gift itself when it is wanted. A fusion that cannot happen loses every wanted result
 * it feeds, however deep, so this is the unit `coveredWanted` counts.
 *
 * With `instances`, a copy's goals are those above the one fusing it feeds (M166): an intermediate
 * fused once per result has its ingredients serve one result each, where by result id alone each
 * copy looked like it served every result — and the search, losing both goals with either copy,
 * gave up on both. Without `instances` the chain is followed by result id, which is the same
 * thing wherever every result is fused once.
 */
export function goalRoots(
  wanted: readonly Pick<WantedGift, 'giftId'>[],
  fusions: ExpandResult['fusions'],
  instances?: ExpandResult['instances'],
): {
  /** The wanted gifts at or above `giftId`, every fusing of it included. */
  ofGift: (giftId: number) => number[];
  /**
   * The goals one copy serves: its own gift when that is wanted, and everything at or above the
   * fusion it feeds. A wanted gift that another goal eats is two copies, and missing the eaten one
   * marks the gift itself unresolved too (`ingredient-shared` names the gift), so it counts here.
   */
  ofRequirement: (requirement: Pick<Requirement, 'giftId' | 'neededFor' | 'copy'>) => number[];
} {
  const wantedIds = new Set(wanted.map((w) => w.giftId));
  const parents = new Map<number, number[]>();
  for (const fusion of fusions) {
    for (const id of fusion.ingredients) parents.set(id, [...(parents.get(id) ?? []), fusion.result]);
  }
  const memo = new Map<number, number[]>();
  const ofGift = (giftId: number): number[] => {
    const known = memo.get(giftId);
    if (known) return known;
    memo.set(giftId, []); // a cycle in the recipe data ends here instead of recursing forever
    const out = new Set<number>(wantedIds.has(giftId) ? [giftId] : []);
    for (const parent of parents.get(giftId) ?? []) for (const id of ofGift(parent)) out.add(id);
    const sorted = [...out].sort((a, b) => a - b);
    memo.set(giftId, sorted);
    return sorted;
  };
  // Per fusion entry: the entries that eat it, and the entry of each (result, copy).
  const eaters: number[][] = fusions.map(() => []);
  const entryAt = new Map<string, number>();
  instances?.forEach(({ copy, made }, entry) => {
    entryAt.set(`${fusions[entry]!.result}#${copy}`, entry);
    for (const maker of made) if (maker !== null) eaters[maker]!.push(entry);
  });
  const entryMemo = new Map<number, number[]>();
  const ofEntry = (entry: number): number[] => {
    const known = entryMemo.get(entry);
    if (known) return known;
    entryMemo.set(entry, []);
    const result = fusions[entry]!.result;
    const out = new Set<number>(wantedIds.has(result) ? [result] : []);
    for (const eater of eaters[entry]!) for (const id of ofEntry(eater)) out.add(id);
    const sorted = [...out].sort((a, b) => a - b);
    entryMemo.set(entry, sorted);
    return sorted;
  };
  const ofRequirement = (requirement: Pick<Requirement, 'giftId' | 'neededFor' | 'copy'>): number[] => {
    const own = wantedIds.has(requirement.giftId) ? [requirement.giftId] : [];
    const entry =
      requirement.neededFor === null
        ? undefined
        : entryAt.get(`${requirement.neededFor}#${requirement.copy ?? 0}`);
    const above =
      requirement.neededFor === null
        ? []
        : entry === undefined
          ? ofGift(requirement.neededFor)
          : ofEntry(entry);
    return [...new Set([...own, ...above])].sort((a, b) => a - b);
  };
  return { ofGift, ofRequirement };
}

/**
 * Turn the wanted list into the gifts that must actually be picked up.
 *
 * A fusion result is not obtainable directly, so it is replaced by its ingredients (recursively).
 * Ingredients shared by two results are counted, because the shop consumes them — and so is an
 * intermediate fusion two results eat: it is fused once per result, each time from ingredients of
 * its own (M166; one expansion served both, so two fusions were scheduled off one copy). A goal
 * that is an ingredient of another goal is fused once on the way (`chooseRecipe` picks the recipe
 * that eats it), never routed twice: the goal and the first fusion eating it share that copy, and
 * a second fusion eating it gets a copy of its own.
 */
export function expandRequirements(
  wanted: WantedGift[],
  indexes: GameIndexes,
  stats: DeckStats,
  maxShopSlots: number,
  run: RunState = EMPTY_RUN,
): ExpandResult {
  const requirements = new Map<string, Requirement>();
  const fusions: ExpandResult['fusions'] = [];
  const instances: ExpandResult['instances'] = [];
  const unresolved: Unresolved[] = [];
  const goals = new Set(wanted.map((w) => w.giftId));
  /** The fusion entry that fills each ingredient slot (`requirementKey` of the result as an ingredient). */
  const entryOfSlot = new Map<string, number>();
  /** Copies made of each result so far. */
  const copiesOf = new Map<number, number>();
  /**
   * The entry a wanted result is made at, and whether a fusion eating it reads that same entry
   * already: the goal is fused once, on the way into the first fusion that eats it.
   */
  const directEntry = new Map<number, { entry: number; shared: boolean }>();
  /** Per fusion entry, every requirement key under it, nested fusions' included. */
  const keysOf: string[][] = [];
  /** The entries being built, outermost first: a key added now belongs to each of them. */
  const building: string[][] = [];

  const addRequirement = (
    giftId: number,
    required: boolean,
    neededFor: number | null,
    copy: number,
    via: Requirement['via'] = 'route',
  ): void => {
    const key = requirementKey({ giftId, neededFor, copy });
    for (const keys of building) keys.push(key);
    const existing = requirements.get(key);
    if (existing) {
      existing.required = existing.required || required;
      return;
    }
    // One entry per `requirementKey` — a gift needed by two fusions gets two keys, and each one is
    // a separate copy to find. A `count` field lived here for a while and was never read: the two
    // shares are two requirements, not one requirement of size two.
    requirements.set(key, { giftId, required, neededFor, ...(copy > 0 ? { copy } : {}), via });
  };

  /** A fusion entry read again (by its goal, or by the goal's first eater) takes on `required`. */
  const reuse = (entry: number, required: boolean): number => {
    if (required) for (const key of keysOf[entry]!) requirements.get(key)!.required = true;
    // Read from inside another entry being built, its keys are under that entry too.
    for (const keys of building) keys.push(...keysOf[entry]!);
    return entry;
  };

  /**
   * Routes `giftId` as an ingredient of `neededFor`'s `copy`-th fusion (or as a goal, `neededFor`
   * null). Returns the fusion entry that makes it, null when it is picked up or cannot be had.
   */
  const visit = (
    giftId: number,
    required: boolean,
    neededFor: number | null,
    copy: number,
    depth: number,
  ): number | null => {
    const gift = indexes.giftById.get(giftId);
    if (!gift) {
      unresolved.push({
        giftId,
        reason: 'not-obtainable',
        detail: msg('unresolved.notInData'),
      });
      return null;
    }

    const isFusion = gift.acquisition.kind === 'fusionOnly' || Boolean(gift.fusion);

    // Run progress settles a gift before any routing. One in hand needs no route (a fusion result
    // in hand needs none of its ingredients). One missed on a played floor is only lost when no
    // pack the player has not yet taken carries it: a pack-bound gift whose every pack was visited,
    // or a fusion result (never re-planned). Anything else is routed again from the floors ahead —
    // the search never re-enters a visited pack, so a second copy has to come from elsewhere.
    if (run.owned.has(giftId)) {
      addRequirement(giftId, required, neededFor, copy, 'owned');
      return null;
    }
    if (run.failed.has(giftId)) {
      const packBound = gift.acquisition.exclusiveTo.length > 0 || gift.acquisition.clearRewardOf !== null;
      const elsewhere = (indexes.packsByGift.get(giftId) ?? []).some((packId) => !run.visited.has(packId));
      if (isFusion || (packBound && !elsewhere)) {
        addRequirement(giftId, required, neededFor, copy, 'unresolved');
        unresolved.push({
          giftId,
          reason: 'failed',
          detail: msg('unresolved.failed'),
        });
        return null;
      }
    }

    if (!isFusion) {
      addRequirement(giftId, required, neededFor, copy);
      return null;
    }

    // The slot this fusion fills. One already filled is read again, never fused again.
    const slot = requirementKey({ giftId, neededFor, copy });
    const filled = entryOfSlot.get(slot);
    if (filled !== undefined) return reuse(filled, required);
    const direct = directEntry.get(giftId);
    if (neededFor === null && direct) {
      // The goal, visited after the fusion that eats it (ids order the visits).
      entryOfSlot.set(slot, direct.entry);
      return reuse(direct.entry, required);
    }
    if (neededFor !== null && goals.has(giftId) && direct && !direct.shared) {
      // The first fusion eating a goal made already: the one copy serves both.
      direct.shared = true;
      entryOfSlot.set(slot, direct.entry);
      return reuse(direct.entry, required);
    }

    if (depth >= MAX_FUSION_DEPTH) {
      unresolved.push({
        giftId,
        reason: 'fusion-ingredient-unresolved',
        detail: msg('unresolved.fusionTooDeep'),
      });
      return null;
    }

    const ingredients =
      chooseRecipe(gift, indexes, maxShopSlots, goals) ?? chooseMixedIngredients(gift, indexes, stats);
    if (!ingredients || ingredients.length === 0) {
      unresolved.push({
        giftId,
        reason: 'fusion-ingredient-unresolved',
        detail: msg('unresolved.noRecipe'),
      });
      return null;
    }

    const own = copiesOf.get(giftId) ?? 0;
    copiesOf.set(giftId, own + 1);
    const keys: string[] = [];
    building.push(keys);
    // Ingredients are visited first so nested fusions land earlier in the list.
    const made = ingredients.map((ingredient) => visit(ingredient, required, giftId, own, depth + 1));
    building.pop();
    const entry = fusions.length;
    fusions.push({ result: giftId, ingredients });
    instances.push({ copy: own, made });
    keysOf.push(keys);
    entryOfSlot.set(slot, entry);
    // A goal is made once: the goal itself and the first fusion eating it read this entry.
    if (goals.has(giftId) && !directEntry.has(giftId))
      directEntry.set(giftId, { entry, shared: neededFor !== null });
    return entry;
  };

  for (const entry of [...wanted].sort((a, b) => a.giftId - b.giftId)) {
    visit(entry.giftId, entry.required, null, 0, 0);
  }

  return {
    requirements: [...requirements.values()].sort(
      (a, b) => Number(b.required) - Number(a.required) || a.giftId - b.giftId,
    ),
    fusions,
    instances,
    unresolved,
  };
}
