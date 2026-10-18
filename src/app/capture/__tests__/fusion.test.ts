import { describe, expect, it } from 'vitest';
import { assignSlots, mixedFusionConsumed, recipeConsumed, type SlotRanking } from '../fusion.ts';

/** 달의 기억 (9083): 2 of the seven shards, all 3 memories. */
const MOON = {
  aCount: 2,
  aPool: [9105, 9110, 9116, 9121, 9126, 9131, 9136],
  bCount: 3,
  bPool: [9142, 9147, 9152],
};
const MEMORIES = [9142, 9147, 9152];

describe('assignSlots', () => {
  it('gives each slot its clear best', () => {
    // Arrange
    const slots: SlotRanking[] = [
      [
        [1, 0.95],
        [2, 0.6],
      ],
      [
        [2, 0.9],
        [1, 0.55],
      ],
    ];
    // Act
    const out = assignSlots(slots);
    // Assert
    expect(out.map((r) => (r.status === 'match' ? r.id : r.status))).toEqual([1, 2]);
  });

  it('never gives one gift to two slots, so a sure slot frees a muddled one', () => {
    // Slot 1 alone cannot tell 1 from 2; slot 0 takes 1 surely, which leaves 2 clear for slot 1.
    const slots: SlotRanking[] = [
      [
        [1, 0.95],
        [2, 0.5],
      ],
      [
        [1, 0.82],
        [2, 0.8],
        [3, 0.3],
      ],
    ];
    const out = assignSlots(slots);
    expect(out[0]).toMatchObject({ status: 'match', id: 1 });
    expect(out[1]).toMatchObject({ status: 'match', id: 2 });
  });

  it('calls a slot ambiguous when its best is barely ahead, and none when nothing is left', () => {
    // Arrange: two near-equal candidates for one slot; a second slot with only the first's gift.
    const slots: SlotRanking[] = [
      [
        [1, 0.7],
        [2, 0.68],
      ],
      [[1, 0]],
    ];
    // Act
    const out = assignSlots(slots);
    // Assert
    expect(out[0]).toMatchObject({ status: 'ambiguous', ids: [1, 2] });
    expect(out[1]).toEqual({ status: 'none' });
  });

  it('refuses a weak best even with a wide margin', () => {
    const out = assignSlots([[[1, 0.4]]]);
    expect(out[0]).toMatchObject({ status: 'ambiguous', ids: [1] });
  });

  it('returns nothing for no slots', () => {
    expect(assignSlots([])).toEqual([]);
  });
});

describe('assignSlots — the 잔영 are one (M152)', () => {
  it('takes a 잔영 whose nearest rival is another 잔영 — which one changes nothing', () => {
    // Arrange: 9993 and 9992 are both 잔영, close together; the held gift 7 is far behind.
    const read = assignSlots(
      [
        [
          [9993, 0.8],
          [9992, 0.78],
          [7, 0.6],
        ],
      ],
      undefined,
      new Set([9992, 9993]),
    );
    // Assert
    expect(read[0]).toMatchObject({ status: 'match', id: 9993 });
  });

  it('still asks when a held gift is as close to the slot as the 잔영', () => {
    const read = assignSlots(
      [
        [
          [9993, 0.8],
          [7, 0.78],
        ],
      ],
      undefined,
      new Set([9993]),
    );
    expect(read[0]).toMatchObject({ status: 'ambiguous', ids: [9993, 7] });
  });
});

describe('mixedFusionConsumed (달의 기억)', () => {
  it('needs no reading when the player holds only the two shards it takes', () => {
    // Arrange
    const held = new Set([9105, 9131, ...MEMORIES, 9001]);
    // Act
    const out = mixedFusionConsumed(MOON, held);
    // Assert: both shards and all three memories, nothing else held.
    expect(out).toEqual({ consumed: [9105, 9131, ...MEMORIES], unsure: [] });
  });

  it('asks about the shards when the player holds more than it takes', () => {
    const held = new Set([9105, 9110, 9126, ...MEMORIES]);
    expect(mixedFusionConsumed(MOON, held)).toEqual({ consumed: MEMORIES, unsure: [9105, 9110, 9126] });
  });

  it('takes whatever is held of a pool the player holds less of than it takes', () => {
    // Boundary: one shard and two memories — the fusion could not have been made, but nothing held
    // of either pool can have survived it.
    const held = new Set([9116, 9142, 9147]);
    expect(mixedFusionConsumed(MOON, held)).toEqual({ consumed: [9116, 9142, 9147], unsure: [] });
  });
});

describe('recipeConsumed (M151)', () => {
  // Two recipes of one result: three gifts, or two of them with another gift and a 잔영.
  const RECIPES = [{ ingredients: [1, 2, 3] }, { ingredients: [1, 2, 4, 900] }];
  const isMaterial = (id: number) => id === 900;
  const read = (consumed: number[] = [], unsure: number[] = [], filled?: number) => ({
    consumed,
    unsure,
    ...(filled === undefined ? {} : { filled }),
  });

  it('takes the only recipe the run holds whole, without the icons', () => {
    expect(recipeConsumed(RECIPES, new Set([1, 2, 3]), read(), isMaterial)).toEqual({
      consumed: [1, 2, 3],
      unsure: [],
    });
  });

  it('tells two recipes apart by the confirm’s slot count, the 잔영 counting as a slot', () => {
    const held = new Set([1, 2, 3, 4]);
    expect(recipeConsumed(RECIPES, held, read([], [], 4), isMaterial)).toEqual({
      consumed: [1, 2, 4],
      unsure: [],
    });
    expect(recipeConsumed(RECIPES, held, read([], [], 3), isMaterial)).toEqual({
      consumed: [1, 2, 3],
      unsure: [],
    });
  });

  it('lets a matched icon choose the recipe', () => {
    expect(recipeConsumed(RECIPES, new Set([1, 2, 3, 4]), read([4]), isMaterial)).toEqual({
      consumed: [1, 2, 4],
      unsure: [],
    });
  });

  it('settles what the open recipes share and asks the rest', () => {
    expect(recipeConsumed(RECIPES, new Set([1, 2, 3, 4]), read(), isMaterial)).toEqual({
      consumed: [1, 2],
      unsure: [3, 4],
    });
  });

  it('names only held gifts when the run never recorded an ingredient', () => {
    // Arrange: 3 was never marked; the three-slot recipe is still the one.
    expect(recipeConsumed(RECIPES, new Set([1, 2]), read([], [], 3), isMaterial)).toEqual({
      consumed: [1, 2],
      unsure: [],
    });
  });

  it('drops an icon no recipe names when icons and recipes disagree', () => {
    // Arrange: 8 matched, which no recipe of the result takes — a misread.
    expect(recipeConsumed(RECIPES, new Set([1, 2, 8]), read([8, 1], [2]), isMaterial)).toEqual({
      consumed: [1],
      unsure: [2],
    });
  });

  it('is null for a result with no recipe — a keyword fusion: the icons decide alone', () => {
    expect(recipeConsumed([], new Set([1]), read([1]), isMaterial)).toBeNull();
  });
});
