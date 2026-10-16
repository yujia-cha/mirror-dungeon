/**
 * When the capture loop reads a frame (M103).
 *
 * Every tick the loop takes a signature (`change.ts`) and asks `decide` whether to run OCR. The
 * rules keep OCR to what is needed and never let work pile up:
 *
 * - **Changed** → read. A change seen while a read is still running is remembered (`dirty`) and read
 *   on the first free tick — only the newest frame, never a queue of old ones.
 * - **Unchanged** → skip, except a re-read every `refreshMs`: OCR can miss a name on a frame that
 *   then holds still (a popup stays until 「확인」), and without a change it would never be tried
 *   again. The tracker dedupes, so a re-read records nothing twice.
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

/** An unchanged screen is read again after this long. */
export const REFRESH_MS = 2000;

export interface LoopState {
  /** Signature of the frame last handed to a read. */
  lastRead: Uint8Array | null;
  /** When that read started. */
  lastReadAt: number;
  busy: boolean;
  /** A change was seen while busy. */
  dirty: boolean;
}

export const INITIAL_LOOP: LoopState = { lastRead: null, lastReadAt: -Infinity, busy: false, dirty: false };

export type Decision = 'read' | 'skip';

/**
 * Fold one tick. `isChanged` compares this tick's signature with `state.lastRead` (pass the
 * `changed` result). On 'read' the caller starts a read and calls `finished` when it is done.
 */
export function decide(
  state: LoopState,
  signature: Uint8Array,
  isChanged: boolean,
  now: number,
  refreshMs = REFRESH_MS,
): { state: LoopState; decision: Decision } {
  if (state.busy) {
    return { state: isChanged && !state.dirty ? { ...state, dirty: true } : state, decision: 'skip' };
  }
  const due = isChanged || state.dirty || now - state.lastReadAt >= refreshMs;
  if (!due) return { state, decision: 'skip' };
  return {
    state: { lastRead: signature, lastReadAt: now, busy: true, dirty: false },
    decision: 'read',
  };
}

/** The read started by the last 'read' decision is done. */
export function finished(state: LoopState): LoopState {
  return state.busy ? { ...state, busy: false } : state;
}
