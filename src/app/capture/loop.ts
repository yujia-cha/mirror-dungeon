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
 *   (a map, the pack picker) is read late, never lost. Since M159 the burst ends sooner outside a
 *   shop when the popups are plainly over: a popup read found none and the screen held still
 *   `BURST_REFRESH_MS` after it — the next popup of a click-through comes well within that.
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
 * - **A long battle** (M153) → each further read of nothing the screen moved under doubles the hold
 *   (`HOLD_GROWTH`), up to `HOLD_MAX_MS`: the owner's 71-minute session spent 74% of its time in
 *   such stretches and read OCR 59% of it, every read finding nothing. A read that names anything
 *   lets the hold go and starts it over; one that finds nothing on a screen that held still lets it
 *   go but keeps the count (a battle pauses between moves). A screen that holds still for the hold's
 *   base length is read through it.
 * - **A black frame** (M153, `isBlack`, `change.ts`) → the game fades through black between
 *   sections (battle → loading → black → reward or map; seen on every filmstrip of a battle's end).
 *   A black frame is not read — there is nothing on it — and lets the hold go at once, even under a
 *   busy read; the first frame after it reads at once (`dark`), whatever it looks like. So a battle's
 *   longer hold never reaches the screen after it. A popup over a battle, which comes without
 *   black, settles the popup region and reads at once as ever (`urgent`). Black also ends a popup
 *   burst (the map after the reward's popup used to wait out the burst's 3 s), and the ticks stay
 *   fast for `TRANSITION_TICKS_MS` after it, where the next section's popups come.
 *
 * Pure: the caller owns the clock and the timer.
 */
import { BASE_REFRESH, type IntervalRange, type RefreshPolicy } from './pace.ts';
import type { SlotShape } from './fusion.ts';
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
/**
 * A fusion confirm read with slots that named no gift is read again — its slots alone, no OCR —
 * this often (M159). The game shows the dialog with empty frames and slides the icons in over the
 * next 0.25–0.4 s (the owner's filmstrip); the slots are not watched for changes, so before M159 the
 * screen waited for the 2 s re-read and the player had clicked through by then.
 */
export const SLOTS_REFRESH_MS = 100;
/** …for this long after the first such read: long enough for the icons, short for a stray gift. */
export const SLOTS_WINDOW_MS = 1500;
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

/**
 * A moving screen of nothing holds the next change read back by the range's `max`, and each further
 * read of nothing in a row by `HOLD_GROWTH` times as long, up to `HOLD_MAX_MS` (M153). On balanced:
 * 250, 500, 1000 ms. A battle read is ~300 ms (the owner's p50 284 ms), so at 1 s a read of a
 * battle costs about a fifth of its time instead of more than half. No longer: the screen after a
 * battle comes through black or a still loading screen, both of which let the hold go, but a moving
 * screen that is something (a map scrolling in without black) waits out what is left of it.
 */
export const HOLD_GROWTH = 2;
export const HOLD_MAX_MS = 1000;

/**
 * The hold after the `streak`-th read of nothing in a row on a moving screen: `baseMs` (the range's
 * `max`) for the first, growing by `HOLD_GROWTH`, never past `maxMs` (default: `HOLD_MAX_MS`, or
 * `baseMs` when that is longer — economy's 1000 ms already is). 0 with no streak.
 */
export function holdFor(baseMs: number, streak: number, maxMs = Math.max(HOLD_MAX_MS, baseMs)): number {
  if (streak <= 0 || baseMs <= 0) return 0;
  return Math.min(maxMs, baseMs * HOLD_GROWTH ** (streak - 1));
}

/**
 * After a black frame the ticks are fast this long (M153, `afterTransition`, `fastTicks`): every
 * frame of the share, which runs at `FRAME_RATE.burst`. The screen after a section's end is where
 * its rewards come — the reward picker, then the gift's popup over it, a second or two later on the
 * owner's filmstrips. Left to itself the interval would relax on that still screen toward the
 * range's `max` (a second on economy) and the share stay at its idle rate, and the popup would wait
 * for the next tick that long. Before M153 a read of the black frame often queued it by chance and
 * so sped the ticks up for a second (`QUEUED_FAST_MS`); now it is the rule. Ticks cost next to
 * nothing (0.4 ms); reads do not change.
 */
export const TRANSITION_TICKS_MS = 5000;

/** A black frame came within `TRANSITION_TICKS_MS` (M153). */
export function afterTransition(state: LoopState, now: number): boolean {
  return now - state.blackAt < TRANSITION_TICKS_MS;
}

/** Reads are popup reads until `burstUntil` (M136). */
export function inBurst(state: LoopState, now: number): boolean {
  return now < state.burstUntil;
}

/**
 * Ticks follow the share's frames: in a burst, just after a popup was queued (M142), or just after
 * a black frame (M153).
 */
export function fastTicks(state: LoopState, now: number): boolean {
  return inBurst(state, now) || now < state.fastUntil || afterTransition(state, now);
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
  /** Reads of nothing in a row that the screen moved under (M153): how long the hold is (`holdFor`). */
  holdStreak: number;
  /** The hold's base length, the range's `max` (M153): a screen still that long is read through it. */
  holdBase: number;
  /**
   * A black frame came since the last read started (M153): the hold is gone, and the first frame
   * that is not black reads at once.
   */
  dark: boolean;
  /** When the last black frame came (M153); `-Infinity` before any. */
  blackAt: number;
  /**
   * The fusion confirm was read with weak slots (M159): how many were filled, and until when its
   * slots are read again while the screen holds still. Null otherwise.
   */
  slots: { filled: number; shape?: SlotShape; until: number } | null;
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
  holdStreak: 0,
  holdBase: 0,
  dark: false,
  blackAt: -Infinity,
  slots: null,
};

export type Decision = 'read' | 'skip';
/** A full read of every title, or a popup read of the popup's title only (M136). */
export type ReadMode = 'full' | 'popup' | 'slots';
/**
 * Why a tick reads (M154): the screen differs from the frame last read (`change`); a read is owed
 * whatever it shows — a change seen while busy, the first frame after black, the full read after a
 * popup burst (`dirty`); or an unchanged screen is read again (`refresh`). Only `refresh` is a
 * re-read of a known screen. The session and the bench both take it from `decide`.
 */
export type ReadReason = 'change' | 'dirty' | 'refresh';

/**
 * Fold one tick. `isChanged` compares this tick's signature with `state.lastRead` (pass the
 * `changed` result). On 'read' the caller starts a read of `mode` and calls `finished` when it is
 * done. `refresh` is the load level's re-read schedule (`refreshFor`, M142). `urgent`: the popup's
 * regions settled into something new since the last read (M142) — read now even while a moving
 * screen holds the reads back (`holdUntil`). `seen` (M153): `black`, the frame is black
 * (`isBlack`) — it is not read, the hold goes, and the next frame that is not black reads at once;
 * `stillMs`, how long the signature has not moved from tick to tick — a screen that held still for
 * the hold's base length is no longer moving and is read through the hold; `settle` (M159), the
 * screen under a popup burst is news (the player is not in a shop already): once the popups are
 * plainly over the burst ends there and then.
 */
export function decide(
  state: LoopState,
  signature: Uint8Array,
  isChanged: boolean,
  now: number,
  refresh: RefreshPolicy = BASE_REFRESH,
  urgent = false,
  seen: { black?: boolean; stillMs?: number; settle?: boolean } = {},
): { state: LoopState; decision: Decision; mode: ReadMode; reason: ReadReason } {
  const { black = false, stillMs = 0, settle = false } = seen;
  const refreshMs = refresh.firstMs;
  // The popups are over (M159): a popup read found none and the screen under it has held still
  // since, as long as the burst's first re-read waits. Popups clicked through follow each other
  // within that; the screen they gave way to (the shop after its entry gift) is read in full now,
  // not when the burst runs out — the owner's run named its shops 2.7–3.4 s after such a popup.
  // Only where that screen is news (`settle` — outside the shop): inside it, each purchase's popup
  // would buy a full read of the shop the tracker already knows (+7 points of OCR on the bench).
  const settled =
    settle &&
    inBurst(state, now) &&
    state.owed &&
    !state.busy &&
    !isChanged &&
    now - state.lastReadAt >= BURST_REFRESH_MS;
  if (settled) state = { ...state, burstUntil: now };
  const burst = inBurst(state, now);
  const mode: ReadMode = burst ? 'popup' : 'full';
  const owed = state.dirty || state.dark || (!burst && state.owed);
  const reason: ReadReason = isChanged ? 'change' : owed ? 'dirty' : 'refresh';
  // A fade through black between sections (M153): nothing to read, and the hold a battle built up
  // must not reach the screen after it — even when the black comes under a busy read. It ends a
  // popup burst too: popups clicked through blink to the screen under them, never to black, so the
  // section is over and the screen after it (the map) is read in full at once, not after the burst.
  if (black)
    return {
      state: {
        ...state,
        dark: true,
        holdUntil: -Infinity,
        holdStreak: 0,
        blackAt: now,
        burstUntil: Math.min(state.burstUntil, now),
      },
      decision: 'skip',
      mode,
      reason,
    };
  if (state.busy) {
    return {
      state: isChanged && !state.dirty ? { ...state, dirty: true } : state,
      decision: 'skip',
      mode,
      reason,
    };
  }
  // The confirm's icons slide in after it (M159): its slots alone, soon, while nothing else moved.
  if (state.slots && !isChanged && !burst && now < state.slots.until) {
    if (now - state.lastReadAt < SLOTS_REFRESH_MS) return { state, decision: 'skip', mode, reason };
    return {
      state: { ...state, lastReadAt: now, busy: true },
      decision: 'read',
      mode: 'slots',
      reason: 'refresh',
    };
  }
  const fresh = reason !== 'refresh';
  // A moving screen that read as nothing is read again at the range's slow end, not the tick's
  // (M142): the ticks stay fast for what may come, the OCR does not run back to back on a battle.
  // A screen that stopped moving for the hold's base is read through a hold grown past it (M153): a
  // popup over the battle on one frame, the frames after it lost, looks like that.
  const moving = state.holdBase <= 0 || stillMs < state.holdBase;
  if (fresh && !burst && !urgent && !state.owed && !state.dark && moving && now < state.holdUntil)
    return { state, decision: 'skip', mode, reason };
  // Only the first re-read since a change comes sooner in the burst: `refreshGap` is still at its
  // start then, and doubles after it as ever.
  const gap = burst && state.refreshGap <= refreshMs ? BURST_REFRESH_MS : state.refreshGap;
  if (!fresh && now - state.lastReadAt < gap) return { state, decision: 'skip', mode, reason };
  return {
    state: {
      ...state,
      lastRead: signature,
      lastReadAt: now,
      busy: true,
      dirty: false,
      dark: false,
      refreshGap: fresh
        ? refreshMs
        : Math.min(state.refreshGap * refresh.growth, Math.max(refreshMs, refresh.maxMs)),
      // A full read settles what the popup reads left unread.
      owed: burst ? state.owed : false,
    },
    decision: 'read',
    mode,
    reason,
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
  /** How long the hold may grow over a streak of such reads (M153, `holdFor`); default its own. */
  holdMaxMs?: number;
  /** It was a popup read that found none (`Frame.partial`). */
  partial: boolean;
  /** It saw the map header but not a sure floor and pack (M148). */
  incomplete?: boolean;
  /**
   * It read the fusion confirm (M159): how many slots were filled and how many of them named no
   * gift well. Missing for any other screen.
   */
  confirm?: { filled: number; weak: number; shape?: SlotShape };
}

/**
 * The outcome of a read that produced `frame` at `at` — the session and the bench share it.
 * `holdMs` is how long a moving screen of nothing holds the next change read back (M142), and
 * `holdMaxMs` how long that grows to over a streak (M153; `holdMs` itself keeps M142's fixed hold).
 */
export function outcomeOf(
  frame: Pick<Frame, 'screen' | 'partial' | 'floor' | 'pack' | 'ingredients' | 'weakSlots' | 'slotShape'>,
  at: number,
  holdMs = 0,
  holdMaxMs = Math.max(HOLD_MAX_MS, holdMs),
): ReadOutcome {
  return {
    at,
    popup: frame.screen === 'acquired',
    partial: frame.partial === true,
    nothing: frame.screen === null && frame.partial !== true,
    holdMs,
    holdMaxMs,
    incomplete: frame.screen === 'exploring' && (frame.floor === null || frame.pack?.status !== 'match'),
    ...(frame.screen === 'fusionConfirm' && frame.ingredients?.filled
      ? {
          confirm: {
            filled: frame.ingredients.filled,
            weak: frame.weakSlots ?? 0,
            ...(frame.slotShape ? { shape: frame.slotShape } : {}),
          },
        }
      : {}),
  };
}

/**
 * The read started by the last 'read' decision is done. A popup it found starts (or extends) the
 * burst; a popup read that found none leaves a full read owed; a popup found clears it; a map read
 * short of its floor or pack brings the next re-read in to `BURST_REFRESH_MS`. A read of nothing the
 * screen moved under holds the next change read back, longer each time in a row (M142, M153) —
 * unless a black frame came under it (`dark`).
 */
export function finished(state: LoopState, outcome?: ReadOutcome): LoopState {
  if (!state.busy) return state;
  if (!outcome) return { ...state, busy: false };
  const base = outcome.holdMs ?? 0;
  const hold = (streak: number) => holdFor(base, streak, outcome.holdMaxMs ?? base);
  // Nothing read while the screen moved holds the next change read back (M142), the longer the
  // more such reads in a row (M153); a popup read that found none says nothing either way, and the
  // queued popup reads that follow a read (partial) count the hold from the last of them; a still
  // screen lets the hold go but not the streak (a battle pauses between moves); anything named or a
  // black frame lets both go.
  const moving = outcome.nothing === true && base > 0 && state.dirty && !state.dark;
  const holdStreak = moving
    ? state.holdStreak + 1
    : outcome.partial || (outcome.nothing === true && !state.dark)
      ? state.holdStreak
      : 0;
  const holdUntil = moving
    ? outcome.at + hold(holdStreak)
    : outcome.partial
      ? state.holdUntil > -Infinity && base > 0
        ? Math.max(state.holdUntil, outcome.at + hold(Math.max(1, holdStreak)))
        : state.holdUntil
      : -Infinity;
  return {
    ...state,
    busy: false,
    refreshGap: outcome.incomplete ? Math.min(state.refreshGap, BURST_REFRESH_MS) : state.refreshGap,
    burstUntil: outcome.popup ? outcome.at + POPUP_BURST_MS : state.burstUntil,
    owed: outcome.partial ? true : outcome.popup ? false : state.owed,
    // A confirm with weak slots keeps its slots read again (M159) from its first such read; a
    // confirm read whole, or any screen named after it, ends that. A popup read that found none
    // says nothing of the screen and leaves it.
    slots:
      outcome.confirm && outcome.confirm.weak > 0
        ? {
            filled: outcome.confirm.filled,
            ...(outcome.confirm.shape ? { shape: outcome.confirm.shape } : {}),
            until: state.slots?.until ?? outcome.at + SLOTS_WINDOW_MS,
          }
        : outcome.partial
          ? state.slots
          : null,
    holdUntil,
    holdStreak,
    holdBase: base,
  };
}
