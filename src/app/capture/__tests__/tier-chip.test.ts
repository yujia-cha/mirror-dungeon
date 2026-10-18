import { describe, expect, it } from 'vitest';
import { chipTiers } from '../tier-chip.ts';

const W = 100;
const H = 100;
const YELLOW = [240, 190, 30] as const;

/** A 100×100 dark slot with yellow columns `[x, width]` in its numeral corner, and extra dots. */
function slot(
  bars: readonly (readonly [number, number])[],
  extra: readonly (readonly [number, number])[] = [],
) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([20, 20, 20, 255], i * 4);
  const paint = (x: number, y: number) => rgba.set([...YELLOW, 255], (y * W + x) * 4);
  for (const [x0, width] of bars)
    for (let x = x0; x < x0 + width; x++) for (let y = 5; y < 35; y++) paint(x, y);
  for (const [x, y] of extra) paint(x, y);
  return rgba;
}
const WHOLE: [number, number, number, number] = [0, 0, 1, 1];

describe('chipTiers (M152)', () => {
  it('counts upright bars as Ⅰ, Ⅱ, Ⅲ', () => {
    expect(chipTiers(slot([[5, 4]]), W, H, WHOLE)).toEqual([1]);
    expect(
      chipTiers(
        slot([
          [5, 4],
          [14, 4],
        ]),
        W,
        H,
        WHOLE,
      ),
    ).toEqual([2]);
    expect(
      chipTiers(
        slot([
          [5, 4],
          [14, 4],
          [23, 4],
        ]),
        W,
        H,
        WHOLE,
      ),
    ).toEqual([3]);
  });

  it('allows Ⅳ and Ⅴ — and the bar count — when slanted strokes sit beside the bars', () => {
    // Arrange: Ⅳ — one bar, then a V's two diagonals.
    const v: [number, number][] = [];
    for (let i = 0; i < 25; i++) v.push([15 + Math.floor(i / 3), 8 + i], [30 - Math.floor(i / 3), 8 + i]);
    // Act + Assert
    expect(chipTiers(slot([[5, 4]], v), W, H, WHOLE)).toEqual([1, 4, 5]);
  });

  it('says nothing for a corner without a numeral', () => {
    expect(chipTiers(slot([]), W, H, WHOLE)).toBeNull();
  });

  it('reads the corner of a region inside a larger image', () => {
    // The slot is the top-left quarter of the image; its corner holds two bars.
    expect(
      chipTiers(
        slot([
          [2, 2],
          [8, 2],
        ]),
        W,
        H,
        [0, 0, 0.5, 1],
      ),
    ).toEqual([2]);
  });
});
