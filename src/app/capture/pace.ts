/**
 * How fast the capture loop ticks, and how much optional reading it does, given the machine it
 * runs on (M142). The owner's order: never miss anything in any environment; within that, spare
 * the game.
 *
 * Two kinds of work, priced very differently:
 *
 * - A **tick** takes a signature of the watched regions on the 480-px preview (`change.ts`, about
 *   0.4 ms on the owner's machine, M108) and, while a read is busy, crops a changed popup into the
 *   backlog (`backlog.ts`, M141). Ticks are what see a popup at all, so they are spent freely.
 * - A **read** is OCR — 34 ms for a popup's title, ~600 ms for a frame that shows nothing (every
 *   title region). Reads are what the game feels, so the optional ones go first.
 *
 * So this controller does two things, both pure and on the caller's clock:
 *
 * 1. **The tick interval floats inside the preset's range** (`READ_INTERVALS`, `loop.ts`):
 *    - *Activity* pulls it to `min` at once: the signature changed since the last tick, ticks are
 *      fast (a popup burst, a popup just queued), the screen has not been read since it changed
 *      (its kind is not known yet), or the screen last read is one where popups come — an acquired
 *      popup, a start picker, a screen inside a pack (shop, sell, enhance, fusion —
 *      `isInPackScreen`). Pulling in is never delayed: it is the safe direction.
 *    - *A still screen* relaxes it toward `max`, one step (×`RELAX_FACTOR`) per `RELAX_STEP_MS` of
 *      stillness. The asymmetry is the hysteresis: one change undoes it, a second of stillness
 *      starts it again, so it cannot oscillate faster than that.
 *    - Under load (level 1 and up) a still screen relaxes twice as fast (`RELAX_STEP_STRAINED_MS`):
 *      lateness says the page's thread is busy, and every tick's draw is work on it. Activity
 *      still pulls to `min` at every level: ticks cost next to nothing, and a lengthened tick is a
 *      missed popup (the stress bench: jumping straight to `max` at level 2 lost the first popup
 *      of a shop that came while the map was still being read). The interval never leaves the
 *      range.
 *    - While the interval sits at `min` the share's frames bring ticks too (`followFrames`): a
 *      popup shown on one frame shorter than the interval is still ticked on. On a still screen
 *      only the timer ticks.
 *    - Work never stacks: the session books one tick at a time, from when the last one fired.
 *
 * 2. **A load level** (`LoadLevel`) from what the machine shows — tick lateness (when a timer tick
 *    fired after it was due: the page's thread is busy), read times (full and popup reads apart),
 *    and backlog overflow. Each level cuts optional reads, in this order and no further:
 *    - level 1: the later **refresh re-reads** of an unchanged screen wait longer (`refreshFor`).
 *      The first re-read keeps its 2 s — it is the one that catches a popup read mid-fade (M108).
 *    - level 2: also the **raw pass of titles not needed in this phase of the run** — the pack
 *      picker's, once the run start is closed (`leanReads`, `read-frame.ts`). While the start is
 *      open that read closes it, so it stays.
 *    - nothing more.
 *
 *    **Never cut, at any level:** popup title reads (the popup title is read first, always), the
 *    backlog and its reads, the burst's per-frame ticks and its re-read, the run start's titles
 *    while the start is open, the pack picker's raw pass while the start is open, and the map
 *    header's reads (light and raw — they record the entries). Name reads keep their raw pass too.
 *
 *    A level is raised at once when a measure crosses its threshold (`STRAIN`) and lowered one step
 *    at a time, only after every measure stayed below half of the current level's threshold for
 *    `LOWER_HOLD_MS`. Measures are percentiles of recent samples, at most `SAMPLE_WINDOW` and
 *    `SAMPLE_MAX_AGE_MS` old, so one 500 ms lag spike raises nothing (it is one tick of thirty).
 *
 * The delivered frame rate is measured and reported (`paceStats`) but decides nothing: a window
 * that does not repaint sends no frames, so a low rate says nothing about the machine.
 *
 * Elsewhere, and not by level: a full read of nothing that the screen moved under holds the next
 * change read back by the range's `max` (`holdUntil`, `loop.ts`), and a moving popup region
 * queues little (`admit`, `backlog.ts`). `capture:stress` measures all of it under bad
 * conditions (`scripts/lib/capture-stress.ts`).
 */
