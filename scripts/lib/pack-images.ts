/**
 * Which theme pack images to take from eldritchtools/limbus-assets, and how to shrink them (M100).
 *
 * The owner chose to show the game's pack art on the pack cards. The upstream files
 * (`assets/theme_packs/{image}.webp`, ~380×690, ~100 KB) are three times the widest card (96px), so
 * they are downscaled to `PACK_IMAGE_WIDTH` and re-encoded: 116 of them at full size would be ~12 MB
 * in the repository and a megabyte or two on every floor a phone looks at.
 *
 * Which file is which pack comes from the source's own `data/md_theme_packs.json` (`image`, keyed by
 * pack id) — it matches our `sprite` for every pack the static data ships, and it is the only thing
 * that names the art of packs we backfilled from that source (the Canto X packs carry their id as
 * `sprite`). We save each file under the pack's `sprite`, the same key `public/art/` uses.
 */
import type { ThemePack } from '../../src/core/schema.ts';

/** Where the images live, one `{sprite}.webp` per key, plus `manifest.json`. */
export const PACK_IMAGE_DIR = 'public/icons/packs';
export const UPSTREAM_PACK_DIR = 'assets/theme_packs';
/** Output width in px: the widest card (96px) on a 2.5× screen. Height keeps the aspect. */
export const PACK_IMAGE_WIDTH = 256;
/** libwebp quality: the cards are small, and 75 keeps a pack at ~16 KB without visible blocks. */
export const PACK_IMAGE_QUALITY = 75;
/** An upstream pack file is ~100 KB; anything this large is not one. */
export const MAX_UPSTREAM_PACK_BYTES = 1024 * 1024;
/** A re-encoded pack is ~10–30 KB. */
export const MAX_PACK_IMAGE_BYTES = 96 * 1024;

/** The slice of an eldritchtools theme pack entry this file reads. */
export interface DerivedPackEntry {
  image?: string;
}

export interface PackImagePlan {
  /** One download per sprite key, ascending by key. */
  downloads: { key: string; remote: string }[];
  /** Sprite keys no pack of theirs has an `image` for, ascending. */
  unmapped: string[];
}

/**
 * Match every sprite key to its upstream file. Packs that share a sprite need it once; the first
 * pack (by id) that has an `image` names the file.
 */
export function planPackImages(
  packs: readonly Pick<ThemePack, 'id' | 'sprite'>[],
  derived: Readonly<Record<string, DerivedPackEntry>>,
): PackImagePlan {
  const bySprite = new Map<string, string | null>();
  for (const pack of [...packs].sort((a, b) => a.id - b.id)) {
    if (bySprite.get(pack.sprite)) continue;
    bySprite.set(pack.sprite, derived[String(pack.id)]?.image ?? null);
  }
  const downloads: PackImagePlan['downloads'] = [];
  const unmapped: string[] = [];
  for (const [key, image] of [...bySprite].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (image) downloads.push({ key, remote: `${UPSTREAM_PACK_DIR}/${image}.webp` });
    else unmapped.push(key);
  }
  return { downloads, unmapped };
}

export interface Rgba {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Shrink an RGBA image to `width` (height keeps the aspect, rounded) by averaging the source area
 * each output pixel covers. Never enlarges: a source already that narrow comes back as a copy.
 * Colour is weighted by alpha, so the transparent margin around a pack does not bleed dark fringes
 * into its edge.
 */
export function downscaleRgba(src: Rgba, width: number): Rgba {
  if (src.width <= width)
    return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
  const height = Math.max(1, Math.round((src.height * width) / src.width));
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let py = Math.floor(y0); py < Math.min(src.height, Math.ceil(y1)); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        for (let px = Math.floor(x0); px < Math.min(src.width, Math.ceil(x1)); px++) {
          const w = wy * (Math.min(x1, px + 1) - Math.max(x0, px));
          const i = (py * src.width + px) * 4;
          const alpha = src.data[i + 3]! * w;
          r += src.data[i]! * alpha;
          g += src.data[i + 1]! * alpha;
          b += src.data[i + 2]! * alpha;
          a += alpha;
          area += w;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / area);
    }
  }
  return { data: out, width, height };
}
