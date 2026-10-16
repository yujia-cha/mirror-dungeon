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

/** A region's pixel rectangle in a `width`×`height` image, clamped to it. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The pixels `region` covers. Fractions keep one layout file valid at every capture size; the
 * result is clamped to the image so a region at the edge never reads past it.
 */
export function pixelRect(width: number, height: number, region: Region): PixelRect {
  const left = Math.max(0, Math.round(region[0] * width));
  const top = Math.max(0, Math.round(region[1] * height));
  const right = Math.min(width, Math.round((region[0] + region[2]) * width));
  const bottom = Math.min(height, Math.round((region[1] + region[3]) * height));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Copy `region` out of an RGBA image of `width`×`height`.
 *
 * `view` says `rgba` holds only that rectangle of the image (M116: the browser reads a region's
 * pixels off the canvas, not the whole 1920×1009 frame); the region is still placed in the whole
 * image's coordinates, so the pixels come out the same as from the full frame.
 */
export function cropRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
  view: PixelRect = { left: 0, top: 0, width, height },
): { data: Uint8ClampedArray; width: number; height: number } {
  const r = pixelRect(width, height, region);
  const left = Math.max(r.left, view.left);
  const top = Math.max(r.top, view.top);
  const w = Math.max(0, Math.min(r.left + r.width, view.left + view.width) - left);
  const h = Math.max(0, Math.min(r.top + r.height, view.top + view.height) - top);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((top - view.top + y) * view.width + (left - view.left)) * 4;
    data.set(rgba.subarray(from, from + w * 4), y * w * 4);
  }
  return { data, width: w, height: h };
}

/**
 * RGBA pixels as a binary PNM image — what the browser hands Tesseract (M116). An image file
 * Tesseract decodes itself (leptonica reads PNM natively), so no canvas and no PNG encode stand
 * between the crop and the worker. `light` writes the light-text pass (`isolateLightText`) as an
 * 8-bit grey PGM in the same single pass; otherwise the pixels go as an RGB PPM. Alpha is dropped:
 * a captured frame is opaque.
 */
export function toPnm(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  light: boolean,
  threshold: number = LIGHT_TEXT_THRESHOLD,
): Uint8Array {
  const header = new TextEncoder().encode(`${light ? 'P5' : 'P6'}\n${width} ${height}\n255\n`);
  const channels = light ? 1 : 3;
  const out = new Uint8Array(header.length + width * height * channels);
  out.set(header);
  let o = header.length;
  for (let i = 0; i < width * height * 4; i += 4) {
    if (light) {
      out[o++] = Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) >= threshold ? 0 : 255;
    } else {
      out[o++] = rgba[i]!;
      out[o++] = rgba[i + 1]!;
      out[o++] = rgba[i + 2]!;
    }
  }
  return out;
}
