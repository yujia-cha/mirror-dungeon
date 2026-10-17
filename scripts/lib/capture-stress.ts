/**
 * Synthetic runs of screens for `capture:stress` (M142): what the read loop does when the machine
 * or the share is bad — dropped and irregular frames, slow reads, late timers, stalls of the page's
 * thread — on timelines with no game image in them.
 *
 * A screen here is what the bench needs of a shot and nothing more: what a full read of it finds
 * (`Frame`), what reading it costs, and a signature — two patches for the popup's regions, one for
 * the rest — so the backlog's popup-only comparison (M141) and an animated battle are both real.
 * Read costs are the owner's machine (M108, M136, M141): a popup's title 34 ms, any other OCR
 * call about 66 ms; a frame of nothing reads every title region (9 calls, ~600 ms), a confirm
 * dialog 860 ms. `readCost` scales them.
 *
 * Pure apart from `simulate`'s promises; deterministic for a seed.
 */
import { PATCH_H, PATCH_W } from '../../src/app/capture/change.ts';
import type { ReadMode } from '../../src/app/capture/loop.ts';
import type { IntervalRange } from '../../src/app/capture/pace.ts';
import { INITIAL_TRACKER, trackFrame, type CaptureEvent, type Frame } from '../../src/app/capture/tracker.ts';
import {
  compareEvents,
  latencies,
  simulate,
  type ShotRead,
  type SimulateResult,
  type Span,
  type StressKnobs,
} from './capture-bench.ts';

/** A screen of the synthetic runs. */
export type Screen =
  | { kind: 'map'; floor: number; packId: number }
  | { kind: 'packSelect' }
  | { kind: 'shop' }
  /** A battle, an event, a reward picker: nothing the tracker acts on. `animated` moves every tick. */
  | { kind: 'nothing'; animated?: boolean }
  /** A confirm dialog: nothing to the tracker, the slowest full read (M141). */
  | { kind: 'confirm' }
  | { kind: 'popup'; giftId: number; over: 'shop' | 'nothing' | 'confirm' };

/** A screen and how long it stays, ms. */
export type Step = [Screen, number];

const PATCH = PATCH_W * PATCH_H;
const POPUP_TITLE_MS = 34;
const OCR_MS = 66;

/** The grey level each screen paints its two patches with (far enough apart to count as changes). */
const LEVEL: Record<Exclude<Screen['kind'], 'popup'>, [number, number]> = {
  map: [10, 10],
  packSelect: [30, 30],
  shop: [50, 50],
  nothing: [70, 70],
  confirm: [90, 90],
};

/**
 * A screen's signature at `t` (when its frame was taken): the popup's two patches, then the rest.
 * Two patches for the popup's regions so a battle's motion can be told apart frame to frame: each
 * moves on its own period (97 and 262 ms) and changes by more than the threshold within 7 ms, and
 * the two come back to the same levels together only seconds apart — one patch alone would repeat
 * at some frame gap and look still.
 */
export function signatureOf(screen: Screen, t: number): Uint8Array {
  const out = new Uint8Array(3 * PATCH);
  let [a, b] =
    screen.kind === 'popup'
      ? [140 + ((screen.giftId * 17) % 110), LEVEL[screen.over][1]]
      : LEVEL[screen.kind];
  if (screen.kind === 'map') b = (b + screen.floor * 9) % 256;
  let a2 = a;
  if (screen.kind === 'nothing' && screen.animated) {
    // The whole screen moves, the popup's regions with it — never to a popup's level (>= 140).
    a = 20 + (Math.floor(t) % 97);
    a2 = 20 + (Math.floor(t * 0.37) % 97);
    b = a;
  }
  out.fill(a, 0, PATCH);
  out.fill(a2, PATCH, 2 * PATCH);
  out.fill(b, 2 * PATCH);
  return out;
}

/** The popup's regions in that signature (`popupRegionIndices`): patches 0 and 1. */
export const POPUP_REGIONS = [0, 1] as const;

const NONE: Frame = { screen: null, floor: null, pack: null, gift: null };

