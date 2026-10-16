/** The pure parts of the pack image pipeline (M100): which file is which sprite, and the shrink. */
import { describe, expect, it } from 'vitest';
import { downscaleRgba, planPackImages } from '../scripts/lib/pack-images.ts';

describe('planPackImages', () => {
  it("names each sprite's file by the source's own `image`, once per shared sprite", () => {
    // Arrange: two packs share a sprite; a backfilled pack's sprite is its id.
    const packs = [
      { id: 1002, sprite: 'Canto_II' },
      { id: 1001, sprite: 'Canto_I' },
      { id: 1101, sprite: 'Canto_I' },
      { id: 1028, sprite: '1028' },
    ];
    const derived = {
      '1001': { image: 'Canto_I' },
      '1002': { image: 'Canto_II' },
      '1028': { image: 'Canto_X' },
    };
    // Act
    const plan = planPackImages(packs, derived);
    // Assert: sorted by key, the backfilled pack takes the art the source names.
    expect(plan.downloads).toEqual([
      { key: '1028', remote: 'assets/theme_packs/Canto_X.webp' },
      { key: 'Canto_I', remote: 'assets/theme_packs/Canto_I.webp' },
      { key: 'Canto_II', remote: 'assets/theme_packs/Canto_II.webp' },
    ]);
    expect(plan.unmapped).toEqual([]);
  });

  it('reports a sprite no pack of its has an image for, instead of guessing a file name', () => {
    const plan = planPackImages([{ id: 1999, sprite: 'Mystery' }], {});
    expect(plan).toEqual({ downloads: [], unmapped: ['Mystery'] });
  });
});

describe('downscaleRgba', () => {
  const solid = (width: number, height: number, rgba: number[]) => ({
    data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => rgba[i % 4]!),
    width,
    height,
  });

  it('keeps the aspect ratio and the colour of a flat image', () => {
    // Arrange: 380×690, like an upstream pack.
    const src = solid(380, 690, [200, 100, 50, 255]);
    // Act
    const out = downscaleRgba(src, 256);
    // Assert
    expect([out.width, out.height]).toEqual([256, 465]);
    expect([...out.data.slice(0, 4)]).toEqual([200, 100, 50, 255]);
    expect([...out.data.slice(-4)]).toEqual([200, 100, 50, 255]);
  });

  it('averages what each output pixel covers, weighting colour by alpha', () => {
    // Arrange: 2×1 → 1×1. A red opaque pixel beside a transparent black one.
    const src = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), width: 2, height: 1 };
    // Act
    const out = downscaleRgba(src, 1);
    // Assert: the transparent neighbour halves the alpha but does not darken the red.
    expect([...out.data]).toEqual([255, 0, 0, 128]);
  });

  it('never enlarges an image already that narrow', () => {
    const src = solid(100, 200, [1, 2, 3, 4]);
    const out = downscaleRgba(src, 256);
    expect([out.width, out.height]).toEqual([100, 200]);
    expect(out.data).not.toBe(src.data);
  });
});
