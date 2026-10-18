/**
 * The tier numeral in a fusion slot's top-left corner (M151), read off its pixels — no OCR.
 *
 * Every ingredient on the fusion confirm wears its tier as yellow Roman numerals: Ⅰ, Ⅱ, Ⅲ are
 * that many upright bars; Ⅳ and Ⅴ carry the slanted strokes of a V. The 잔영 materials are one
 * bottle in five tints, told apart by little else than this numeral, and a held gift of another
 * tier can never be in that slot — so the tier narrows a slot's candidates before the icons are
 * ranked, which is what keeps a held gift from being read as a 잔영 or the other way round.
 *
 * How: the yellow pixels of the corner are counted per column. Bars are runs of columns at least
 * 80% as full as the fullest one. When nearly every yellow pixel sits in such a bar, the tier is the
 * number of bars (1–3). When a good share lies outside them, a V's diagonals may be there: Ⅳ or Ⅴ,
 * which this does not tell apart (no Ⅴ was on the local shots), so both stay candidates — and so
 * does the bar count, since yellow art beside the numeral looks the same (a list screen showed it).
 * No yellow, or a count that is none of these, says nothing: null, and no candidate is dropped.
 *
 * Measured on the six local confirm shots: all 16 ingredient numerals (Ⅰ–Ⅲ) and the Ⅳ and Ⅱ of
 * the result slot read right. Pure: RGBA in, tiers out.
 */
import { cropRgba, type PixelRect, type Region } from './preprocess.ts';

/** The numeral's corner, as fractions of the slot: the top-left 45% × 40%. */
const CHIP_WIDTH = 0.45;
const CHIP_HEIGHT = 0.4;
/** A bar's columns are at least this share of the fullest column. */
const BAR_FULL = 0.8;
/** More than this share of yellow outside the bars means a V's strokes. */
const SLANT_SHARE = 0.15;
/** A corner with a fullest column under this share of its height holds no numeral. */
const MIN_FULL = 0.15;

function isNumeralYellow(r: number, g: number, b: number): boolean {
  return r > 200 && g > 140 && b < 90 && r - b > 120;
}

/** The tiers a slot's numeral allows, ascending; null when it cannot be read. */
export function chipTiers(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
  view?: PixelRect,
): number[] | null {
  const [rx, ry, rw, rh] = region;
  const chip = cropRgba(rgba, width, height, [rx, ry, rw * CHIP_WIDTH, rh * CHIP_HEIGHT], view);
  if (chip.width === 0 || chip.height === 0) return null;
  const columns = new Array<number>(chip.width).fill(0);
  let total = 0;
  for (let y = 0; y < chip.height; y++) {
    for (let x = 0; x < chip.width; x++) {
      const i = (y * chip.width + x) * 4;
      if (isNumeralYellow(chip.data[i]!, chip.data[i + 1]!, chip.data[i + 2]!)) {
        columns[x]! += 1;
        total += 1;
      }
    }
  }
  const fullest = Math.max(...columns);
  if (fullest < Math.max(3, chip.height * MIN_FULL)) return null;
  let bars = 0;
  let inBars = 0;
  let inBar = false;
  for (const count of columns) {
    if (count >= fullest * BAR_FULL) {
      if (!inBar) bars += 1;
      inBar = true;
      inBars += count;
    } else inBar = false;
  }
  const upright = bars >= 1 && bars <= 3 ? [bars] : [];
  // Yellow off the bars: a V's strokes — or yellow in the art beside the numeral, which the list
  // screens showed. So the bar count stays allowed too: a wrong guess widens, never drops the truth.
  if ((total - inBars) / total > SLANT_SHARE) return [...upright, 4, 5];
  return upright.length > 0 ? upright : null;
}
