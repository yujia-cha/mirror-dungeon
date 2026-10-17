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
 * - **After the burst** → a popup read that found no popup saw only the title, so the first tick
 *   after the burst reads in full even when nothing changed (`owed`): what the popups gave way to
 *   (a map, the pack picker) is read late, never lost.
 *
 * Pure: the caller owns the clock and the timer.
 */

/** Read interval presets, the four of the reference site's assist mode. `balanced` is the default. */
export const READ_INTERVALS = {
  economy: 1000,
  performance: 500,
  balanced: 250,
  quality: 125,
} as const;
export type ReadIntervalPreset = keyof typeof READ_INTERVALS;
export const DEFAULT_READ_INTERVAL: ReadIntervalPreset = 'balanced';

/** An unchanged screen is read again after this long… */
export const REFRESH_MS = 2000;
/** …then after twice as long each time, up to this. */
export const REFRESH_MAX_MS = 16_000;
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

/** Reads are popup reads until `burstUntil` (M136). */
export function inBurst(state: LoopState, now: number): boolean {
  return now < state.burstUntil;
}

/** How long until the next tick: `BURST_TICK_MS` in a popup burst, the preset's interval otherwise (M139). */
export function tickDelay(state: LoopState, now: number, intervalMs: number): number {
  return inBurst(state, now) ? Math.min(intervalMs, BURST_TICK_MS) : intervalMs;
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
}

export const INITIAL_LOOP: LoopState = {
  lastRead: null,
  lastReadAt: -Infinity,
  busy: false,
  dirty: false,
  refreshGap: REFRESH_MS,
  burstUntil: -Infinity,
  owed: false,
};

export type Decision = 'read' | 'skip';
/** A full read of every title, or a popup read of the popup's title only (M136). */
export type ReadMode = 'full' | 'popup';

/**
 * Fold one tick. `isChanged` compares this tick's signature with `state.lastRead` (pass the
 * `changed` result). On 'read' the caller starts a read of `mode` and calls `finished` when it is
 * done.
 */
export function decide(
  state: LoopState,
  signature: Uint8Array,
  isChanged: boolean,
  now: number,
  refreshMs = REFRESH_MS,
): { state: LoopState; decision: Decision; mode: ReadMode } {
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
      refreshGap: fresh ? refreshMs : Math.min(state.refreshGap * 2, Math.max(refreshMs, REFRESH_MAX_MS)),
      // A full read settles what the popup reads left unread.
      owed: burst ? state.owed : false,
    },
    decision: 'read',
    mode,
  };
}

/** What the finished read found, for the popup burst (M136). */
export interface ReadOutcome {
  /** When it finished. */
  at: number;
  /** It read an acquired popup. */
  popup: boolean;
  /** It was a popup read that found none (`Frame.partial`). */
  partial: boolean;
}

/**
 * The read started by the last 'read' decision is done. A popup it found starts (or extends) the
 * burst; a popup read that found none leaves a full read owed; a popup found clears it.
 */
export function finished(state: LoopState, outcome?: ReadOutcome): LoopState {
  if (!state.busy) return state;
  if (!outcome) return { ...state, busy: false };
  return {
    ...state,
    busy: false,
    burstUntil: outcome.popup ? outcome.at + POPUP_BURST_MS : state.burstUntil,
    owed: outcome.partial ? true : outcome.popup ? false : state.owed,
  };
}
