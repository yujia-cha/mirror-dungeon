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
 *   the map header is brown on red and the pass erases it) — for titles, only those the layout
 *   marks `raw` (M108), and raw alone for those it marks `"only"` (M136: the light pass never read
 *   them, and on a frame that shows nothing it was two wasted calls).
 * - Names are matched against the candidates the caller passes, already narrowed by the run.
 * - The run start's pickers (M135) are looked for only while the run start is open (`startOpen`):
 *   their titles are raw reads, and for the rest of the run they would cost every frame that
 *   shows nothing. Then a popup also reads what it sits over — the observation picker's title.
 *   What the pickers show picked is not read (M136): only a popup records a gift. Meanwhile the
 *   titles of screens inside a pack (the shop, fusion) are not looked for (M136, `isInPackScreen`):
 *   floor 1's pack has not been entered yet.
 * - A popup whose name is no sure match is told by its icon among the gifts whose names the text
 *   came closest to (M136, `popupIcon`): 「변형 추출 : AEDD」 reads 「변형추줄: ^ㅅ600」.
 * - The popup burst (M136, `popupOnly`): right after a popup the loop asks for the popup's title
 *   only and stops there when none shows, so a click-through of popups is read at the tick rate.
 * - A strained machine (M142, `lean`): the pack picker's raw pass is skipped once the run start is
 *   closed — the one read the load ladder cuts here.
 *
 * No DOM, no timers: the caller owns the pixels and the clock.
 */
import type { CaptureLayout, DiagTraceStep } from '../../core/schema.ts';
import type { Lang } from '../i18n.ts';
import {
  assignSlots,
  DEFAULT_SLOT_THRESHOLDS,
  type Consumed,
  type SlotRanking,
  type SlotThresholds,
} from './fusion.ts';
import { decideIcon, rankIcons, type IconRef, type IconThresholds } from './match-icon.ts';
import { matchName, rankNames, type MatchResult, type NameCandidate } from './match-name.ts';
import type { Region } from './preprocess.ts';
import {
  classifyScreen,
  isInPackScreen,
  isObservationTitle,
  isStartScreen,
  parseFloor,
  type Screen,
} from './screens.ts';
import type { Frame } from './tracker.ts';

export interface RegionReader {
  /** OCR lines of a region; `light` runs the light-text pass first. */
  ocr(region: Region, light: boolean): Promise<string[]>;
  /** The reduced views of an icon slot (`prepareSlot`), for ranking against references. */
  slot(region: Region): Promise<Float32Array[]>;
  /** The tiers a fusion slot's numeral allows (`chipTiers`, M152); omitted = not read. */
  tier?(region: Region): Promise<number[] | null>;
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
  /** Each candidate's tier, to keep a slot to the gifts its numeral allows (M152). Omitted = no filter. */
  tiers?: ReadonlyMap<number, number | null>;
  slotThresholds?: SlotThresholds;
  /** The run start is still open: look for its pickers (M135). Omitted = closed. */
  startOpen?: boolean;
  /**
   * Icon references of these gifts, for the popup's icon (M136). Omitted = the popup is read by
   * name alone. Asked only for a handful of ids, and only when the name is no sure match.
   */
  iconRefs?: (ids: readonly number[]) => Promise<IconRef[]>;
  /** A read of the popup burst (M136): the popup's title only, nothing else when it is not there. */
  popupOnly?: boolean;
  /**
   * The machine is strained (load level 2, `leanReads` in `pace.ts`, M142): skip the raw pass of
   * titles this phase of the run does not need (`RAW_FOR_START_ONLY`). Nothing else changes.
   */
  lean?: boolean;
}

/**
 * Screens whose title's raw pass only the run start needs (M142). Once the start is closed the
 * pack picker records nothing — the map header records the entry, and is never cut — so on a
 * strained machine its title is read with the light pass alone. While the start is open the pack
 * picker closes it (`startDone`), and its raw pass stays.
 */
