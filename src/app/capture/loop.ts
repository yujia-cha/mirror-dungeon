/**
 * When the capture loop reads a frame (M103), and how much of it (M136).
 *
 * Every tick the loop takes a signature (`change.ts`) and asks `decide` whether to run OCR. The
 * rules keep OCR to what is needed and never let work pile up:
 *
 * - **Changed** → read. A change seen while a read is still running is remembered (`dirty`) and read
 *   on the first free tick — only the newest frame, never a queue of old ones.
 * - **Unchanged** → skip, except a re-read `refreshMs` after the last read: OCR can miss a name on a
 *   frame that then holds still (a popup caught mid-fade stays until 「확인」, and the settled frame
 *   may differ from the faded one by less than the change threshold), and without a change it would
 *   never be tried again. The tracker dedupes, so a re-read records nothing twice.
 * - **Still unchanged** → each further re-read waits twice as long, up to `REFRESH_MAX_MS`, and a
 *   change starts over at `refreshMs` (M108). Re-reading the same pixels finds the same text, so
 *   the first re-read is the one that catches a settled fade; the later ones only cost. On the
 *   bench's run of screens the fixed 2s re-read was most of the OCR time.
 * - **Popup burst** (M136) → for `POPUP_BURST_MS` after a read that found an acquired popup, reads
 *   are `popup` reads: the popup's title only, stopping there when none shows (`read-frame.ts`).
 *   The player clicks through a row of popups in about half a second each, and a full read of the
 *   blink between two of them reads every title region (~600 ms) while the next popup comes and
 *   goes — the owner's session missed three of six that way. A popup read of nothing is one OCR
 *   call, so the loop keeps up with the ticks. Meanwhile the first re-read of an unchanged screen
 *   comes after `BURST_REFRESH_MS` instead of `refreshMs` (a popup caught mid-fade; the next one is
 *   clicked away well within 2 s); later ones double as usual, so a popup left on screen is not
 *   re-read every half second. Each popup found extends the burst.
 * - **Burst ticks** (M139) → the burst also ticks every `BURST_TICK_MS` and the session raises the
 *   share to `FRAME_RATE.burst`: a popup clicked away between two 250 ms ticks was never seen at all.
 *   Since M141 the session ticks on every frame the share delivers in the burst
 *   (`requestVideoFrameCallback`), `BURST_TICK_MS` being the backstop for a screen that holds still.
 * - **While busy** (M141) → a skipped tick no longer only marks the loop dirty: a popup seen under a
 *   busy read is queued (`backlog.ts`) and read after it, before the loop is free. The dirty read
 *   of the newest frame still follows. Since M142 a queued popup also makes the ticks follow the
 *   frames for `QUEUED_FAST_MS` (`fastTicks`), as the burst does once that popup is read.
 * - **After the burst** → a popup read that found no popup saw only the title, so the first tick
 *   after the burst reads in full even when nothing changed (`owed`): what the popups gave way to
 *   (a map, the pack picker) is read late, never lost.
 * - **A map read short of its floor or pack** (M148) → the next re-read of an unchanged screen comes
 *   after `BURST_REFRESH_MS`, then doubles as ever. Right after an entry the header settles while it
 *   is read; a read that saw 「층 탐사 중」 but not the floor or the pack's name used to wait 2 s and
 *   then 4 s for the same frame read clean — the owner's 「each floor is recognised slowly」.
 * - **Ranges and load** (M142) → a preset is a range the tick interval floats in, and the re-read
 *   schedule is the load level's (`pace.ts`: activity pulls the interval to the range's `min`, a
 *   still screen relaxes it to `max`; a strained machine re-reads unchanged screens later).
 * - **A moving screen of nothing** (M142) → a full read that found no screen while the screen
 *   changed under it (a battle) holds the next change read back for `holdMs` — the range's `max`:
 *   with the ticks at `min`, a battle was otherwise read back to back, OCR all the while (the
 *   stress bench: 96% of a minute of battle on balanced, 84% at the fixed 250 ms before). The
 *   ticks go on; a popup region that settles into something new reads at once (`urgent`), and so
 *   does the full read a burst owes.
 *
 * Pure: the caller owns the clock and the timer.
 */
import { BASE_REFRESH, type IntervalRange, type RefreshPolicy } from './pace.ts';
import type { Frame } from './tracker.ts';

/**
 * Read interval presets, the four of the reference site's assist mode. `balanced` is the default.
 * Since M142 each is a range, ms, the tick interval floats in (`pace.ts`): `min` while anything
 * moves or popups may come, `max` on a screen that holds still. Each `max` is no longer than the
 * fixed interval it replaced (quality's 125 aside: 150, since quality's ticks sit at 80 whenever
 * anything moves), so a still screen ticks no less often than before M142 did on balanced and
 * below, and activity ticks faster than before on every preset.
 */
