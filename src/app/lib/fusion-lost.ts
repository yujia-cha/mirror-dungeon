/**
 * Fusions the run itself has killed: an ingredient was left 미획득 on a floor the run has left, no
 * other pack can hand it over, so the planner gave the fusion up and re-routed. This is the one
 * kind of unresolved gift the route panel still reports — the route changed under the player
 * because of something that happened in the run, and the panel says so at its top.
 *
 * A dead fusion counts when one of its missing ingredients is marked failed, or is itself a fusion
 * that died that way (a nested result). A fusion the plan could never make — an ingredient no pack
 * in range offers — is not the run's doing and is not listed. Pure: reads the plan, never
 * recomputes it.
 */
import type { RoutePlan } from '../../core/types.ts';
import type { GiftStatus } from './plan-input.ts';

export interface LostFusion {
  /** The fusion result that can no longer be made. */
  result: number;
  /** The ingredients the plan could not obtain, in the plan's order. */
  missing: number[];
  /** The remaining ingredients the plan stopped entering packs for. */
  dropped: number[];
  /**
   * The recipe's other ingredients not yet in hand: what the route can still go after, or has
   * stopped going after (`dropped`), as the player chooses (`fusionGoal`).
   */
  remaining: number[];
}

export function lostFusions(plan: RoutePlan, giftStatus: Record<number, GiftStatus>): LostFusion[] {
  const dead = new Map<number, number[]>();
  for (const entry of plan.unresolved) {
    if (entry.reason === 'fusion-ingredient-unresolved' && entry.missing && entry.missing.length > 0)
      dead.set(entry.giftId, entry.missing);
  }
  const memo = new Map<number, boolean>();
  const byRun = (result: number, seen: Set<number>): boolean => {
    const known = memo.get(result);
    if (known !== undefined) return known;
    if (seen.has(result)) return false;
    seen.add(result);
    const missing = dead.get(result) ?? [];
    const out = missing.some((id) => giftStatus[id] === 'failed' || (dead.has(id) && byRun(id, seen)));
    memo.set(result, out);
    return out;
  };
  return plan.unresolved.flatMap((entry) => {
    if (entry.reason !== 'fusion-ingredient-unresolved' || !byRun(entry.giftId, new Set())) return [];
    const missing = entry.missing ?? [];
    const ingredients = plan.fusions.find((f) => f.result === entry.giftId)?.ingredients ?? [];
    const remaining = ingredients.filter((id) => !missing.includes(id) && giftStatus[id] !== 'got');
    return [{ result: entry.giftId, missing, dropped: entry.droppedIngredients ?? [], remaining }];
  });
}
