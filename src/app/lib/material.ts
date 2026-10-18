/**
 * The 잔영 materials (M152, owner's call): held always, never a goal, never marked.
 *
 * They come from toasts the screen reader does not see, any number at a time, and fusions and sales
 * spend them in counts the run cannot keep. No recipe of the season eats one (the data test
 * guards it), so treating them as always in hand changes no plan — and it closes the paths where a
 * mark said the wrong thing. So no list offers one as a goal, the store refuses one, and the
 * reader records no mark for one.
 */
import type { Gift } from '../../core/schema.ts';

export function isMaterial(gift: Pick<Gift, 'acquisition'>): boolean {
  return gift.acquisition.kind === 'material';
}

/** A gift a list may offer as a goal: obtainable (or already chosen) and no 잔영. */
export function isGoalCandidate(gift: Gift, wanted: readonly number[]): boolean {
  return !isMaterial(gift) && (gift.obtainable || wanted.includes(gift.id));
}
