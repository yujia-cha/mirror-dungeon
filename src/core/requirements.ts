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

/** Gifts the run already settled: in hand, or missed for good. */
export interface RunState {
  owned: Set<number>;
  failed: Set<number>;
}

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
 */
export function chooseRecipe(gift: Gift, indexes: GameIndexes, maxShopSlots: number): number[] | null {
  const recipes = gift.fusion?.recipes ?? [];
  if (recipes.length === 0) return null;
  const scored = recipes.map((recipe) => {
    const nested = recipe.ingredients.filter(
      (id) => indexes.giftById.get(id)?.acquisition.kind === 'fusionOnly',
    ).length;
    const availability = recipe.ingredients.reduce((sum, id) => sum + scarcity(id, indexes), 0);
    return { recipe, nested, availability, fitsShop: recipe.ingredients.length <= maxShopSlots };
  });
  scored.sort(
    (a, b) =>
      Number(b.fitsShop) - Number(a.fitsShop) ||
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
 * Ingredients shared by two results are counted, because the shop consumes them.
 */
export function expandRequirements(
  wanted: WantedGift[],
  indexes: GameIndexes,
  stats: DeckStats,
  maxShopSlots: number,
  run: RunState = { owned: new Set(), failed: new Set() },
): ExpandResult {
  const requirements = new Map<string, Requirement>();
  const fusions: { result: number; ingredients: number[] }[] = [];
  const unresolved: Unresolved[] = [];
  const seenFusions = new Set<number>();

  const addRequirement = (giftId: number, required: boolean, neededFor: number | null, via: Requirement['via'] = 'route'): void => {
    const key = requirementKey({ giftId, neededFor });
    const existing = requirements.get(key);
    if (existing) {
      existing.count += 1;
      existing.required = existing.required || required;
      return;
    }
    requirements.set(key, { giftId, count: 1, required, neededFor, via });
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

    // Run progress settles a gift before any routing: in hand, or missed for good. A fusion result
    // in hand needs none of its ingredients; a missed one is reported, not re-planned.
    if (run.owned.has(giftId)) {
      addRequirement(giftId, required, neededFor, 'owned');
      return;
    }
    if (run.failed.has(giftId)) {
      addRequirement(giftId, required, neededFor, 'unresolved');
      unresolved.push({
        giftId,
        reason: 'failed',
        detail: { ko: '이번 런에서 수집 실패로 표시한 기프트입니다.', en: 'Marked as missed in this run.' },
      });
      return;
    }

    const isFusion = gift.acquisition.kind === 'fusionOnly' || Boolean(gift.fusion);
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
      chooseRecipe(gift, indexes, maxShopSlots) ?? chooseMixedIngredients(gift, indexes, stats);
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