export const RAW_FOR_START_ONLY: ReadonlySet<Screen> = new Set(['packSelect']);

/** What one frame read, and how many OCR calls it took (for the bench). */
export interface ReadResult {
  frame: Frame;
  ocrCalls: number;
  /**
   * Every pass the read made, in order — the lines OCR gave, whether they were taken, what they
   * matched (M112). The owner's diagnostics keep it, so a misread can be traced to the pass that
   * went wrong rather than only to the frame it ended in.
   */
  trace: DiagTraceStep[];
}

/**
 * The popup's icon (M136). The candidates are the gifts the name came closest to: at most
 * `candidates`, each at least `minName` alike (「변형추줄: ^ㅅ600」 puts 「변형 추출 : AEDD」 first at 0.67,
 * a worse read 「.벼현 츠출ㆍ ^ㅅ600」 at 0.47 with nothing else above 0.33), plus every gift an
 * ambiguous name named. The bar is above the fusion slots' (0.5 / 0.08): on the owner's three
 * popups the right icon scored 0.67–0.88 against all 454 gifts and the best wrong one 0.50, and a
 * popup's icon is told among names that merely look alike, not among what the run holds.
 */
export const POPUP_ICON = {
  candidates: 6,
  minName: 0.4,
  thresholds: { minScore: 0.6, minMargin: 0.15 } satisfies IconThresholds,
} as const;

