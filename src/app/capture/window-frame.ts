/**
 * Where the game sits inside the shared picture (M134).
 *
 * Sharing the game *window* (not the screen, not a borderless client) brings the window's title
 * bar along: an owner session came in at 1928×1043 — a 30px light bar over a 1928×1013 client,
 * the reference's own aspect (1920×1009) — and the 30px pushed the full-screen title half out of
 * its region, so the pack picker was never recognised. The layout's regions are fractions of the
 * client area, so the fix is to find the bar and move every region below it.
 *
 * Only a bar on top: no side or bottom border was seen (YAGNI). A near-black band is not taken
 * for one — black above the game is the game's own dark top or a letterbox, which comes with a
 * bottom band this does not handle.
 *
 * Pure. Works on any RGBA buffer holding at least the frame's first `rows` rows.
 */
import type { CaptureLayout } from '../../core/schema.ts';
import type { Region } from './preprocess.ts';

/** The shortest and tallest band taken for a title bar, px. */
export const TITLE_BAR_MIN = 12;
export const TITLE_BAR_MAX = 80;
/** …and never more than this share of the frame's height. */
export const TITLE_BAR_MAX_SHARE = 0.08;
/** A row belongs to the band when this share of its pixels is the band's colour (text and buttons are the rest). */
const BAND_SHARE = 0.75;
/** The row under the band must clearly differ: at most this share of it is the band's colour. */
const BELOW_SHARE = 0.25;
/** How far, per channel, a pixel may stray from the band's colour and still be it (JPEG noise). */
const TOLERANCE = 16;
/** A band at most this bright in every channel is the game's black, not a title bar. */
const DARK_MAX = 20;
/**
 * The band's colour is read on this row: past a 1–2px window border, inside any title bar. The
 * rows above it count as the band whatever their colour.
 */
const PROBE_ROW = 2;

/** How many rows from the top `titleBarHeight` needs for a frame `height` tall: the tallest band and the row under it. */
export function titleBarRows(height: number): number {
  return Math.min(height, Math.min(TITLE_BAR_MAX, Math.floor(height * TITLE_BAR_MAX_SHARE)) + 1);
}

/** The per-channel median of one row. */
function rowColour(rgba: ArrayLike<number>, width: number, y: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const values = new Array<number>(width);
  for (let c = 0; c < 3; c++) {
    for (let x = 0; x < width; x++) values[x] = rgba[(y * width + x) * 4 + c]!;
    values.sort((a, b) => a - b);
    out[c] = values[width >> 1]!;
  }
  return out;
}

/** The share of a row's pixels within `TOLERANCE` of `colour` in every channel. */
function shareOf(rgba: ArrayLike<number>, width: number, y: number, colour: readonly number[]): number {
  let n = 0;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (
      Math.abs(rgba[i]! - colour[0]!) <= TOLERANCE &&
      Math.abs(rgba[i + 1]! - colour[1]!) <= TOLERANCE &&
      Math.abs(rgba[i + 2]! - colour[2]!) <= TOLERANCE
    )
      n += 1;
  }
  return n / width;
}

/**
 * The height in px of a window title bar at the top of an RGBA frame `width` wide, of which `rgba`
 * holds the first `rows` rows; 0 when there is none.
 *
 * A bar is a band of near-uniform rows (light or dark, text and caption buttons allowed) over a row
 * that clearly differs, between `TITLE_BAR_MIN` and `TITLE_BAR_MAX` px and at most
 * `TITLE_BAR_MAX_SHARE` of `frameHeight`. A band running to the end of the rows — an all-black or
 * all-white frame — is the game, not a bar.
 */
export function titleBarHeight(
  rgba: ArrayLike<number>,
  width: number,
  rows: number,
  frameHeight: number = rows,
): number {
  const limit = Math.min(TITLE_BAR_MAX, Math.floor(frameHeight * TITLE_BAR_MAX_SHARE));
  if (width <= 0 || rows <= PROBE_ROW || limit < TITLE_BAR_MIN) return 0;
  const colour = rowColour(rgba, width, PROBE_ROW);
  if (colour.every((c) => c <= DARK_MAX)) return 0;
  let height = PROBE_ROW;
  while (height < rows && shareOf(rgba, width, height, colour) >= BAND_SHARE) height += 1;
  if (height === PROBE_ROW || height >= rows) return 0;
  if (height < TITLE_BAR_MIN || height > limit) return 0;
  return shareOf(rgba, width, height, colour) <= BELOW_SHARE ? height : 0;
}

/**
 * A region of the client area as a region of a frame `height` tall whose top `top` px are not the
 * client: x and width stay, y and height shrink into the rest.
 */
export function regionInFrame(region: Region, top: number, height: number): [number, number, number, number] {
  const [x, y, w, h] = region;
  if (top <= 0 || height <= 0) return [x, y, w, h];
  const share = (height - top) / height;
  return [x, top / height + y * share, w, h * share];
}

/** Every region of `layout` moved below a `top`-px title bar of a frame `height` tall. */
export function layoutInFrame(layout: CaptureLayout, top: number, height: number): CaptureLayout {
  if (top <= 0) return layout;
  const map = (region: Region) => regionInFrame(region, top, height);
  return {
    ...layout,
    titles: layout.titles.map((title) => ({ ...title, region: map(title.region) })),
    names: {
      popup: map(layout.names.popup),
      selected: map(layout.names.selected),
      centerConfirm: map(layout.names.centerConfirm),
      mapHeader: map(layout.names.mapHeader),
      mapPack: map(layout.names.mapPack),
      purchase: map(layout.names.purchase),
    },
    fusion: {
      count: map(layout.fusion.count),
      five: layout.fusion.five.map(map),
      three: layout.fusion.three.map(map),
      ring: layout.fusion.ring.map(map),
    },
    popupIcon: map(layout.popupIcon),
    purchaseIcon: map(layout.purchaseIcon),
  };
}
