import { describe, expect, it } from 'vitest';
import { imageSize } from './image-size.ts';

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('imageSize', () => {
  it('reads a PNG header', () => {
    // Arrange
    const png = bytes([0x89], 'PNG', [13, 10, 26, 10, 0, 0, 0, 13], 'IHDR', [0, 0, 3, 32, 0, 0, 1, 244]);

    // Act / Assert
    expect(imageSize(png)).toEqual({ width: 800, height: 500 });
  });

  it('reads the three WebP flavours', () => {
    // Arrange
    const riff = (chunk: string, body: number[]) =>
      bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body);
    // VP8X: flags(4) then width-1 and height-1 as 24-bit little-endian.
    const vp8x = riff('VP8X', [0, 0, 0, 0, 0x1f, 0x03, 0x00, 0xf3, 0x01, 0x00]);
    // VP8 (lossy): frame tag(3) + start code(3), then 14-bit sizes.
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0xf4, 0x01]);
    // VP8L (lossless): signature 0x2f, then width-1 (14 bits) and height-1 (14 bits).
    const w = 799;
    const h = 499;
    const bits = w | (h << 14);
    const vp8l = riff('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >>> 24) & 0xff,
      0,
    ]);

    // Act / Assert
    expect(imageSize(vp8x)).toEqual({ width: 800, height: 500 });
    expect(imageSize(vp8)).toEqual({ width: 800, height: 500 });
    expect(imageSize(vp8l)).toEqual({ width: 800, height: 500 });
  });

  it('skips JPEG segments up to the frame header', () => {
    // Arrange: SOI, an APP0 segment of length 4, then SOF0 with height 500 and width 800.
    const jpeg = bytes([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 244, 3, 32, 3, 0, 0, 0, 0,
    ]);

    // Act / Assert
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 500 });
  });

  it('returns null for something it does not know', () => {
    // Arrange / Act / Assert
    expect(imageSize(bytes('GIF89a', [0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
  });
});
