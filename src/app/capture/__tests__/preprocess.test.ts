import { describe, expect, it } from 'vitest';
import {
  cropRgba,
  DIM_TEXT_THRESHOLD,
  isolateDimText,
  isolateLightText,
  passPixels,
  pixelRect,
  toPnm,
} from '../preprocess.ts';

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

  it('gives the same pixels from a view of part of the image as from the whole', () => {
    // Arrange: a 37×23 image of distinct pixels, and only a window of it held (M116).
    const [w, h] = [37, 23];
    const whole = new Uint8ClampedArray(Array.from({ length: w * h * 4 }, (_, i) => (i * 7) % 251));
    const region = [0.21, 0.13, 0.52, 0.61] as const;
    const view = pixelRect(w, h, [0.2, 0.1, 0.6, 0.7]);
    const part = cropRgba(whole, w, h, [0.2, 0.1, 0.6, 0.7]).data;
    // Act
    const fromView = cropRgba(part, w, h, region, view);
    // Assert
    expect(fromView).toEqual(cropRgba(whole, w, h, region));
  });
});

describe('toPnm', () => {
  it('writes the light-text pass as a grey PGM, the same pixels isolateLightText makes', () => {
    // Arrange: text, a button, and a pixel on the threshold, in one row.
    const input = pixels([240, 225, 170], [250, 220, 30], [150, 150, 150]);
    // Act
    const out = toPnm(input, 3, 1, 'light');
    // Assert
    const header = new TextEncoder().encode('P5\n3 1\n255\n');
    expect([...out.slice(0, header.length)]).toEqual([...header]);
    const grey = isolateLightText(input).filter((_, i) => i % 4 === 0);
    expect([...out.slice(header.length)]).toEqual([...grey]);
  });

  it('writes the raw pass as an RGB PPM without alpha', () => {
    const out = toPnm(pixels([1, 2, 3], [4, 5, 6]), 1, 2, 'raw');
    const header = new TextEncoder().encode('P6\n1 2\n255\n');
    expect([...out.slice(header.length)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('writes the dim-text pass as a grey PGM, the same pixels isolateDimText makes', () => {
    // Arrange: the shop's brown heading, its near-black backdrop, and a pixel on the threshold.
    const input = pixels([90, 66, 45], [17, 2, 0], [DIM_TEXT_THRESHOLD, 0, 0]);
    // Act
    const out = toPnm(input, 3, 1, 'dim');
    // Assert
    const header = new TextEncoder().encode('P5\n3 1\n255\n');
    expect([...out.slice(0, header.length)]).toEqual([...header]);
    const grey = isolateDimText(input).filter((_, i) => i % 4 === 0);
    expect([...out.slice(header.length)]).toEqual([...grey]);
  });
});

describe('isolateDimText', () => {
  it('blackens dark text of any hue and whitens the near-black backdrop', () => {
    // Arrange: brown 「상점」, red 「특별한 상점」, the backdrop, one step under the threshold.
    const input = pixels([90, 66, 45], [116, 0, 0], [17, 2, 0], [DIM_TEXT_THRESHOLD - 1, 0, 0]);
    // Act
    const out = isolateDimText(input);
    // Assert
    expect([...out]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  });

  it('rejects a buffer that is not RGBA', () => {
    expect(() => isolateDimText(new Uint8ClampedArray(3))).toThrow(/multiple of 4/);
  });
});

describe('passPixels', () => {
  it('hands each pass the pixels it reads', () => {
    // Arrange
    const input = pixels([240, 225, 170], [90, 66, 45]);
    // Act + Assert
    expect([...passPixels(input, 'light')]).toEqual([...isolateLightText(input)]);
    expect([...passPixels(input, 'dim')]).toEqual([...isolateDimText(input)]);
    expect([...passPixels(input, 'raw')]).toEqual([...input]);
  });
});