export async function readFrame(
  reader: RegionReader,
  layout: CaptureLayout,
  ctx: ReadContext,
): Promise<ReadResult> {
  let ocrCalls = 0;
  const trace: DiagTraceStep[] = [];
  type Step = DiagTraceStep['step'];
  /** Note one pass: its lines, and what `accept` made of them (null = not taken). */
  const note = (step: Step, region: Region, light: boolean, lines: string[], taken: unknown): void => {
    const entry: DiagTraceStep = { step, region: [...region], light, lines, accepted: taken !== null };
    if (taken !== null && typeof taken === 'object' && 'status' in (taken as object))
      entry.match = taken as MatchResult;
    if (step === 'title') entry.screen = typeof taken === 'string' ? taken : null;
    trace.push(entry);
  };
  /** One pass, light or raw. */
  const readOnce = async <T>(
    region: Region,
    step: Step,
    light: boolean,
    accept: (lines: string[]) => T | null,
  ): Promise<T | null> => {
    ocrCalls += 1;
    const lines = await reader.ocr(region, light);
    const taken = accept(lines);
    note(step, region, light, lines, taken);
    return taken;
  };
  /** Light pass, then raw when `accept` finds nothing in it. */
  const readEither = async <T>(
    region: Region,
    step: Step,
    accept: (lines: string[]) => T | null,
  ): Promise<T | null> =>
    (await readOnce(region, step, true, accept)) ?? (await readOnce(region, step, false, accept));
  /**
   * A title region as the layout says to read it: light, light then raw, or raw only — and, on a
   * strained machine, without a raw pass this phase does not need (M142).
   */
  const readTitle = <T>(
    title: CaptureLayout['titles'][number],
    step: Step,
    accept: (lines: string[]) => T | null,
  ): Promise<T | null> => {
    const optionalRaw =
      ctx.lean === true && !ctx.startOpen && title.screens.every((s) => RAW_FOR_START_ONLY.has(s));
    return title.raw === 'only'
      ? readOnce(title.region, step, false, accept)
      : title.raw && !optionalRaw
        ? readEither(title.region, step, accept)
        : readOnce(title.region, step, true, accept);
  };
  /** A name in `region`; every line OCR gave goes into `seen` when it is passed. */
  const nameIn = async (
    region: Region,
    candidates: readonly NameCandidate[],
    seen?: string[],
  ): Promise<MatchResult> => {
    let best: MatchResult = { status: 'none' };
    const found = await readEither(region, 'name', (lines) => {
      seen?.push(...lines);
      const m = matchName(lines, candidates);
      // A pass that matched nothing still says how close it came: keep the closest for the trace.
      if (m.status !== 'none') return m;
      best = m;
      return null;
    });
    return found ?? best;
  };
  /** The popup's gift: its name, and its icon when the name is no sure match (M136). */
  const popupGift = async (): Promise<MatchResult> => {
    const seen: string[] = [];
    const byName = await nameIn(layout.names.popup, ctx.gifts, seen);
    if (byName.status === 'match' || !ctx.iconRefs) return byName;
    const close = rankNames(seen, ctx.gifts)
      .filter(([, score]) => score >= POPUP_ICON.minName)
      .slice(0, POPUP_ICON.candidates)
      .map(([id]) => id);
    const ids = [...new Set([...(byName.status === 'ambiguous' ? byName.ids : []), ...close])];
    if (ids.length === 0) return byName;
    const refs = await ctx.iconRefs(ids);
    if (refs.length === 0) return byName;
    const ranked = rankIcons(await reader.slot(layout.popupIcon), refs);
    const byIcon = decideIcon(ranked, POPUP_ICON.thresholds);
    trace.push({
      step: 'icon',
      region: [...layout.popupIcon],
      light: null,
      lines: [],
      accepted: byIcon.status === 'match',
      match: byIcon,
      icon: ranked.map(([id, score]) => [id, score] as [number, number]),
    });
    // Still unsure: as an unsure popup always was — a muddled name is asked, none is nothing.
    return byIcon.status === 'match' ? byIcon : byName;
  };

  const frame: Frame = { screen: null, floor: null, pack: null, gift: null };
  let screen: Screen | null = null;
  /** The lines of the pass that named the screen, and where they were read (set in `accept`). */
  let named = null as { lines: string[]; region: Region } | null;
  for (const title of layout.titles) {
    if (ctx.popupOnly && !title.screens.includes('acquired')) continue;
    if (!ctx.startOpen && title.screens.every(isStartScreen)) continue;
    if (ctx.startOpen && title.screens.every(isInPackScreen)) continue;
    const accept = (lines: string[]): Screen | null => {
      const s = classifyScreen(lines, ctx.lang);
      // A region only speaks for the screens whose title lives there: a dimmed full-screen title
      // must not be read as the popup it sits behind.
      if (s === null || !title.screens.includes(s)) return null;
      named = { lines, region: title.region };
      return s;
    };
    // Only titles the light pass can erase get the second, raw read (M108): on a frame that shows
    // nothing, every title region is read, and the raw reads were half of it.
    const found = await readTitle(title, 'title', accept);
    if (found) {
      screen = found;
      break;
    }
  }
  frame.screen = screen;

  if (ctx.popupOnly && screen === null) {
    frame.partial = true;
  } else if (screen === 'exploring') {
    // The map title is read in the very region the floor and the pack's name live in (M148): the
    // lines that named the screen usually carry both, and reading the region twice more, light
    // pass first, made a map frame the dearest of all. Only what they lack is read again.
    const header = layout.names.mapHeader;
    const own = named && sameRegion(named.region, header) ? named.lines : [];
    frame.floor = parseFloor(own) ?? (await readEither(header, 'floor', parseFloor));
    const fromTitle = own.length > 0 ? matchName(own, ctx.packs) : null;
    frame.pack = fromTitle?.status === 'match' ? fromTitle : await nameIn(header, ctx.packs);
  } else if (screen === 'acquired') {
    frame.gift = await popupGift();
    const behind = ctx.startOpen
      ? layout.titles.find((t) => t.screens.includes('observationSelect'))
      : undefined;
    if (behind)
      frame.overObservation =
        (await readTitle(behind, 'context', (lines) =>
          isObservationTitle(lines, ctx.lang) ? true : null,
        )) === true;
  } else if (screen === 'sellConfirm') {
    frame.gift = await nameIn(layout.names.centerConfirm, sellable(ctx));
  } else if (screen === 'sell') {
    frame.gift = await nameIn(layout.names.selected, sellable(ctx));
  } else if (screen === 'fusionConfirm') {
    const filled = await readEither(layout.fusion.count, 'fusionCount', parseFusionCount);
    if (filled) frame.ingredients = await readIngredients(reader, layout, ctx, filled, trace);
  }
  return { frame, ocrCalls, trace };
}

