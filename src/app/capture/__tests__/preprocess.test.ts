import { describe, expect, it } from 'vitest';
import { cropRgba, isolateLightText } from '../preprocess.ts';

/** One RGBA pixel per [r, g, b], opaque. */
const pixels = (...rgb: [number, number, number][]) =>
  new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('isolateLightText', () => {
  it('turns light text black and every coloured background white', () => {
    // Arrange: beige text, then yellow, red and blue buttons, then a brown texture.
    const input = pixels([240, 225, 170], [250, 220, 30], [230, 20, 20], [20, 190, 240], [90, 60, 40]);
    // Act
    const out = isolateLightText(input);
    // Assert: only the first pixel is text.
    const values = [0, 4, 8, 12, 16].map((i) => out[i]);
    expect(values).toEqual([0, 255, 255, 255, 255]);
  });

  it('treats the threshold as inclusive', () => {
    const input = pixels([150, 150, 150], [149, 200, 200]);
    const out = isolateLightText(input, 150);
    expect([out[0], out[4]]).toEqual([0, 255]);
  });

  it('writes opaque grey pixels and leaves the input alone', () => {
    // Arrange
    const input = new Uint8ClampedArray([200, 200, 200, 0]);
    // Act
    const out = isolateLightText(input);
    // Assert
    expect([...out]).toEqual([0, 0, 0, 255]);
    expect([...input]).toEqual([200, 200, 200, 0]);
  });

  it('handles an empty image and rejects a torn buffer', () => {
    expect(isolateLightText(new Uint8ClampedArray(0))).toHaveLength(0);
    expect(() => isolateLightText(new Uint8ClampedArray(3))).toThrow(/multiple of 4/);
  });
});

describe('cropRgba', () => {
  // A 4×2 image whose red channel is the pixel index.
  const image = new Uint8ClampedArray(Array.from({ length: 8 }, (_, i) => [i, 0, 0, 255]).flat());

  it('copies the rectangle given in fractions', () => {
    // Act: the right half of the bottom row.
    const crop = cropRgba(image, 4, 2, [0.5, 0.5, 0.5, 0.5]);
    // Assert
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(1);
    expect([crop.data[0], crop.data[4]]).toEqual([6, 7]);
  });

  it('clamps a region that runs off the image', () => {
    const crop = cropRgba(image, 4, 2, [0.75, 0, 1, 2]);
    expect([crop.width, crop.height]).toEqual([1, 2]);
    expect([crop.data[0], crop.data[4]]).toEqual([3, 7]);
  });

  it('returns an empty image for a region of no size', () => {
    const crop = cropRgba(image, 4, 2, [0.5, 0.5, 0, 0]);
    expect([crop.width, crop.height, crop.data.length]).toEqual([0, 0, 0]);
  });
});