/** What a full read of a screen finds, and what it costs (`lean`: the ladder's rung ii, M142). */
export function fullRead(screen: Screen, lean: boolean): { frame: Frame; ocrCalls: number } {
  switch (screen.kind) {
    case 'popup':
      return {
        frame: {
          ...NONE,
          screen: 'acquired',
          gift: { status: 'match', id: screen.giftId, score: 1, margin: 1 },
        },
        ocrCalls: 2,
      };
    case 'map':
      // Titles down to the map header (the pack picker's raw pass unless lean), floor, name.
      return {
        frame: {
          ...NONE,
          screen: 'exploring',
          floor: screen.floor,
          pack: { status: 'match', id: screen.packId, score: 1, margin: 1 },
        },
        ocrCalls: lean ? 9 : 10,
      };
    case 'packSelect':
      // Found by its raw pass (M108); lean skips it once the start is closed and reads on, finding nothing.
      return lean ? { frame: NONE, ocrCalls: 8 } : { frame: { ...NONE, screen: 'packSelect' }, ocrCalls: 7 };
    case 'shop':
      return { frame: { ...NONE, screen: 'purchase' }, ocrCalls: 4 };
    case 'nothing':
    case 'confirm':
      return { frame: NONE, ocrCalls: lean ? 8 : 9 };
  }
}

/** The cost of `ocrCalls`, the first of them a popup title. */
function costOf(ocrCalls: number, extra = 0): number {
  return POPUP_TITLE_MS + OCR_MS * Math.max(0, ocrCalls - 1) + extra;
}

/** Read a screen as the loop asks: in full, or the popup's title only (M136). */
export function readScreen(screen: Screen, mode: ReadMode, lean: boolean): ShotRead {
  if (mode === 'popup' && screen.kind !== 'popup')
    return { frame: { ...NONE, partial: true }, ms: POPUP_TITLE_MS, ocrCalls: 1 };
  const { frame, ocrCalls } = fullRead(screen, lean);
  // The confirm dialog of the owner's third session read in 860 ms (M141).
  return { frame, ocrCalls, ms: costOf(ocrCalls, screen.kind === 'confirm' ? 860 - costOf(9) : 0) };
}

/** Steps back to back from 0. */
export function timelineOfSteps(steps: readonly Step[]): { spans: Span[]; screens: Screen[] } {
  const spans: Span[] = [];
  const screens: Screen[] = [];
  let at = 0;
  steps.forEach(([screen, ms], shot) => {
    spans.push({ shot, start: at, end: at + ms });
    screens.push(screen);
    at += ms;
  });
  return { spans, screens };
}

let nextGift = 9000;
const popup = (over: 'shop' | 'nothing' | 'confirm'): Screen => ({ kind: 'popup', giftId: nextGift++, over });

/**
 * A click-through from a shop (M139, M141): five popups at the owner's pace — the first stands
 * while the player reads it, the rest are clicked away in 0.1–0.3 s with a blink between, one of
 * them a double click that shows for a single 30 fps frame.
 */
export function clickThrough(floor: number): Step[] {
  const shop: Screen = { kind: 'shop' };
  return [
    [{ kind: 'map', floor, packId: 100 + floor }, 3000],
    [shop, 2000],
    [popup('shop'), 500],
    [shop, 120],
    [popup('shop'), 270],
    [shop, 120],
    [popup('shop'), 100],
    [shop, 90],
    [popup('shop'), 34],
    [shop, 150],
    [popup('shop'), 300],
    [shop, 2500],
  ];
}

/** The owner's third session (M141): a popup that came and went under a confirm dialog's read. */
export function underRead(): Step[] {
  const confirm: Screen = { kind: 'confirm' };
  return [
    [confirm, 260],
    [popup('confirm'), 270],
    [confirm, 120],
    [popup('confirm'), 450],
    [{ kind: 'nothing' }, 2500],
  ];
}

