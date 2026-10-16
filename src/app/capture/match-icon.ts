/**
 * Recognising a gift by its icon.
 *
 * The fusion confirm screen shows its ingredients as icons only — no names — so the tracker has to
 * tell which gift a framed icon on screen is. The references are the game's own icons (M92): a
 * transparent sprite with no frame. On screen the same art sits inside a hexagon frame over a dark
 * background, with the tier numeral in the top-left corner and a keyword badge in the bottom-right.
 *
 * So the comparison leaves out those two corners and correlates colour (mean-removed, normalised —
 * brightness and contrast drift between the capture and the file cancel out) twice: once only where
 * the reference has paint, once over the whole square with the reference laid on black. The first
 * alone lets a sparse icon win everywhere — a thin sword covering 6% of its square correlated with
 * nearly every slot — and the second says the art must also be absent where the reference is
 * empty. The score is their mean. Where inside the frame the art sits, and how large,
 * is not known exactly, so a handful of centred squares are tried and the best one counts.
 *
 * Pure: RGBA in, a ranking out. Candidates should be narrowed by the caller — on the fusion screen
 * only gifts the run owns can be ingredients — which is what keeps a near miss from winning.
 */
import type { MatchResult } from './match-name.ts';
import { cropRgba, type Region } from './preprocess.ts';

/** Side of the square both images are reduced to before comparing. */
export const ICON_SIZE = 24;

/** A reference icon reduced to ICON_SIZE²: colour per pixel and which pixels take part. */
export interface IconRef {
  id: number;
  /** RGB, 0..255, ICON_SIZE² × 3. */
  rgb: Float32Array;
  /** 1 where the reference is painted and outside the badge corners. */
  mask: Uint8Array;
  /** 1 everywhere outside the badge corners. */
  square: Uint8Array;
}

export interface IconThresholds {
  /** Correlation (−1..1) the best candidate needs before it counts at all. */
  minScore: number;
  /** How far ahead of the runner-up the best must be to be taken without asking. */
  minMargin: number;
}

export const DEFAULT_ICON_THRESHOLDS: IconThresholds = { minScore: 0.5, minMargin: 0.08 };

/**
 * Inner squares of an on-screen icon slot to try, as [size, x offset, y offset] in fractions of the
 * slot. The art fills about 55–85% of the frame depending on the screen and the gift.
 */
const PLACEMENTS: readonly (readonly [number, number, number])[] = [0.56, 0.64, 0.72, 0.8, 0.88].flatMap(
  (size) => [-0.04, 0, 0.04].flatMap((dx) => [-0.04, 0, 0.04].map((dy) => [size, dx, dy] as const)),
);

/**
 * Area-average an RGBA image down to `size`×`size`, every channel kept (alpha included). Each
 * output pixel averages the source pixels its footprint covers, weighted by how much of each.
 */
export function resizeRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  size: number,
): Float32Array {
  const out = new Float32Array(size * size * 4);
  if (width === 0 || height === 0) return out;
  const sx = width / size;
  const sy = height / size;
  for (let oy = 0; oy < size; oy++) {
    const y0 = oy * sy;
    const y1 = y0 + sy;
    for (let ox = 0; ox < size; ox++) {
      const x0 = ox * sx;
      const x1 = x0 + sx;
      const sum = [0, 0, 0, 0];
      let area = 0;
      // Clamped: y1 can land a hair past `height` in floating point and read outside the image.
      for (let y = Math.floor(y0); y < Math.min(height, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(width, Math.ceil(x1)); x++) {
          const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const i = (y * width + x) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += rgba[i + c]! * w;
          area += w;
        }
      }
      const o = (oy * size + ox) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = sum[c]! / area;
    }
  }
  return out;
}

/** True for pixels in the tier-numeral (top-left) or keyword-badge (bottom-right) corner. */
function inBadgeCorner(x: number, y: number): boolean {
  const fx = (x + 0.5) / ICON_SIZE;
  const fy = (y + 0.5) / ICON_SIZE;
  return (fx < 0.3 && fy < 0.3) || (fx > 0.72 && fy > 0.72);
}