export const READ_INTERVALS = {
  economy: { min: 250, max: 1000 },
  performance: { min: 150, max: 500 },
  balanced: { min: 100, max: 250 },
  quality: { min: 80, max: 150 },
} as const satisfies Record<string, IntervalRange>;
export type ReadIntervalPreset = keyof typeof READ_INTERVALS;
export const DEFAULT_READ_INTERVAL: ReadIntervalPreset = 'balanced';

/** An unchanged screen is read again after this long… */
export const REFRESH_MS = BASE_REFRESH.firstMs;
/** …then after twice as long each time, up to this (at load level 0 — `refreshFor`, M142). */
export const REFRESH_MAX_MS = BASE_REFRESH.maxMs;
/** How long after a popup was read the reads look for popups only (M136). */
export const POPUP_BURST_MS = 3000;
/** During the burst, the first re-read of an unchanged screen comes this soon (M136). */
export const BURST_REFRESH_MS = 500;
/**
 * During the burst the loop ticks this often, whatever the preset (M139). The owner's second
 * session showed every popup that stood through a 250 ms tick was read, and one clicked away
 * between two ticks was never seen; a popup read is one OCR call (~34 ms), so 80 ms keeps up.
 */
export const BURST_TICK_MS = 80;
/**
 * The share's frame rate (M139): low while nothing hurries — a new frame every 125 ms is plenty
 * for the preset ticks — and high in a burst, or the 80 ms ticks would mostly see the same frame.
 */
export const FRAME_RATE = { idle: 8, burst: 30 } as const;

/**
 * After a tick queued a popup under a busy read (M142), the ticks follow the share's frames this
 * long, as in a burst — the reads do not change. A popup queued under a busy read has not been read
 * yet, so no burst has begun: on a slow machine (a full read of seconds) the popups clicked through
 * after it would otherwise be ticked on at the preset's interval and the share's idle rate, and a
 * popup shown for a frame or two would slip between the ticks.
 */
export const QUEUED_FAST_MS = 1000;

/** Reads are popup reads until `burstUntil` (M136). */
export function inBurst(state: LoopState, now: number): boolean {
  return now < state.burstUntil;
}

/** Ticks follow the share's frames: in a burst, or just after a popup was queued (M142). */
export function fastTicks(state: LoopState, now: number): boolean {
  return inBurst(state, now) || now < state.fastUntil;
}

/** A tick queued a popup under the busy read (`backlog.ts`): tick fast for `QUEUED_FAST_MS` (M142). */
export function queuedPopup(state: LoopState, now: number): LoopState {
  return { ...state, fastUntil: Math.max(state.fastUntil, now + QUEUED_FAST_MS) };
}

/**
 * How long until the next tick: `BURST_TICK_MS` while ticks are fast (a popup burst, or a popup
 * just queued — `fastTicks`), the interval otherwise (M139; since M142 the interval floats in the
 * preset's range, `pace.ts`). While fast it is the backstop of the per-frame tick (M141), and the
 * whole of it where the browser has no `requestVideoFrameCallback`.
 */
export function tickDelay(state: LoopState, now: number, intervalMs: number): number {
  return fastTicks(state, now) ? Math.min(intervalMs, BURST_TICK_MS) : intervalMs;
}

export interface LoopState {
  /** Signature of the frame last handed to a read. */
  lastRead: Uint8Array | null;
  /** When that read started. */
  lastReadAt: number;
  busy: boolean;
  /** A change was seen while busy. */
  dirty: boolean;
  /** How long after the last read an unchanged screen is read again. */
  refreshGap: number;
  /** Until when reads are popup reads (M136); `-Infinity` outside a burst. */
  burstUntil: number;
  /** A popup read found no popup: the next read after the burst is a full one, changed or not. */
  owed: boolean;
  /** Until when ticks follow the frames because a popup was queued (M142); `-Infinity` when not. */
  fastUntil: number;
  /**
   * Until when a change waits to be read (M142): the last full read found nothing while the screen
   * moved under it — a battle. `-Infinity` when nothing holds.
   */
  holdUntil: number;
}

export const INITIAL_LOOP: LoopState = {
  lastRead: null,
  lastReadAt: -Infinity,
  busy: false,
  dirty: false,
  refreshGap: REFRESH_MS,
  burstUntil: -Infinity,
  owed: false,
  fastUntil: -Infinity,
  holdUntil: -Infinity,
};

export type Decision = 'read' | 'skip';
/** A full read of every title, or a popup read of the popup's title only (M136). */
export type ReadMode = 'full' | 'popup';

