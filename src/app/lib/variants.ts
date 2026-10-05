/**
 * What an alternative route changes against the plan it was computed from — the facts the
 * decision card writes on each option row.
 *
 * Packs are compared as a set, not floor by floor: a pack that merely slides from floor 5 to
 * floor 7 (most windows span several floors, see `FloorPlan.window`) is the same visit, and
 * saying it 「들어옵니다」 would be false. `added` are the packs the variant visits that the base
 * plan did not, on the floor the variant gives them; `removed` the reverse.
 */
import type { RoutePlan } from '../../core/types.ts';

export interface VariantDiff {
  added: { floor: number; packId: number }[];
  removed: { floor: number; packId: number }[];
  /**
   * The gifts the variant still leaves unresolved, in the plan's order, each once — minus those
   * the base plan already lost for a reason other than the conflict (`chance-only`, no pack path
   * …): no drop changes those, and counting them would put ⚠ on a variant that clears it.
   */
  stillUnresolved: number[];
}

function visits(plan: RoutePlan): Map<number, number> {
  const out = new Map<number, number>();
  for (const floor of plan.floors) {
    if (floor.packId !== null && !out.has(floor.packId)) out.set(floor.packId, floor.floor);
  }
  return out;
}

export function variantDiff(base: RoutePlan, variant: RoutePlan): VariantDiff {
  const before = visits(base);
  const after = visits(variant);
  const added = [...after]
    .filter(([packId]) => !before.has(packId))
    .map(([packId, floor]) => ({ floor, packId }))
    .sort((a, b) => a.floor - b.floor || a.packId - b.packId);
  const removed = [...before]
    .filter(([packId]) => !after.has(packId))
    .map(([packId, floor]) => ({ floor, packId }))
    .sort((a, b) => a.floor - b.floor || a.packId - b.packId);
  const settled = new Set(base.unresolved.filter((u) => u.reason !== 'pack-conflict').map((u) => u.giftId));
  const stillUnresolved = [
    ...new Set(variant.unresolved.map((u) => u.giftId).filter((id) => !settled.has(id))),
  ];
  return { added, removed, stillUnresolved };
}
