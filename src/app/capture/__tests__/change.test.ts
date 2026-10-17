import { describe, expect, it } from 'vitest';
import type { CaptureLayout } from '../../../core/schema.ts';
import { changed, PATCH_H, PATCH_W, signatureOf, watchedRegions } from '../change.ts';
import type { Region } from '../preprocess.ts';

const W = 200;
const H = 100;
const flat = (value: number) => new Uint8ClampedArray(W * H * 4).fill(value);
const regions: Region[] = [
  [0, 0, 0.5, 0.5],
  [0.5, 0.5, 0.5, 0.5],
];

/** Paint a rectangle (fractions) of an image with a grey value. */
function paint(rgba: Uint8ClampedArray, [rx, ry, rw, rh]: Region, value: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let y = Math.floor(ry * H); y < Math.floor((ry + rh) * H); y++)
    for (let x = Math.floor(rx * W); x < Math.floor((rx + rw) * W); x++)
      out.fill(value, (y * W + x) * 4, (y * W + x) * 4 + 3);
  return out;
}

describe('signatureOf / changed', () => {
  it('sees no change between identical frames', () => {
    // Arrange
    const a = signatureOf(flat(40), W, H, regions);
    const b = signatureOf(flat(40), W, H, regions);
    // Act + Assert
    expect(a).toHaveLength(regions.length * PATCH_W * PATCH_H);
    expect(changed(a, b)).toBe(false);
  });

  it('sees a popup appear in one watched region', () => {
    const before = signatureOf(flat(40), W, H, regions);
    const after = signatureOf(paint(flat(40), [0.6, 0.6, 0.3, 0.3], 230), W, H, regions);
    expect(changed(before, after)).toBe(true);
  });

  it('ignores a change outside every watched region and a faint flicker inside one', () => {
    // Arrange: the top-right quarter is not watched; a +3 grey shimmer is under the threshold.
    const base = flat(40);
    const outside = signatureOf(paint(base, [0.6, 0, 0.3, 0.3], 230), W, H, regions);
    const shimmer = signatureOf(paint(base, [0, 0, 0.5, 0.5], 43), W, H, regions);
    const before = signatureOf(base, W, H, regions);
    // Act + Assert
    expect(changed(before, outside)).toBe(false);
    expect(changed(before, shimmer)).toBe(false);
  });

  it('counts a missing or differently sized previous signature as a change', () => {
    const next = signatureOf(flat(40), W, H, regions);
    expect(changed(null, next)).toBe(true);
    expect(changed(new Uint8Array(3), next)).toBe(true);
  });
});

describe('watchedRegions', () => {
  it('watches titles, names and the fusion header once each', () => {
    // Arrange: the sell confirm's title and name share a region.
    const shared: Region = [0.28, 0.42, 0.44, 0.12];
    const layout = {
      reference: { width: 1920, height: 1009 },
      titles: [{ region: shared, screens: ['sellConfirm'] }],
      names: {
        popup: [0.1, 0.1, 0.1, 0.1],
        selected: [0.2, 0.2, 0.1, 0.1],
        centerConfirm: shared,
        mapHeader: [0, 0, 0.1, 0.1],
      },
      fusion: { count: [0.2, 0.2, 0.3, 0.07], five: [], three: [] },
      popupIcon: [0.3, 0.3, 0.1, 0.1],
    } as unknown as CaptureLayout;
    // Act
    const watched = watchedRegions(layout);
    // Assert: the start pickers' panels are no longer read, so not watched either (M136).
    expect(watched).toHaveLength(5);
    expect(watched.filter((r) => r.join() === shared.join())).toHaveLength(1);
  });
});
