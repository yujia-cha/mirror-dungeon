/**
 * Getting game text into a shape OCR reads.
 *
 * The game prints names and banner titles as light text on busy backgrounds — white on a
 * saturated tier-coloured button, beige on a brown texture. Tesseract reads almost none of that as
 * captured. But the text is light in every channel while each background is dark in at least one
 * (yellow has no blue, red has no green, brown has little of anything), so the smallest of R, G and
 * B separates them cleanly. Measured on real captures: text sits around 160–175, backgrounds below
 * ~130.
 *
 * Pure: pixels in, pixels out. The browser feeds canvas ImageData, the spike a decoded file.
 */

/** Smallest-channel value at or above which a pixel counts as text. */
export const LIGHT_TEXT_THRESHOLD = 150;

/**
 * Black text on white from RGBA pixels: a pixel whose every channel reaches `threshold` becomes
 * black, everything else white. Alpha is set opaque. Returns a new buffer the same size.
 */
export function isolateLightText(
  rgba: Uint8Array | Uint8ClampedArray,
  threshold: number = LIGHT_TEXT_THRESHOLD,
): Uint8ClampedArray {
  if (rgba.length % 4 !== 0) throw new Error(`RGBA length ${rgba.length} is not a multiple of 4`);
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const lightest = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    const value = lightest >= threshold ? 0 : 255;
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }
  return out;
}

/** A rectangle of an image, in fractions of its width and height: x, y, width, height. */
export type Region = readonly [number, number, number, number];

/**
 * Copy `region` out of an RGBA image. Fractions keep one layout file valid at every capture size;
 * the result is clamped to the image so a region at the edge never reads past it.
 */
export function cropRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
): { data: Uint8ClampedArray; width: number; height: number } {
  const left = Math.max(0, Math.round(region[0] * width));
  const top = Math.max(0, Math.round(region[1] * height));
  const right = Math.min(width, Math.round((region[0] + region[2]) * width));
  const bottom = Math.min(height, Math.round((region[1] + region[3]) * height));
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((top + y) * width + left) * 4;
    data.set(rgba.subarray(from, from + w * 4), y * w * 4);
  }
  return { data, width: w, height: h };
}