/**
 * The names a sale can be about (M151): the gifts the run holds and the 잔영 materials, which the
 * run holds without marks (toasts hand them out). Only these can be sold, and a sale of anything
 * else would change nothing, so matching against the season's 450 names only made a blurred read
 * ambiguous. With nothing held yet every name stays a candidate.
 */
function sellable(ctx: ReadContext): readonly NameCandidate[] {
  const ids = new Set([...ctx.held, ...ctx.materials].map((ref) => ref.id));
  const named = ctx.gifts.filter((g) => ids.has(g.id));
  return ctx.held.length > 0 ? named : ctx.gifts;
}

function sameRegion(a: Region, b: Region): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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
  trace: DiagTraceStep[] = [],
): Promise<Consumed> {
  const heldIds = new Set(ctx.held.map((h) => h.id));
  const candidates = [...ctx.held, ...ctx.materials.filter((m) => !heldIds.has(m.id))];
  // The slot's tier numeral (M152) keeps it to the candidates of that tier: a held gift of another
  // tier cannot be there, and of the five 잔영 — one bottle, five tints — only one is left. A slot
  // whose numeral reads is ranked against those alone; one that does not read keeps every candidate.
  // A tier the data does not give as a number (「EX」) is never dropped.
  const fits = (id: number, allowed: readonly number[]) => {
    const tier = ctx.tiers?.get(id) ?? null;
    return tier === null || allowed.includes(tier);
  };
  const rank = async (regions: readonly Region[]) => {
    const out = [];
    const tiers: (number[] | null)[] = [];
    for (const region of regions) {
      const allowed = ctx.tiers && reader.tier ? await reader.tier(region) : null;
      const views = await reader.slot(region);
      const pool = allowed ? candidates.filter((c) => fits(c.id, allowed)) : candidates;
      const narrowed = pool.length > 0 ? rankIcons(views, pool) : [];
      // A numeral misread (yellow art beside it) must not cost the slot its gift: when nothing of
      // the allowed tiers looks like the icon, every candidate is ranked after all.
      const weak = (narrowed[0]?.[1] ?? 0) < (ctx.slotThresholds ?? DEFAULT_SLOT_THRESHOLDS).minScore;
      out.push(allowed && weak ? rankIcons(views, candidates) : narrowed);
      tiers.push(allowed && weak ? null : allowed);
    }
    return Object.assign(out, { tiers });
  };
  const meanBest = (rankings: SlotRanking[]) =>
    rankings.reduce((sum, r) => sum + (r[0]?.[1] ?? 0), 0) / Math.max(1, rankings.length);
  let rankings = await rank(layout.fusion.five.slice(0, filled));
  let shape: 'five' | 'three' = 'five';
  if (filled === 3) {
    const large = await rank(layout.fusion.three);
    if (meanBest(large) > meanBest(rankings)) [rankings, shape] = [large, 'three'];
  }
  trace.push({
    step: 'slots',
    region: null,
    light: null,
    lines: [],
    accepted: true,
    slots: {
      shape,
      top: rankings.map((r) => r.slice(0, 3).map(([id, score]) => [id, score] as [number, number])),
      tiers: rankings.tiers,
    },
  });
  const read = assignSlots(rankings, ctx.slotThresholds, new Set(ctx.materials.map((m) => m.id)));
  const consumed = read.flatMap((r) => (r.status === 'match' ? [r.id] : []));
  const unsure = [...new Set(read.flatMap((r) => (r.status === 'ambiguous' ? r.ids : [])))];
  return { consumed: consumed.sort((a, b) => a - b), unsure: unsure.sort((a, b) => a - b), filled };
}
