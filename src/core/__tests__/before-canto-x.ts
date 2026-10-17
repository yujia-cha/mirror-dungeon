import type { GameData } from '../schema.ts';

/**
 * The Canto X packs that arrived with the 10-15 patch, ahead of the static data.
 *
 * Until a client extraction lands they carry an assumed general pool — every general gift of the
 * season (`backfillAssumptions` in `data/curated/seasons/md7/rules.json`) — which lifts every
 * general gift by four packs. 파란 별조각 (9817) then clears the 20% share and stops being a gift
 * the route aims at, and the boards M82–M87 measured against an integer program change shape.
 *
 * MD8 (OpenLethe af2aa4df) ships these packs in the static data with their own pool (73 general
 * gifts, not all 186), so the assumption only lives on in the frozen md7 output. The measured
 * boards in planner.test.ts load md7 by number and strip the packs here; tests that apply this to
 * the live season get MD8 without Canto X.
 */
export const CANTO_X_PACKS: ReadonlySet<number> = new Set([1028, 1029, 1030, 1031]);

/** The season as it stood before those packs: tests that pin a measured or rare-gift case use it. */
export function beforeCantoX(data: GameData): GameData {
  return {
    ...data,
    packs: data.packs.filter((pack) => !CANTO_X_PACKS.has(pack.id)),
    gifts: data.gifts.filter((gift) => !gift.acquisition.exclusiveTo.some((id) => CANTO_X_PACKS.has(id))),
  };
}
