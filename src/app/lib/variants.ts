/**
 * What an alternative route changes against the plan it was computed from — the facts the
 * 「포기 결정」 card writes on each option row.
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
  /** The gifts the variant still leaves unresolved, in the plan's order, each once. */
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
  const stillUnresolved = [...new Set(variant.unresolved.map((u) => u.giftId))];
  return { added, removed, stillUnresolved };
}
