import type { Gift } from './schema.ts';
import type { DeckStats, GameIndexes, Requirement, Unresolved, WantedGift } from './types.ts';

const MAX_FUSION_DEPTH = 4;

export interface ExpandResult {
  /** Flat list of gifts that must actually be obtained, fusion ingredients included. */
  requirements: Requirement[];
  /** Fusions to perform, in dependency order (ingredients before results). */
  fusions: { result: number; ingredients: number[] }[];
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
      a.recipe.ingredients.join(',').localeCompare(b.recipe.ingredients.join(',')),
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

/**
 * What identifies a requirement: the gift AND the fusion it feeds.
 *
 * Two fusions that eat the same ingredient are two requirements, not one, because the shop consumes
 * what it fuses. Every map that says where a gift comes from is keyed by this, never by the gift id
 * alone — the two copies come from two different floors, and one of them may not be gettable at all.
 */
export const requirementKey = (r: Pick<Requirement, 'giftId' | 'neededFor'>): string =>
  `${r.giftId}:${r.neededFor ?? 'direct'}`;

/**
 * Turn the wanted list into the gifts that must actually be picked up.
 *
 * A fusion result is not obtainable directly, so it is replaced by its ingredients (recursively).
 * Ingredients shared by two results are counted, because the shop consumes them. A goal that is
 * an ingredient of another goal is fused once on the way (`chooseRecipe` picks the recipe that eats
 * it), never routed twice.
 */
export function expandRequirements(
  wanted: WantedGift[],
  indexes: GameIndexes,
  stats: DeckStats,
  maxShopSlots: number,
  run: RunState = EMPTY_RUN,
): ExpandResult {
  const requirements = new Map<string, Requirement>();
  const fusions: { result: number; ingredients: number[] }[] = [];
  const unresolved: Unresolved[] = [];
  const seenFusions = new Set<number>();
  const goals = new Set(wanted.map((w) => w.giftId));

  const addRequirement = (
    giftId: number,
    required: boolean,
    neededFor: number | null,
    via: Requirement['via'] = 'route',
  ): void => {
    const key = requirementKey({ giftId, neededFor });
    const existing = requirements.get(key);
    if (existing) {
      existing.required = existing.required || required;
      return;
    }
    // One entry per `requirementKey` — a gift needed by two fusions gets two keys, and each one is
    // a separate copy to find. A `count` field lived here for a while and was never read: the two
    // shares are two requirements, not one requirement of size two.
    requirements.set(key, { giftId, required, neededFor, via });
  };

  const visit = (giftId: number, required: boolean, neededFor: number | null, depth: number): void => {
    const gift = indexes.giftById.get(giftId);
    if (!gift) {
      unresolved.push({
        giftId,
        reason: 'not-obtainable',
        detail: { ko: '게임 데이터에 없는 기프트입니다.', en: 'Not present in the game data.' },
      });
      return;
    }

    const isFusion = gift.acquisition.kind === 'fusionOnly' || Boolean(gift.fusion);

    // Run progress settles a gift before any routing. One in hand needs no route (a fusion result
    // in hand needs none of its ingredients). One missed on a played floor is only lost when no
    // pack the player has not yet taken carries it: a pack-bound gift whose every pack was visited,
    // or a fusion result (never re-planned). Anything else is routed again from the floors ahead —
    // the search never re-enters a visited pack, so a second copy has to come from elsewhere.
    if (run.owned.has(giftId)) {
      addRequirement(giftId, required, neededFor, 'owned');
      return;
    }
    if (run.failed.has(giftId)) {
      const packBound = gift.acquisition.exclusiveTo.length > 0 || gift.acquisition.clearRewardOf !== null;
      const elsewhere = (indexes.packsByGift.get(giftId) ?? []).some((packId) => !run.visited.has(packId));
      if (isFusion || (packBound && !elsewhere)) {
        addRequirement(giftId, required, neededFor, 'unresolved');
        unresolved.push({
          giftId,
          reason: 'failed',
          detail: {
            ko: '미획득인 채로 층을 떠나 이 런에서는 더 얻을 수 없는 기프트입니다.',
            en: 'Its floor was left with it not got, so it cannot be had this run.',
          },
        });
        return;
      }
    }

    if (!isFusion) {
      addRequirement(giftId, required, neededFor);
      return;
    }

    if (depth >= MAX_FUSION_DEPTH) {
      unresolved.push({
        giftId,
        reason: 'fusion-ingredient-unresolved',
        detail: {
          ko: '조합 단계가 너무 깊어 재료를 모두 추적할 수 없습니다.',
          en: 'The fusion chain is deeper than the planner follows.',
        },
      });
      return;
    }

    const ingredients =
      chooseRecipe(gift, indexes, maxShopSlots, goals) ?? chooseMixedIngredients(gift, indexes, stats);
    if (!ingredients || ingredients.length === 0) {
      unresolved.push({
        giftId,
        reason: 'fusion-ingredient-unresolved',
        detail: {
          ko: '조합 레시피를 찾을 수 없습니다.',
          en: 'No fusion recipe is known for this gift.',
        },
      });
      return;
    }

    if (!seenFusions.has(giftId)) {
      seenFusions.add(giftId);
      // Ingredients are visited first so nested fusions land earlier in the list.
      for (const ingredient of ingredients) visit(ingredient, required, giftId, depth + 1);
      fusions.push({ result: giftId, ingredients });
    }
  };

  for (const entry of [...wanted].sort((a, b) => a.giftId - b.giftId)) {
    visit(entry.giftId, entry.required, null, 0);
  }

  return {
    requirements: [...requirements.values()].sort(
      (a, b) => Number(b.required) - Number(a.required) || a.giftId - b.giftId,
    ),
    fusions,
    unresolved,
  };
}