import { isInPackScreen, isStartScreen, type Screen } from './screens.ts';

export interface IntervalRange {
  readonly min: number;
  readonly max: number;
}

export type LoadLevel = 0 | 1 | 2;

/** A still screen's interval grows by this factor… */
export const RELAX_FACTOR = 1.5;
/** …once per this much stillness… */
export const RELAX_STEP_MS = 1000;
/** …or this much under load (level 1 and up). */
export const RELAX_STEP_STRAINED_MS = 500;

/** The most recent samples a measure keeps, and how old they may be. */
export const SAMPLE_WINDOW = 30;
export const SAMPLE_MAX_AGE_MS = 30_000;
/** Fewer samples than this say nothing (a measure reads as calm). */
export const MIN_LATENESS_SAMPLES = 8;
export const MIN_READ_SAMPLES = 3;
/** A level is lowered one step after the measures stayed calm this long. */
export const LOWER_HOLD_MS = 10_000;

/**
 * The thresholds (p90, ms) at which a measure raises the level to 1 and to 2. From the owner's
 * sessions: popup reads averaged 34 ms (M136), full reads ran 325 ms median / 986 ms p95 (M108)
 * and up to 860 ms for a confirm dialog (M141), and a healthy page fires its timers within a few
 * ms. Lateness is also held against the range: a tick late by half the shortest interval is a tick
 * the range no longer delivers.
 */
export const STRAIN = {
  lateness: { level1: 50, level2: 150 },
  /** Lateness thresholds are at least these fractions of the range's `min`. */
  latenessOfMin: { level1: 0.5, level2: 1.5 },
  popupRead: { level1: 120, level2: 300 },
  fullRead: { level1: 1500, level2: 3000 },
} as const;

/** A sample and when it was taken. */
interface Sample {
  t: number;
  v: number;
}

export interface PaceState {
  range: IntervalRange;
  /** The next tick's delay outside a popup burst. */
  interval: number;
  level: LoadLevel;
  /** When the interval last moved toward `max`, or was pulled in. */
  lastStep: number;
  /** Since when every measure has been below half the current level's threshold; null when not. */
  calmSince: number | null;
  lateness: readonly Sample[];
  fullReads: readonly Sample[];
  popupReads: readonly Sample[];
  /** Time between the share's frames as delivered (when the browser says). */
  frameGaps: readonly Sample[];
  /** When the backlog last pushed a popup out unread (M141), or -Infinity. */
  lastDrop: number;
  /** Popups pushed out unread, all told. */
  drops: number;
}

export function initialPace(range: IntervalRange, now = 0): PaceState {
  return {
    range,
    interval: range.min,
    level: 0,
    lastStep: now,
    calmSince: null,
    lateness: [],
    fullReads: [],
    popupReads: [],
    frameGaps: [],
    lastDrop: -Infinity,
    drops: 0,
  };
}

/** The preset changed: the new range, starting at its `min` (the measures carry over). */
export function withRange(state: PaceState, range: IntervalRange, now: number): PaceState {
  return { ...state, range, interval: range.min, lastStep: now };
}

/** Screens where popups come: an acquired popup, the run start's pickers, a screen inside a pack. */
export function popupProne(screen: Screen | null): boolean {
  return screen !== null && (screen === 'acquired' || isStartScreen(screen) || isInPackScreen(screen));
}

export interface TickInput {
  now: number;
  /** The signature differs from the previous tick's. */
  changed: boolean;
  /** Ticks are fast — a popup burst, or a popup just queued (`fastTicks`, `loop.ts`). */
  burst: boolean;
  /**
   * What is on screen has not been read yet: it differs from the frame last read, a change waits,
   * or popups wait in the backlog. The screen kind below is then stale — a shop came while the
   * map was still being read — so the interval stays at `min` until a read names it.
   */
  unread: boolean;
  /** The screen the last full read named (null: nothing, or not read yet). */
  screen: Screen | null;
}