/**
 * Fold one tick. `isChanged` compares this tick's signature with `state.lastRead` (pass the
 * `changed` result). On 'read' the caller starts a read of `mode` and calls `finished` when it is
 * done. `refresh` is the load level's re-read schedule (`refreshFor`, M142). `urgent`: the popup's
 * regions settled into something new since the last read (M142) — read now even while a moving
 * screen holds the reads back (`holdUntil`).
 */
export function decide(
  state: LoopState,
  signature: Uint8Array,
  isChanged: boolean,
  now: number,
  refresh: RefreshPolicy = BASE_REFRESH,
  urgent = false,
): { state: LoopState; decision: Decision; mode: ReadMode } {
  const refreshMs = refresh.firstMs;
  const burst = inBurst(state, now);
  const mode: ReadMode = burst ? 'popup' : 'full';
  if (state.busy) {
    return {
      state: isChanged && !state.dirty ? { ...state, dirty: true } : state,
      decision: 'skip',
      mode,
    };
  }
  const fresh = isChanged || state.dirty || (!burst && state.owed);
  // A moving screen that read as nothing is read again at the range's slow end, not the tick's
  // (M142): the ticks stay fast for what may come, the OCR does not run back to back on a battle.
  if (fresh && !burst && !urgent && !state.owed && now < state.holdUntil)
    return { state, decision: 'skip', mode };
  // Only the first re-read since a change comes sooner in the burst: `refreshGap` is still at its
  // start then, and doubles after it as ever.
  const gap = burst && state.refreshGap <= refreshMs ? BURST_REFRESH_MS : state.refreshGap;
  if (!fresh && now - state.lastReadAt < gap) return { state, decision: 'skip', mode };
  return {
    state: {
      ...state,
      lastRead: signature,
      lastReadAt: now,
      busy: true,
      dirty: false,
      refreshGap: fresh
        ? refreshMs
        : Math.min(state.refreshGap * refresh.growth, Math.max(refreshMs, refresh.maxMs)),
      // A full read settles what the popup reads left unread.
      owed: burst ? state.owed : false,
    },
    decision: 'read',
    mode,
  };
}

/** What the finished read found, for the popup burst (M136) and a short map read (M148). */
export interface ReadOutcome {
  /** When it finished. */
  at: number;
  /** It read an acquired popup. */
  popup: boolean;
  /**
   * It was a full read that named no screen (M142). With `holdMs`, if the screen changed under it,
   * the next change read waits that long (`holdUntil`).
   */
  nothing?: boolean;
  holdMs?: number;
  /** It was a popup read that found none (`Frame.partial`). */
  partial: boolean;
  /** It saw the map header but not a sure floor and pack (M148). */
  incomplete?: boolean;
}

/**
 * The outcome of a read that produced `frame` at `at` — the session and the bench share it.
 * `holdMs` is how long a moving screen of nothing holds the next change read back (M142).
 */
export function outcomeOf(
  frame: Pick<Frame, 'screen' | 'partial' | 'floor' | 'pack'>,
  at: number,
  holdMs = 0,
): ReadOutcome {
  return {
    at,
    popup: frame.screen === 'acquired',
    partial: frame.partial === true,
    nothing: frame.screen === null && frame.partial !== true,
    holdMs,
    incomplete: frame.screen === 'exploring' && (frame.floor === null || frame.pack?.status !== 'match'),
  };
}

/**
 * The read started by the last 'read' decision is done. A popup it found starts (or extends) the
 * burst; a popup read that found none leaves a full read owed; a popup found clears it; a map read
 * short of its floor or pack brings the next re-read in to `BURST_REFRESH_MS`.
 */
export function finished(state: LoopState, outcome?: ReadOutcome): LoopState {
  if (!state.busy) return state;
  if (!outcome) return { ...state, busy: false };
  return {
    ...state,
    busy: false,
    refreshGap: outcome.incomplete ? Math.min(state.refreshGap, BURST_REFRESH_MS) : state.refreshGap,
    burstUntil: outcome.popup ? outcome.at + POPUP_BURST_MS : state.burstUntil,
    owed: outcome.partial ? true : outcome.popup ? false : state.owed,
    // Nothing read while the screen moved holds the next change read back (M142); a popup read
    // that found none says nothing either way; anything named lets go.
    // The queued popup reads that follow it (partial) count from the last of them.
    holdUntil:
      outcome.nothing && outcome.holdMs && state.dirty
        ? outcome.at + outcome.holdMs
        : outcome.partial
          ? state.holdUntil > -Infinity && outcome.holdMs
            ? Math.max(state.holdUntil, outcome.at + outcome.holdMs)
            : state.holdUntil
          : -Infinity,
  };
}