/** Reduce a reference sprite (RGBA, transparent background) for matching. */
export function prepareReference(
  id: number,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): IconRef {
  const small = resizeRgba(rgba, width, height, ICON_SIZE);
  const rgb = new Float32Array(ICON_SIZE * ICON_SIZE * 3);
  const mask = new Uint8Array(ICON_SIZE * ICON_SIZE);
  const square = new Uint8Array(ICON_SIZE * ICON_SIZE);
  for (let p = 0; p < ICON_SIZE * ICON_SIZE; p++) {
    const alpha = small[p * 4 + 3]!;
    // Colour as it looks composited on black — the frame's interior is near-black.
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = (small[p * 4 + c]! * alpha) / 255;
    const x = p % ICON_SIZE;
    const y = Math.floor(p / ICON_SIZE);
    square[p] = inBadgeCorner(x, y) ? 0 : 1;
    mask[p] = alpha >= 160 && square[p] ? 1 : 0;
  }
  return { id, rgb, mask, square };
}

/**
 * The reduced views of one on-screen icon slot (`region` of an RGBA frame) to compare against
 * references: one per placement of the art inside the slot.
 */
export function prepareSlot(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
): Float32Array[] {
  const [rx, ry, rw, rh] = region;
  return PLACEMENTS.map(([size, dx, dy]) => {
    const inner: Region = [
      rx + rw * ((1 - size) / 2 + dx),
      ry + rh * ((1 - size) / 2 + dy),
      rw * size,
      rh * size,
    ];
    const crop = cropRgba(rgba, width, height, inner);
    const small = resizeRgba(crop.data, crop.width, crop.height, ICON_SIZE);
    const rgb = new Float32Array(ICON_SIZE * ICON_SIZE * 3);
    for (let p = 0; p < ICON_SIZE * ICON_SIZE; p++) {
      for (let c = 0; c < 3; c++) rgb[p * 3 + c] = small[p * 4 + c]!;
    }
    return rgb;
  });
}

/**
 * Pearson correlation of a reduced slot view and a reference over `mask`, all three channels
 * together. 0 when either side is flat there (nothing to correlate).
 */
export function maskedCorrelation(view: Float32Array, ref: IconRef, mask: Uint8Array = ref.mask): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) {
      sa += view[p * 3 + c]!;
      sb += ref.rgb[p * 3 + c]!;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) {
      const a = view[p * 3 + c]! - ma;
      const b = ref.rgb[p * 3 + c]! - mb;
      cov += a * b;
      va += a * a;
      vb += b * b;
    }
  }
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
}

/** How much a slot view looks like a reference: the mean of the painted-area and whole-square fits. */
export function iconScore(view: Float32Array, ref: IconRef): number {
  return (maskedCorrelation(view, ref) + maskedCorrelation(view, ref, ref.square)) / 2;
}

/** Every candidate's best score over the slot's placements, best first (ties by id). */
export function rankIcons(views: readonly Float32Array[], refs: readonly IconRef[]): [number, number][] {
  return refs
    .map((ref): [number, number] => [ref.id, Math.max(...views.map((view) => iconScore(view, ref)))])
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

/** Which candidate the slot shows, in the same shape as a name match. */
export function matchIcon(
  views: readonly Float32Array[],
  refs: readonly IconRef[],
  thresholds: IconThresholds = DEFAULT_ICON_THRESHOLDS,
): MatchResult {
  const ranked = rankIcons(views, refs);
  const [first, second] = ranked;
  if (!first || first[1] < thresholds.minScore) return { status: 'none' };
  const score = first[1];
  const margin = score - (second?.[1] ?? -1);
  if (margin >= thresholds.minMargin) return { status: 'match', id: first[0], score, margin };
  const ids = ranked.filter(([, s]) => score - s < thresholds.minMargin).map(([id]) => id);
  return { status: 'ambiguous', ids, score, margin };
}
