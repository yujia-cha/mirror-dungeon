import { describe, expect, it } from 'vitest';
import {
  ICON_SIZE,
  maskedCorrelation,
  matchIcon,
  prepareReference,
  prepareSlot,
  resizeRgba,
} from '../match-icon.ts';
import { cropRgba, pixelRect } from '../preprocess.ts';

/** A w×h RGBA image filled by `paint(x, y)` → [r, g, b, a]. */
function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
  return data;
}

/** An opaque sprite with a pattern: stripes, rings or a diagonal, so references differ. */
const patterns = {
  stripes: (x: number) => (Math.floor(x / 8) % 2 ? 230 : 30),
  rings: (x: number, y: number) => (Math.floor(Math.hypot(x - 32, y - 32) / 6) % 2 ? 220 : 40),
  diagonal: (x: number, y: number) => (x > y ? 200 : 50),
};
const sprite = (kind: keyof typeof patterns) =>
  image(64, 64, (x, y) => {
    const v = patterns[kind](x, y);
    return [v, 255 - v, v / 2, 255];
  });

/** The sprite drawn at 80% inside a dark 100×100 slot, as the game frames it. */
const slotOf = (kind: keyof typeof patterns) =>
  image(100, 100, (x, y) => {
    const sx = Math.floor(((x - 10) / 80) * 64);
    const sy = Math.floor(((y - 10) / 80) * 64);
    if (sx < 0 || sy < 0 || sx >= 64 || sy >= 64) return [15, 12, 10, 255];
    const v = patterns[kind](sx, sy);
    return [v, 255 - v, v / 2, 255];
  });

const refs = (['stripes', 'rings', 'diagonal'] as const).map((kind, i) =>
  prepareReference(i + 1, sprite(kind), 64, 64),
);

describe('resizeRgba', () => {
  it('averages the footprint of each output pixel', () => {
    // Arrange: a 2×2 image, black and white columns.
    const src = image(2, 2, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    // Act
    const out = resizeRgba(src, 2, 2, 1);
    // Assert
    expect([...out]).toEqual([127.5, 127.5, 127.5, 255]);
  });

  it('never reads past the image, whatever the ratio', () => {
    // Arrange: sizes whose footprints do not divide evenly.
    const src = image(131, 97, () => [10, 20, 30, 255]);
    // Act
    const out = resizeRgba(src, 131, 97, ICON_SIZE);
    // Assert
    expect(out.some(Number.isNaN)).toBe(false);
    expect(out[0]).toBeCloseTo(10);
  });

  it('returns zeros for an empty image', () => {
    expect(resizeRgba(new Uint8ClampedArray(0), 0, 0, 2).every((v) => v === 0)).toBe(true);
  });
});

describe('prepareReference', () => {
  it('leaves transparent pixels and the badge corners out of the mask', () => {
    // Arrange: transparent left half.
    const half = image(64, 64, (x) => (x < 32 ? [0, 0, 0, 0] : [200, 200, 200, 255]));
    // Act
    const ref = prepareReference(1, half, 64, 64);
    // Assert: no masked pixel on the left, and the bottom-right corner is out too.
    const at = (x: number, y: number) => ref.mask[y * ICON_SIZE + x];
    expect(at(2, 12)).toBe(0);
    expect(at(18, 2)).toBe(1);
    expect(at(ICON_SIZE - 1, ICON_SIZE - 1)).toBe(0);
  });
});

describe('maskedCorrelation', () => {
  it('is 1 for the same art and 0 when one side is flat', () => {
    const [stripes] = refs;
    expect(maskedCorrelation(stripes!.rgb, stripes!)).toBeCloseTo(1);
    expect(maskedCorrelation(new Float32Array(stripes!.rgb.length).fill(9), stripes!)).toBe(0);
  });
});

describe('matchIcon', () => {
  it('finds framed art among references drawn without a frame', () => {
    // Arrange
    const slot = slotOf('rings');
    // Act
    const result = matchIcon(prepareSlot(slot, 100, 100, [0, 0, 1, 1]), refs);
    // Assert
    expect(result).toMatchObject({ status: 'match', id: 2 });
  });

  it('reduces a slot the same from its own pixels as from the whole frame', () => {
    // Arrange: the slot sits inside a larger frame; only the slot's rectangle is read (M116).
    const frame = image(300, 200, (x, y) => [(x * 3) % 256, (y * 5) % 256, (x + y) % 256, 255]);
    const region = [0.31, 0.22, 0.27, 0.41] as const;
    const view = pixelRect(300, 200, region);
    const part = cropRgba(frame, 300, 200, region).data;
    // Act
    const fromView = prepareSlot(part, 300, 200, region, view);
    // Assert
    expect(fromView).toEqual(prepareSlot(frame, 300, 200, region));
  });

  it('says none for a slot that is like nothing', () => {
    const blank = image(100, 100, () => [15, 12, 10, 255]);
    expect(matchIcon(prepareSlot(blank, 100, 100, [0, 0, 1, 1]), refs)).toEqual({ status: 'none' });
  });

  it('asks when two references score alike', () => {
    // Arrange: the same art twice under two ids.
    const twins = [refs[1]!, { ...refs[1]!, id: 9 }];
    // Act
    const result = matchIcon(prepareSlot(slotOf('rings'), 100, 100, [0, 0, 1, 1]), twins);
    // Assert
    expect(result).toMatchObject({ status: 'ambiguous', ids: [2, 9] });
  });

  it('says none with no candidates', () => {
    expect(matchIcon(prepareSlot(slotOf('rings'), 100, 100, [0, 0, 1, 1]), [])).toEqual({ status: 'none' });
  });
});
