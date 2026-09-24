/**
 * One rule for making a gift a goal, wherever the press happens — the item grid, a detail sheet,
 * a pack sheet's gift row.
 *
 * Choosing a gift absorbs what it already carries: its 조합 계승 children (a lower-tier,
 * same-keyword ingredient of it) and its whole recipe tree. Those come out of the selection so the
 * list never holds a goal and something the goal already implies. The three surfaces used to
 * disagree about this — the grid dropped both, one sheet dropped only the children and a third
 * path dropped nothing — which left goals whose child tiles were locked *and* selected, with no
 * way to drop them but the chip's ✕.
 */
import type { Gift } from '../../core/schema.ts';
import type { GameIndexes } from '../../core/types.ts';
import { ingredientsOf } from './entangle.ts';

export interface CarryIndex {
  indexes: GameIndexes;
  /** `upgradeChildren(data)`: the 조합 계승 children of each gift. */
  childrenOf: ReadonlyMap<number, Gift[]>;
  maxShopSlots: number;
}

/** The gift ids a selection of `gift` takes out of the goal list with it. */
export function carriedBy(gift: Gift, { indexes, childrenOf, maxShopSlots }: CarryIndex): number[] {
  return [
    ...(childrenOf.get(gift.id) ?? []).map((g) => g.id),
    ...(gift.fusion ? ingredientsOf(gift, indexes, maxShopSlots) : []),
  ];
}
