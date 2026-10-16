/**
 * One captured frame → a `Frame` the tracker folds (M103).
 *
 * The same reading the spike measured (M95), behind an interface so the browser loop and the spike
 * both run it: the caller supplies OCR and icon views of regions, this decides which regions to read
 * and what the text means.
 *
 * - Titles are read region by region in the layout's order, which is the order screens win, and the
 *   reading stops at the first region that names a screen. A frame with an acquired popup costs one
 *   OCR call, not six.
 * - Each region is read with the light-text pass first and raw only when that finds nothing (M95:
 *   the map header is brown on red and the pass erases it).
 * - Names are matched against the candidates the caller passes, already narrowed by the run.
 *
 * No DOM, no timers: the caller owns the pixels and the clock.
 */
import type { CaptureLayout } from '../../core/schema.ts';
import type { Lang } from '../i18n.ts';
import { assignSlots, type Consumed, type SlotRanking, type SlotThresholds } from './fusion.ts';
import { rankIcons, type IconRef } from './match-icon.ts';
import { matchName, type MatchResult, type NameCandidate } from './match-name.ts';
import type { Region } from './preprocess.ts';
import { classifyScreen, parseFloor, type Screen } from './screens.ts';
import type { Frame } from './tracker.ts';

export interface RegionReader {
  /** OCR lines of a region; `light` runs the light-text pass first. */
  ocr(region: Region, light: boolean): Promise<string[]>;
  /** The reduced views of an icon slot (`prepareSlot`), for ranking against references. */
  slot(region: Region): Promise<Float32Array[]>;
}

export interface ReadContext {
  lang: Lang;
  packs: readonly NameCandidate[];
  gifts: readonly NameCandidate[];
  /** References of the gifts a fusion may eat — what the run holds. */
  held: readonly IconRef[];
  /**
   * References of the 잔영 materials. They are always candidates: the run gets them from toasts
   * (「…효과로 잔영 획득」) the tracker does not record, holds them in any number, and they are what
   * fusions eat most — on the run set's two real confirms, five of the eight ingredients.
   */
  materials: readonly IconRef[];
  slotThresholds?: SlotThresholds;
}

/** What one frame read, and how many OCR calls it took (for the bench). */
export interface ReadResult {
  frame: Frame;
  ocrCalls: number;
}

export async function readFrame(
  reader: RegionReader,
  layout: CaptureLayout,
  ctx: ReadContext,
): Promise<ReadResult> {
  let ocrCalls = 0;
  /** Light pass, then raw when `accept` finds nothing in it. */
  const readEither = async <T>(region: Region, accept: (lines: string[]) => T | null): Promise<T | null> => {
    ocrCalls += 1;
    const first = accept(await reader.ocr(region, true));
    if (first !== null) return first;
    ocrCalls += 1;
    return accept(await reader.ocr(region, false));
  };
  const nameIn = async (region: Region, candidates: readonly NameCandidate[]): Promise<MatchResult> => {
    const found = await readEither(region, (lines) => {
      const m = matchName(lines, candidates);
      return m.status === 'none' ? null : m;
    });
    return found ?? { status: 'none' };
  };

  let screen: Screen | null = null;
  for (const title of layout.titles) {
    const found = await readEither(title.region, (lines) => {
      const s = classifyScreen(lines, ctx.lang);
      // A region only speaks for the screens whose title lives there: a dimmed full-screen title
      // must not be read as the popup it sits behind.
      return s !== null && title.screens.includes(s) ? s : null;
    });
    if (found) {
      screen = found;
      break;
    }
  }

  const frame: Frame = { screen, floor: null, pack: null, gift: null };
  if (screen === 'exploring') {
    frame.floor = await readEither(layout.names.mapHeader, parseFloor);
    frame.pack = await nameIn(layout.names.mapHeader, ctx.packs);
  } else if (screen === 'acquired') {
    frame.gift = await nameIn(layout.names.popup, ctx.gifts);
  } else if (screen === 'sellConfirm') {
    frame.gift = await nameIn(layout.names.centerConfirm, ctx.gifts);
  } else if (screen === 'sell') {
    frame.gift = await nameIn(layout.names.selected, ctx.gifts);
  } else if (screen === 'fusionConfirm') {
    const filled = await readEither(layout.fusion.count, parseFusionCount);
    if (filled) frame.ingredients = await readIngredients(reader, layout, ctx, filled);
  }
  return { frame, ocrCalls };
}

/**
 * How many slots the 「선택한 기프트 N/M」 header says are filled. Only N is read: M is printed in a
 * dim grey that the light-text pass erases and raw OCR misreads (3/3 came out 「3/1」 on the run set).
 */
export function parseFusionCount(lines: readonly string[]): number | null {
  for (const line of lines) {
    const m = /기프트\D*?([1-5])/.exec(line.replace(/\s+/g, ''));
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * The fusion confirm's filled slots against what the run holds: matched ones eaten, muddled ones
 * asked. The confirm has two shapes — up to five small slots, or exactly three large ones (3/3) —
 * and only three filled slots can be either; then both are tried and the one whose slots look more
 * like gifts wins, since the wrong shape's regions cut across the icons.
 */
async function readIngredients(
  reader: RegionReader,
  layout: CaptureLayout,
  ctx: ReadContext,
  filled: number,
): Promise<Consumed> {
  const heldIds = new Set(ctx.held.map((h) => h.id));
  const candidates = [...ctx.held, ...ctx.materials.filter((m) => !heldIds.has(m.id))];
  const rank = async (regions: readonly Region[]) => {
    const out = [];
    for (const region of regions) out.push(rankIcons(await reader.slot(region), candidates));
    return out;
  };
  const meanBest = (rankings: SlotRanking[]) =>
    rankings.reduce((sum, r) => sum + (r[0]?.[1] ?? 0), 0) / Math.max(1, rankings.length);
  let rankings = await rank(layout.fusion.five.slice(0, filled));
  if (filled === 3) {
    const large = await rank(layout.fusion.three);
    if (meanBest(large) > meanBest(rankings)) rankings = large;
  }
  const read = assignSlots(rankings, ctx.slotThresholds, new Set(ctx.materials.map((m) => m.id)));
  const consumed = read.flatMap((r) => (r.status === 'match' ? [r.id] : []));
  const unsure = [...new Set(read.flatMap((r) => (r.status === 'ambiguous' ? r.ids : [])))];
  return { consumed: consumed.sort((a, b) => a - b), unsure: unsure.sort((a, b) => a - b) };
}
