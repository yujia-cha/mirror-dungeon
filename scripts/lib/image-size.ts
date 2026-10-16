/**
 * Width and height from an image file's header — PNG, JPEG and WebP, the formats `docs/copy.md`
 * accepts for the guide. The guide writes them into `GUIDE_CARDS` so the page reserves the space
 * before the picture arrives (no layout shift); reading the header is enough, nothing is decoded.
 * Returns null for anything it does not recognise, and the caller decides whether that matters.
 */
export interface ImageSize {
  width: number;
  height: number;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? webpSize(bytes) ?? jpegSize(bytes);
}

const u32be = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));

function pngSize(b: Uint8Array): ImageSize | null {
  // Signature, then the IHDR chunk: length(4) type(4) width(4) height(4).
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== 'PNG' || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 25 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === 'VP8 ' && b.length >= 30)
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    // 14 bits each, after the one-byte signature at 20.
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    // Start-of-frame markers (baseline, progressive, …) carry the size; DHT/JPG/DAC do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    i += 2 + u16be(b, i + 2);
  }
  return null;
}
