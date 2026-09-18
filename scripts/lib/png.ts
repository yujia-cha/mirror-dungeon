/**
 * Just enough PNG reading to check that a file is what it claims to be.
 *
 * No image library is installed (no sharp, no ImageMagick, no Pillow), and adding one would put a
 * prebuilt binary into a dependency tree that is pure JavaScript today. A PNG's dimensions live in
 * the IHDR chunk at a fixed offset, so reading the first 24 bytes is enough — the same spirit as
 * `import-static.ts`'s `looksLikeStaticData`: check the file is what it claims before writing a
 * byte anywhere.
 */

/** `\x89PNG\r\n\x1a\n` — the 8-byte signature every PNG starts with. */
const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PngInfo = { width: number; height: number };

/**
 * The image's pixel size, or a reason it could not be read. A caller that gets `null` should
 * reject the file rather than guess.
 */
export function readPng(bytes: Buffer): { ok: true; info: PngInfo } | { ok: false; reason: string } {
  if (bytes.length === 0) return { ok: false, reason: '빈 파일' };
  // 8 magic + 4 length + 4 type + 13 IHDR data = 29 bytes before anything else can follow.
  if (bytes.length < 29) return { ok: false, reason: '너무 짧아 PNG 헤더가 없음' };
  if (!bytes.subarray(0, 8).equals(MAGIC)) return { ok: false, reason: 'PNG이 아님 (확장자만 .png)' };
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return { ok: false, reason: 'IHDR 청크가 없음' };
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) return { ok: false, reason: '크기가 0' };
  return { ok: true, info: { width, height } };
}

/** `width / height` rounded enough to compare with a target ratio without float noise. */
export function ratio({ width, height }: PngInfo): number {
  return width / height;
}

/**
 * Whether a size matches a target ratio, within 1%.
 *
 * Tight on purpose. Every size anyone would actually draw hits these ratios exactly (64×64,
 * 128×128, 256×480, 128×240), so the tolerance only has to absorb a pixel of rounding at small
 * sizes — not wave through a 64×65 that is square by accident.
 */
export function matchesRatio(info: PngInfo, target: number): boolean {
  return Math.abs(ratio(info) - target) / target <= 0.01;
}
