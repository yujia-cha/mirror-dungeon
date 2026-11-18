import { describe, expect, it } from 'vitest';
import type { Gift, ThemePack } from '../../../src/core/schema.ts';
import { BuildError } from './errors.ts';
import { checkEventGifts } from './gifts.ts';
import type { PackSet } from './packs.ts';

/** A pack on the given Hard floors only — all the check reads is `id` and `availability`. */
function pack(id: number, hard: number[]): ThemePack {
  return { id, availability: { normal: [], hard, parallel: [], extreme: [] } } as unknown as ThemePack;
}

function gift(id: number, packs: number[], requiresHeld?: number[]): Gift {
  return {
    id,
    acquisition: { packs, exclusiveTo: requiresHeld ? packs : [], ...(requiresHeld ? { requiresHeld } : {}) },
  } as unknown as Gift;
}

function packSet(...packs: ThemePack[]): PackSet {
  return { packs, selectablePacks: packs };
}

describe('checkEventGifts (M180)', () => {
  it('accepts a held gift that only comes from floors below the event pack', () => {
    // Arrange: held from 3~4, event on 5 — the 9807 → 9296 case.
    const gifts = [gift(1, [10], [2]), gift(2, [20])];
    const packs = packSet(pack(10, [5]), pack(20, [3, 4]));
    // Act / Assert
    expect(() => checkEventGifts(gifts, packs)).not.toThrow();
  });

  it('stops the build when the held gift can come on the event floor itself', () => {
    // Arrange: held up to floor 5, event from floor 5 — one pack per floor, so not before it.
    const gifts = [gift(1, [10], [2]), gift(2, [20])];
    const packs = packSet(pack(10, [5]), pack(20, [4, 5]));
    // Act / Assert
    expect(() => checkEventGifts(gifts, packs)).toThrow(BuildError);
  });

  it('stops the build when no selectable pack hands out the held gift', () => {
    // Arrange
    const gifts = [gift(1, [10], [2]), gift(2, [])];
    // Act / Assert
    expect(() => checkEventGifts(gifts, packSet(pack(10, [5])))).toThrow(/no selectable pack/);
  });

  it('stops the build when the held gift is not in the season', () => {
    // Arrange
    const gifts = [gift(1, [10], [99])];
    // Act / Assert
    expect(() => checkEventGifts(gifts, packSet(pack(10, [5])))).toThrow(/not a gift of this season/);
  });
});
