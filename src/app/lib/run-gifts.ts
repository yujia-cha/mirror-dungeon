/**
 * Two readings of the run record that every surface used to spell out for itself (M160).
 *
 * Pure. The record itself (`RunState`) lives in `plan-input.ts`; these only read it.
 */
import type { GiftStatus } from './plan-input.ts';

/** The gifts the run marks as in hand (`got`) — not those used up by a fusion or missed. */
export function heldGifts(giftStatus: Readonly<Record<number, GiftStatus>>): number[] {
  const out: number[] = [];
  for (const [id, status] of Object.entries(giftStatus)) if (status === 'got') out.push(Number(id));
  return out;
}

/** The floor `packId` was entered on, or null when the run holds no entry for it. */
export function floorOfVisit(visits: Readonly<Record<number, number>>, packId: number): number | null {
  for (const [floor, id] of Object.entries(visits)) if (id === packId) return Number(floor);
  return null;
}
