/**
 * What an unresolved gift can still get from the options. The plan always covers floors 1-15 on
 * Hard, so the only lever left is 기프트 관측: offer to pin this gift when a slot is free, or to
 * release the user's pins so the planner can spend them again.
 */
import type { Gift, Rules } from '../../core/schema.ts';
import type { PlanOptions, Unresolved } from '../../core/types.ts';
import { observable } from '../../core/index.ts';

export type ActionKind = 'observeGift' | 'releaseObservations';

export interface UnresolvedAction {
  kind: ActionKind;
  /** The gift an observation action pins; only for `observeGift`. */
  giftId?: number;
  patch: Partial<PlanOptions>;
}

export function actionsFor(
  entry: Unresolved,
  gift: Gift | undefined,
  options: PlanOptions,
  rules: Rules,
  /**
   * The chosen gifts. A pin is only ever kept for a goal (`toggleObserved`, `withObservedIn`), so an
   * unresolved fusion ingredient gets no offer: pinning it worked for one render and was stripped,
   * without a word, by the next toggle.
   */
  goals: ReadonlySet<number>,
): UnresolvedAction[] {
  const out: UnresolvedAction[] = [];
  if (
    (entry.reason === 'no-pack-in-range' || entry.reason === 'pack-conflict') &&
    gift &&
    goals.has(gift.id) &&
    observable(gift, rules) &&
    !options.observedGifts.includes(gift.id)
  ) {
    if (options.observedGifts.length < rules.giftObservation.max) {
      out.push({ kind: 'observeGift', giftId: gift.id, patch: { observedGifts: [...options.observedGifts, gift.id] } });
    } else if (options.observedGifts.length > 0) {
      out.push({ kind: 'releaseObservations', patch: { observedGifts: [] } });
    }
  }
  return out;
}
