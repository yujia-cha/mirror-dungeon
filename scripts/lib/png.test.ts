import { describe, expect, it } from 'vitest';
import { matchesRatio, readPng } from './png.ts';

/** A minimal but real PNG header: signature + an IHDR chunk carrying the size. */
function png(width: number, height: number): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13);
  const ihdr = Buffer.concat([
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(8),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
  ihdr.writeUInt32BE(width, 4);
  ihdr.writeUInt32BE(height, 8);
  return Buffer.concat([head, len, ihdr]);
}

describe('readPng', () => {
  it('reads the size out of the IHDR chunk', () => {
    expect(readPng(png(64, 64))).toEqual({ ok: true, info: { width: 64, height: 64 } });
    expect(readPng(png(256, 480))).toEqual({ ok: true, info: { width: 256, height: 480 } });
  });

  it('rejects anything that is not a PNG, rather than guessing', () => {
    expect(readPng(Buffer.alloc(0)).ok).toBe(false);
    expect(readPng(Buffer.from('not an image at all, but long enough to pass the length check')).ok).toBe(false);
    // A JPEG renamed to .png — the case a glob-and-copy pipeline would otherwise let through.
    expect(readPng(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])).ok).toBe(false);
  });

  it('rejects a truncated file and a zero-sized image', () => {
    expect(readPng(png(64, 64).subarray(0, 20)).ok).toBe(false);
    expect(readPng(png(0, 64)).ok).toBe(false);
  });

  it('compares aspect ratios without float noise', () => {
    expect(matchesRatio({ width: 64, height: 64 }, 1)).toBe(true);
    expect(matchesRatio({ width: 128, height: 128 }, 1)).toBe(true);
    expect(matchesRatio({ width: 256, height: 480 }, 8 / 15)).toBe(true);
    expect(matchesRatio({ width: 128, height: 240 }, 8 / 15)).toBe(true);
    expect(matchesRatio({ width: 64, height: 65 }, 1)).toBe(false);
    expect(matchesRatio({ width: 256, height: 256 }, 8 / 15)).toBe(false);
  });
});
