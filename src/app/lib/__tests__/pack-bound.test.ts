/**
 * `isPackBound` (M156): a gift that takes entering a particular pack — one pack or boss hands it out,
 * or every recipe of a fusion result eats such a gift (owner's call: a fusion is pack-bound when its
 * ingredients are). Real gifts from the default season, plus made-up recipes for the edges.
 */
import { describe, expect, it } from 'vitest';
import type { Gift } from '../../../core/schema.ts';
import { buildIndexes } from '../../../core/index.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { isPackBound } from '../gift-priority.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const gift = (id: number) => indexes.giftById.get(id)!;
const bound = (id: number) => isPackBound(gift(id), indexes.giftById);

/** A fusion-only copy of a real gift with the given recipes. */
const fusion = (id: number, ...recipes: number[][]): Gift => ({
  ...gift(id),
  acquisition: { ...gift(id).acquisition, kind: 'fusionOnly' },
  fusion: { recipes: recipes.map((ingredients) => ({ ingredients })) },
});

describe('isPackBound', () => {
  it('holds for a pack-limited gift and a clear reward, not for a general drop', () => {
    expect(bound(9215)).toBe(true); // 붉은색 넥타이, pack-limited
    expect(bound(9251)).toBe(true); // 불타는 운명, clear reward
    expect(bound(9001)).toBe(false); // general
  });

  it('holds for a fusion every recipe of which eats a pack-only gift', () => {
    // 선물: 포장용 상자 + 포장용 끈, both pack-only.
    expect(bound(9764)).toBe(true);
    // 부치지 못한 편지: 해진 우산 (범용) + 깨진 안경 (팩) — one pack-only ingredient is enough.
    expect(bound(9424)).toBe(true);
    // 생강꽃…: one recipe eats 부치지 못한 편지, itself a pack-bound fusion; the other a pack gift.
    expect(bound(9248)).toBe(true);
  });

  it('fails for a fusion with a recipe of 범용 gifts only, and for a general drop with a recipe', () => {
    // 진혼: both recipes are general drops.
    expect(bound(9088)).toBe(false);
    // 달의 기억 drops anywhere, recipe or not.
    expect(gift(9083).acquisition.kind).toBe('general');
    expect(bound(9083)).toBe(false);
  });

  it('fails when one recipe needs no pack, however pack-bound the others are', () => {
    // Arrange: a pack-only recipe beside a 범용 one.
    const either = fusion(9764, [9215], [9001]);
    // Act + Assert
    expect(isPackBound(either, indexes.giftById)).toBe(false);
  });

  it('stops on a recipe loop and on a fusion with no recipe', () => {
    // Arrange: two made-up fusions (ids no gift has) eating each other, neither touching a pack.
    const [x, y] = [100_001, 100_002];
    const a: Gift = { ...fusion(9764, [y]), id: x };
    const b: Gift = { ...fusion(9424, [x]), id: y };
    const byId = new Map(indexes.giftById).set(x, a).set(y, b);
    // Act + Assert
    expect(isPackBound(a, byId)).toBe(false);
    expect(isPackBound(fusion(9764), indexes.giftById)).toBe(false);
  });

  it('counts the pack-bound fusions of the default season (38 of 59)', () => {
    // When the data changes this number does too — look at which fusions moved.
    const fusions = data.gifts.filter((g) => g.acquisition.kind === 'fusionOnly');
    expect(fusions).toHaveLength(59);
    expect(fusions.filter((g) => isPackBound(g, indexes.giftById))).toHaveLength(38);
  });
});
