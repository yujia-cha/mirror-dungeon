/**
 * Has the game screen changed since the last read? (M103)
 *
 * OCR costs ~100ms a region and the screen holds still most of the time — a popup stays until
 * 「확인」, the map until the player moves — so the loop compares a cheap signature every tick and
 * reads only when it moves. The signature is every layout region shrunk to a small grey patch:
 * titles say which screen it is, the name regions catch a new popup over the same title (the
 * second of two popups changes only its name).
 *
 * Pure. Works on any RGBA buffer, so the loop can feed it a downscaled copy of the frame.
 */
import type { CaptureLayout } from '../../core/schema.ts';
import type { Region } from './preprocess.ts';

/** Each region becomes a PATCH_W × PATCH_H grey patch. */
export const PATCH_W = 16;
export const PATCH_H = 8;
const PATCH = PATCH_W * PATCH_H;

/** Mean absolute grey difference (0–255) over a patch above which that region counts as changed. */
export const CHANGE_THRESHOLD = 6;

/** Every region the loop watches: titles, name regions and the fusion header. Deduplicated, in order. */
export function watchedRegions(layout: CaptureLayout): Region[] {
  const all: Region[] = [
    ...layout.titles.map((t) => t.region),
    layout.names.popup,
    layout.names.selected,
    layout.names.centerConfirm,
    layout.names.mapHeader,
    layout.fusion.count,
  ];
  const seen = new Set<string>();
  return all.filter((r) => {
    const key = r.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The regions shrunk to grey patches by area average, concatenated. */
export function signatureOf(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  regions: readonly Region[],
): Uint8Array {
  const out = new Uint8Array(regions.length * PATCH);
  regions.forEach(([rx, ry, rw, rh], r) => {
    for (let py = 0; py < PATCH_H; py++) {
      const y0 = Math.floor((ry + (rh * py) / PATCH_H) * height);
      const y1 = Math.max(y0 + 1, Math.floor((ry + (rh * (py + 1)) / PATCH_H) * height));
      for (let px = 0; px < PATCH_W; px++) {
        const x0 = Math.floor((rx + (rw * px) / PATCH_W) * width);
        const x1 = Math.max(x0 + 1, Math.floor((rx + (rw * (px + 1)) / PATCH_W) * width));
        let sum = 0;
        let n = 0;
        for (let y = y0; y < Math.min(y1, height); y++) {
          for (let x = x0; x < Math.min(x1, width); x++) {
            const i = (y * width + x) * 4;
            sum += (rgba[i]! * 77 + rgba[i + 1]! * 150 + rgba[i + 2]! * 29) >> 8;
            n += 1;
          }
        }
        out[r * PATCH + py * PATCH_W + px] = n ? Math.round(sum / n) : 0;
      }
    }
  });
  return out;
}

/**
 * A black frame (M153): the game fades through black between sections. Measured on the owner's
 * filmstrips (1651 previews of three sessions, the signature as the session takes it): black and
 * the darkest frames of a fade average 1.0–3.1 over the signature's cells with at most 0.5% of the
 * cells above 24 (the cursor); the darkest screen with anything on it averages 8.3 with 5.9% above
 * 24 (a lobby, a picker fading in: 9–12, 9–18%). The thresholds sit between, nearer black.
 */
export const BLACK_MEAN = 4;
export const BLACK_CELL = 24;
export const BLACK_SHARE = 0.01;

/**
 * Whether a signature (`signatureOf`) is black: its cells average at most `BLACK_MEAN` and at most
 * `BLACK_SHARE` of them are brighter than `BLACK_CELL`. Every watched region is dark then — no
 * title, no name, no popup — so there is nothing to read on it. An empty signature is not black.
 */
export function isBlack(signature: Uint8Array): boolean {
  if (signature.length === 0) return false;
  let sum = 0;
  let bright = 0;
  for (const v of signature) {
    sum += v;
    if (v > BLACK_CELL) bright += 1;
  }
  return sum / signature.length <= BLACK_MEAN && bright / signature.length <= BLACK_SHARE;
}

/**
 * Whether `next` differs from `prev` anywhere: some region's patch moved by more than `threshold`
 * on average. No previous signature, or one of another length (the layout changed), counts as
 * changed.
 */
export function changed(prev: Uint8Array | null, next: Uint8Array, threshold = CHANGE_THRESHOLD): boolean {
  if (!prev || prev.length !== next.length) return true;
  for (let start = 0; start < next.length; start += PATCH) {
    let diff = 0;
    for (let i = start; i < start + PATCH; i++) diff += Math.abs(next[i]! - prev[i]!);
    if (diff / PATCH > threshold) return true;
  }
  return false;
}