/** Fold one tick: where the interval goes next (see the file's comment), and the level. */
export function paceTick(state: PaceState, input: TickInput): PaceState {
  const { now } = input;
  const { min, max } = state.range;
  let { interval, lastStep } = state;
  if (input.changed || input.burst || input.unread || popupProne(input.screen)) {
    interval = min;
    lastStep = now;
  } else if (now - lastStep >= (state.level === 0 ? RELAX_STEP_MS : RELAX_STEP_STRAINED_MS)) {
    interval = Math.min(max, Math.round(interval * RELAX_FACTOR));
    lastStep = now;
  }
  interval = Math.max(min, Math.min(max, interval));
  return assess({ ...state, interval, lastStep }, now);
}

/**
 * Whether the ticks should also follow the share's frames (M142): while the interval sits at the
 * range's `min` — something moved, the screen is unread, or popups may come. Then every frame that
 * arrives is ticked on, however short it stays; the timer is the backstop for a window that sends
 * none. On a still screen only the timer ticks.
 */
export function followFrames(state: PaceState): boolean {
  return state.interval <= state.range.min;
}

/** A timer tick fired `ms` after it was due (negative counts as 0). */
export function paceLateness(state: PaceState, now: number, ms: number): PaceState {
  return assess({ ...state, lateness: keep(state.lateness, now, Math.max(0, ms)) }, now);
}

/**
 * Whether a finished read is a load sample (M146). Full reads always are. A popup read is one only
 * when it found no popup: that is the title alone, the cost of looking. One that found a popup also
 * read the name (and maybe the icon) — 120–270 ms on the owner's machine — and counting those
 * raised the load level on every click-through.
 */
export function isLoadSample(mode: 'full' | 'popup', foundNoPopup: boolean): boolean {
  return mode === 'full' || foundNoPopup;
}

/** A read took `ms`; queued reads are popup reads. Popup samples are title-only scans (`isLoadSample`). */
export function paceRead(state: PaceState, now: number, mode: 'full' | 'popup', ms: number): PaceState {
  const next =
    mode === 'popup'
      ? { ...state, popupReads: keep(state.popupReads, now, ms) }
      : { ...state, fullReads: keep(state.fullReads, now, ms) };
  return assess(next, now);
}

/** The share delivered a frame `gapMs` after the one before. Measured only: it decides nothing. */
export function paceFrame(state: PaceState, now: number, gapMs: number): PaceState {
  return { ...state, frameGaps: keep(state.frameGaps, now, gapMs) };
}

/** The backlog pushed `n` popups out unread: the reads cannot keep up. */
export function paceDrop(state: PaceState, now: number, n = 1): PaceState {
  if (n <= 0) return state;
  return assess({ ...state, lastDrop: now, drops: state.drops + n }, now);
}

function keep(samples: readonly Sample[], t: number, v: number): Sample[] {
  const out = samples.filter((s) => t - s.t <= SAMPLE_MAX_AGE_MS);
  out.push({ t, v });
  return out.length > SAMPLE_WINDOW ? out.slice(out.length - SAMPLE_WINDOW) : out;
}

/** Nearest-rank percentile of the samples no older than `SAMPLE_MAX_AGE_MS` at `now`; null if fewer than `minimum`. */
export function percentileOf(samples: readonly Sample[], now: number, p: number, minimum = 1): number | null {
  const values = samples.filter((s) => now - s.t <= SAMPLE_MAX_AGE_MS).map((s) => s.v);
  if (values.length < Math.max(1, minimum)) return null;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil((p / 100) * values.length) - 1))]!;
}

/** The thresholds of `level` (1 or 2) for this range. */
function thresholdsFor(range: IntervalRange, level: 1 | 2) {
  const key = level === 1 ? 'level1' : 'level2';
  return {
    lateness: Math.max(STRAIN.lateness[key], STRAIN.latenessOfMin[key] * range.min),
    popupRead: STRAIN.popupRead[key],
    fullRead: STRAIN.fullRead[key],
  };
}

