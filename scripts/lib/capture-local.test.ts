import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import encodeJpeg, { init as initJpegEncoder } from '@jsquash/jpeg/encode.js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../src/core/data/node.ts';
import { decodeImage, loadIconRefs } from './capture-local.ts';

/** A 2×1 image, red then blue. */
const PIXELS = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);

describe('decodeImage', () => {
  it('reads a PNG', async () => {
    // Arrange
    const png = new PNG({ width: 2, height: 1 });
    png.data = Buffer.from(PIXELS);
    // Act
    const image = await decodeImage(PNG.sync.write(png));
    // Assert
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.data]).toEqual([...PIXELS]);
  });

  it('reads a JPEG (Steam saves JPEG) by its magic bytes', async () => {
    // Arrange
    const wasm = createRequire(import.meta.url).resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm');
    await initJpegEncoder(await WebAssembly.compile(readFileSync(wasm)));
    const pixels = { data: new Uint8ClampedArray(PIXELS), width: 2, height: 1, colorSpace: 'srgb' };
    const bytes = await encodeJpeg(pixels as ImageData, { quality: 100 });
    // Act
    const image = await decodeImage(Buffer.from(bytes));
    // Assert: lossy, so only the size and the rough colours.
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(image.data[0]!).toBeGreaterThan(image.data[2]!);
  });
});

describe('loadIconRefs', () => {
  it('reduces the shipped icons and skips gifts without one', async () => {
    // Arrange: three real gifts and one whose icon does not exist.
    const gifts = loadGameDataFromDisk().gifts.slice(0, 3);
    const missing = { id: -1, icon: -1 };
    // Act
    const refs = await loadIconRefs([...gifts, missing]);
    // Assert
    expect(refs.map((r) => r.id)).toEqual(gifts.map((g) => g.id));
    expect(refs[0]!.rgb.length).toBeGreaterThan(0);
  });
});

it('the fixture icons exist on disk', () => {
  // Guard for the test above: it relies on the committed icons, not on a download.
  const gift = loadGameDataFromDisk().gifts[0]!;
  expect(readFileSync(`public/icons/gifts/${gift.icon}.webp`).length).toBeGreaterThan(0);
});
