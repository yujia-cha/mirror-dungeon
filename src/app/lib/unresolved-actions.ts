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
   * What the route is out to collect (`PlanState.needed`): the goals, and the ingredients a fusion
   * goal consumes. Ingredients belong here — they are the usual thing an unresolved fusion is
   * missing, and since the store keeps a pin for anything the route collects, the offer sticks.
   * (It used to be the goals alone: pinning an ingredient worked for one render and was stripped,
   * without a word, by the next toggle.)
   */
  goals: ReadonlySet<number>,
  /**
   * Whether the observation window has closed (`observationClosed(run)`): floor 1 is left and the
   * starlight is spent. Nothing is offered then — a pin the run cannot make is not an action, and
   * releasing the pins would only unsettle a plan they no longer shape.
   */
  closed: boolean,
  /**
   * Looks up the ingredients a dead fusion is missing: `gift` is the result, and the offers go to
   * its `missing` pieces.
   */
  giftById: (id: number) => Gift | undefined = () => undefined,
): UnresolvedAction[] {
  const out: UnresolvedAction[] = [];
  if (closed) return out;
  const pinned = options.observedGifts;
  const free = rules.giftObservation.max - pinned.length;
  if (
    (entry.reason === 'no-pack-in-range' || entry.reason === 'pack-conflict') &&
    gift &&
    goals.has(gift.id) &&
    observable(gift, rules) &&
    !pinned.includes(gift.id)
  ) {
    if (free > 0) {
      out.push({ kind: 'observeGift', giftId: gift.id, patch: { observedGifts: [...pinned, gift.id] } });
    } else if (pinned.length > 0) {
      out.push({ kind: 'releaseObservations', patch: { observedGifts: [] } });
    }
  }
  // A fusion that died for want of a piece: the piece itself is the thing to observe. Its own row
  // cannot say so — the plan stops routing for a dead fusion's ingredients, so `goals` no longer
  // holds them — but the store still accepts a pin on any piece of a chosen recipe, so the offer
  // lives on the result's row, one per missing piece while the slots last.
  if (entry.reason === 'fusion-ingredient-unresolved') {
    let slots = free;
    for (const id of entry.missing ?? []) {
      if (slots <= 0) break;
      const ingredient = giftById(id);
      if (!ingredient || pinned.includes(id) || !observable(ingredient, rules)) continue;
      out.push({ kind: 'observeGift', giftId: id, patch: { observedGifts: [...pinned, id] } });
      slots -= 1;
    }
  }
  return out;
}