/** The measures' p90s now (null where there are too few samples). */
function measures(state: PaceState, now: number) {
  return {
    lateness: percentileOf(state.lateness, now, 90, MIN_LATENESS_SAMPLES),
    popupRead: percentileOf(state.popupReads, now, 90, MIN_READ_SAMPLES),
    fullRead: percentileOf(state.fullReads, now, 90, MIN_READ_SAMPLES),
  };
}

/** Whether any measure is at or above `scale` × the level's thresholds. */
function over(state: PaceState, now: number, level: 1 | 2, scale: number): boolean {
  const m = measures(state, now);
  const th = thresholdsFor(state.range, level);
  return (
    (m.lateness !== null && m.lateness >= scale * th.lateness) ||
    (m.popupRead !== null && m.popupRead >= scale * th.popupRead) ||
    (m.fullRead !== null && m.fullRead >= scale * th.fullRead)
  );
}

/** The level the measures call for now, before hysteresis. A recent backlog overflow is level 1 at least. */
export function pressure(state: PaceState, now: number): LoadLevel {
  if (over(state, now, 2, 1)) return 2;
  if (over(state, now, 1, 1) || now - state.lastDrop <= SAMPLE_MAX_AGE_MS) return 1;
  return 0;
}

/** Raise at once; lower one step after `LOWER_HOLD_MS` below half the current level's thresholds. */
function assess(state: PaceState, now: number): PaceState {
  const wanted = pressure(state, now);
  if (wanted > state.level) return { ...state, level: wanted, calmSince: null };
  if (state.level === 0) return state.calmSince === null ? state : { ...state, calmSince: null };
  const calm = !over(state, now, state.level, 0.5) && now - state.lastDrop > SAMPLE_MAX_AGE_MS;
  if (!calm) return state.calmSince === null ? state : { ...state, calmSince: null };
  if (state.calmSince === null) return { ...state, calmSince: now };
  if (now - state.calmSince < LOWER_HOLD_MS) return state;
  return { ...state, level: (state.level - 1) as LoadLevel, calmSince: null };
}

/** How an unchanged screen is re-read at a level: the first re-read, the growth after it, the cap. */
export interface RefreshPolicy {
  firstMs: number;
  growth: number;
  maxMs: number;
}

/** The base re-read schedule (M108): 2 s, then twice as long each time up to 16 s. */
export const BASE_REFRESH: RefreshPolicy = { firstMs: 2000, growth: 2, maxMs: 16_000 };

/**
 * Rung (i): from level 1 the later re-reads grow four times as fast, up to a minute. The first
 * keeps its 2 s — the re-read that catches a settled fade (M108).
 */
export function refreshFor(level: LoadLevel): RefreshPolicy {
  return level === 0 ? BASE_REFRESH : { firstMs: BASE_REFRESH.firstMs, growth: 4, maxMs: 64_000 };
}

/** Rung (ii): from level 2 the reads skip the raw pass of titles this phase of the run does not need. */
export function leanReads(level: LoadLevel): boolean {
  return level >= 2;
}

/** The measures as the diagnostics record them (`kind: 'env'`, M142). */
export interface PaceStats {
  lateness: { p50: number; p90: number } | null;
  fullRead: { p50: number; p90: number; n: number } | null;
  popupRead: { p50: number; p90: number; n: number } | null;
  /** Frames per second as delivered (from the median gap), or null when the browser does not say. */
  deliveredFps: number | null;
}

export function paceStats(state: PaceState, now: number): PaceStats {
  const pair = (samples: readonly Sample[], minimum: number) => {
    const p50 = percentileOf(samples, now, 50, minimum);
    const p90 = percentileOf(samples, now, 90, minimum);
    return p50 === null || p90 === null ? null : { p50: Math.round(p50), p90: Math.round(p90) };
  };
  const counted = (samples: readonly Sample[]) => {
    const p = pair(samples, 1);
    return p ? { ...p, n: samples.filter((s) => now - s.t <= SAMPLE_MAX_AGE_MS).length } : null;
  };
  const gap = percentileOf(state.frameGaps, now, 50, 2);
  return {
    lateness: pair(state.lateness, 1),
    fullRead: counted(state.fullReads),
    popupRead: counted(state.popupReads),
    deliveredFps: gap && gap > 0 ? Math.round(10_000 / gap) / 10 : null,
  };
}
