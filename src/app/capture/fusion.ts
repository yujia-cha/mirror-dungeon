/**
 * Which gifts a fusion consumed, from the icons on its confirm screen (M101).
 *
 * The confirm screen 「선택한 E.G.O 기프트를 조합하시겠습니까?」 shows the ingredients as icons only —
 * no names — so the capture loop ranks each slot's icon against candidates (`rankIcons`, M93) and
 * this file turns those rankings into gift ids:
 *
 * - `assignSlots` gives each slot one gift, never the same gift to two slots — a run holds one of
 *   each gift, so two slots cannot show the same one. The exception is the 잔영 materials, held in
 *   any number (M103: a real 5/5 confirm had two 빛나는 잔영). Unsure slots say so instead of guessing.
 * - `mixedFusionConsumed` answers the question the owner asked for 달의 기억: it eats 2 of the 7
 *   shards and all 3 memories. The memories need no reading (all of them go), and neither do the
 *   shards when the player holds only two. Only with three or more shards held does it take the
 *   icons, and only among the shards and memories the player holds.
 *
 * Pure: rankings and run state in, ids out. Candidates come from the run (`giftStatus` 'got'),
 * which is what keeps the reading reliable — a handful of held gifts, not the season's 450.
 */
import type { Gift } from '../../core/schema.ts';
import type { MatchResult } from './match-name.ts';

type MixedRecipe = NonNullable<NonNullable<Gift['fusion']>['mixed']>;

/** One slot's candidates, best first: `[giftId, score]` as `rankIcons` returns them. */
export type SlotRanking = readonly (readonly [number, number])[];

export interface SlotThresholds {
  /** The assigned gift must score at least this. */
  minScore: number;
  /** …and beat the slot's next free candidate by at least this. */
  minMargin: number;
}

/** The icon thresholds of M93, which the confirm-screen slots were measured with. */
export const DEFAULT_SLOT_THRESHOLDS: SlotThresholds = { minScore: 0.5, minMargin: 0.08 };
/** A best score under this share of `minScore` makes a slot `none` rather than `ambiguous`. */
const NONE_BELOW = 0.7;

/**
 * Give each slot one gift, each gift to at most one slot. Greedy by confidence: the surest pair
 * (slot, gift) anywhere is settled first and its gift leaves every other slot's list, so a clear
 * slot can free up a muddled one. A slot whose best free candidate is weak or barely ahead of the
 * next is `ambiguous` (or `none` when nothing is left or nothing scores) and takes no gift.
 */
export function assignSlots(
  slots: readonly SlotRanking[],
  thresholds: SlotThresholds = DEFAULT_SLOT_THRESHOLDS,
  /** Gifts held in any number (the 잔영 materials): they may fill several slots. */
  repeatable: ReadonlySet<number> = new Set(),
): MatchResult[] {
  const out: (MatchResult | null)[] = slots.map(() => null);
  const taken = new Set<number>();
  const free = (slot: number) => slots[slot]!.filter(([id]) => !taken.has(id));
  for (let left = slots.length; left > 0; left--) {
    // The open slot whose best free candidate scores highest.
    let pick = -1;
    let pickScore = -Infinity;
    for (let s = 0; s < slots.length; s++) {
      if (out[s] !== null) continue;
      const best = free(s)[0];
      const score = best ? best[1] : -Infinity;
      if (pick === -1 || score > pickScore) {
        pick = s;
        pickScore = score;
      }
    }
    const ranked = free(pick);
    const best = ranked[0];
    // Far below the bar the slot is not a near-miss but something else entirely (a gift the run
    // never recorded, an empty slot): listing every candidate as a maybe would only be noise.
    if (!best || best[1] < thresholds.minScore * NONE_BELOW) {
      out[pick] = { status: 'none' };
      continue;
    }
    const margin = best[1] - (ranked[1]?.[1] ?? 0);
    if (best[1] >= thresholds.minScore && margin >= thresholds.minMargin) {
      out[pick] = { status: 'match', id: best[0], score: best[1], margin };
      if (!repeatable.has(best[0])) taken.add(best[0]);
    } else {
      const ids = ranked.filter(([, score]) => best[1] - score < thresholds.minMargin).map(([id]) => id);
      out[pick] = { status: 'ambiguous', ids, score: best[1], margin };
    }
  }
  return out as MatchResult[];
}

export interface Consumed {
  /** Gifts the fusion surely ate, ascending. Unmark these. */
  consumed: number[];
  /** Held gifts it may have eaten but the screen did not settle, ascending. Ask about these. */
  unsure: number[];
}

/**
 * What the mixed fusion (달의 기억) ate from what the player holds.
 *
 * `slots` are the confirm screen's rankings over `candidatesForMixed` — or null when the screen was
 * not read, in which case only what needs no reading is settled.
 */
export function mixedFusionConsumed(
  mixed: MixedRecipe,
  held: ReadonlySet<number>,
  slots: readonly SlotRanking[] | null,
  thresholds: SlotThresholds = DEFAULT_SLOT_THRESHOLDS,
): Consumed {
  const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
  const heldOf = (pool: readonly number[]) => sorted(pool.filter((id) => held.has(id)));
  const aHeld = heldOf(mixed.aPool);
  const bHeld = heldOf(mixed.bPool);
  // A pool the player holds no more of than the recipe takes goes whole: nothing to tell apart.
  const certain = [
    ...(aHeld.length <= mixed.aCount ? aHeld : []),
    ...(bHeld.length <= mixed.bCount ? bHeld : []),
  ];
  const open = [
    ...(aHeld.length > mixed.aCount ? [{ held: aHeld, count: mixed.aCount }] : []),
    ...(bHeld.length > mixed.bCount ? [{ held: bHeld, count: mixed.bCount }] : []),
  ];
  if (open.length === 0) return { consumed: sorted(certain), unsure: [] };

  const read = slots ? assignSlots(slots, thresholds) : [];
  const matched = new Set(read.flatMap((r) => (r.status === 'match' ? [r.id] : [])));
  const consumed = [...certain];
  const unsure: number[] = [];
  for (const pool of open) {
    const seen = pool.held.filter((id) => matched.has(id));
    // The screen must account for the whole share; a partial read settles nothing in that pool.
    if (seen.length === pool.count) consumed.push(...seen);
    else unsure.push(...pool.held);
  }
  return { consumed: sorted(consumed), unsure: sorted(unsure) };
}

/** The gifts to rank the confirm screen's slots against for the mixed fusion: what the player holds of both pools. */
export function candidatesForMixed(mixed: MixedRecipe, held: ReadonlySet<number>): number[] {
  return [...mixed.aPool, ...mixed.bPool].filter((id) => held.has(id)).sort((a, b) => a - b);
}