/** A battle (the popup regions move), its reward, the map, the next floor's pack picker and map. */
export function battle(floor: number): Step[] {
  return [
    [{ kind: 'nothing', animated: true }, 15_000],
    [{ kind: 'nothing' }, 1500],
    [popup('nothing'), 600],
    [{ kind: 'map', floor, packId: 100 + floor }, 4000],
    [{ kind: 'packSelect' }, 3000],
    [{ kind: 'map', floor: floor + 1, packId: 101 + floor }, 4000],
  ];
}

/** A run of the above, about 75 s: what the stress table is measured on. */
export function sessionSteps(): Step[] {
  nextGift = 9000;
  return [...clickThrough(1), ...underRead(), ...battle(1), ...clickThrough(2), ...underRead()];
}

/** A screen that holds still for `ms` — the map while the player thinks. */
export function quietSteps(ms = 120_000): Step[] {
  return [[{ kind: 'map', floor: 1, packId: 101 }, ms]];
}

/** The events a run should record: every screen it could see, read once in order. */
export function referenceEvents(screens: readonly Screen[], observable: ReadonlySet<number>): CaptureEvent[] {
  let tracker = INITIAL_TRACKER;
  const events: CaptureEvent[] = [];
  screens.forEach((screen, shot) => {
    if (!observable.has(shot)) return;
    const folded = trackFrame(tracker, fullRead(screen, false).frame);
    tracker = folded.state;
    events.push(...folded.events);
  });
  return events;
}

export interface StressRun {
  result: SimulateResult;
  /** Popups (`got:`) the page could see and did not record. */
  missedPopups: string[];
  /** Any event missed (entries too). */
  missed: string[];
  meanLatencyMs: number;
  /** OCR time over the run's length, %. */
  ocrPercent: number;
}

/** One simulated run of `steps` under a preset and a condition. */
export async function stressRun(
  steps: readonly Step[],
  options: {
    range: IntervalRange;
    adaptive?: boolean;
    stress?: StressKnobs;
    firstTickMs?: number;
    log?: (line: string) => void;
  },
): Promise<StressRun> {
  const { spans, screens } = timelineOfSteps(steps);
  const result = await simulate({
    range: options.range,
    adaptive: options.adaptive,
    firstTickMs: options.firstTickMs,
    timeline: spans,
    signature: (shot, t) => signatureOf(screens[shot]!, t),
    read: async (shot, _held, mode, lean) => readScreen(screens[shot]!, mode, lean),
    popupRegions: POPUP_REGIONS,
    stress: options.stress,
    log: options.log,
  });
  const reference = referenceEvents(screens, result.observable);
  const { missed } = compareEvents(
    reference,
    result.events.map((e) => e.event),
  );
  const lat = latencies(result.events, spans);
  return {
    result,
    missed,
    missedPopups: missed.filter((key) => key.startsWith('got:')),
    meanLatencyMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0,
    ocrPercent: result.durationMs > 0 ? (100 * result.ocrMs) / result.durationMs : 0,
  };
}

/** Stalls of `ms` every `everyMs`, from `fromMs` to `untilMs`: the 「500 ms lag spikes」. */
export function stallsEvery(everyMs: number, ms: number, untilMs: number, fromMs = everyMs / 2) {
  const out: { start: number; end: number }[] = [];
  for (let at = fromMs; at < untilMs; at += everyMs) out.push({ start: at, end: at + ms });
  return out;
}

/** The conditions `capture:stress` sweeps. */
export function conditions(durationMs: number): { name: string; stress: StressKnobs }[] {
  const frames = { drop: 0.3, jitterMs: 15 };
  const stalls = stallsEvery(7000, 500, durationMs);
  return [
    { name: 'ideal (every moment seen)', stress: {} },
    { name: 'share 8/30 fps', stress: { frames: {} } },
    { name: '30% frames dropped, ±15 ms', stress: { frames } },
    { name: 'reads ×4', stress: { frames: {}, readCost: 4 } },
    { name: 'reads ×10', stress: { frames: {}, readCost: 10 } },
    { name: 'timers ≤60 ms late, 500 ms stalls /7 s', stress: { frames: {}, lateMs: 60, stalls } },
    { name: 'all: ×10, 30% drops, late, stalls', stress: { frames, readCost: 10, lateMs: 60, stalls } },
  ];
}
