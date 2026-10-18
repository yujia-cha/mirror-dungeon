/**
 * The read loop on a simulated clock (M108) — what `capture:bench` measures each interval with.
 *
 * The browser session (`src/app/capture/session.ts`) ticks on a timer, takes a signature of the
 * frame, asks `decide` whether to read, and while a read runs the ticks keep coming and only mark
 * the loop dirty. This replays the same steps against a timeline of shots: the clock jumps tick to
 * tick, a read keeps the loop busy for as long as its OCR took, and its events land when it ends.
 * Nothing waits for real time, so a ten-minute run of screens measures in seconds once the OCR
 * results are cached.
 *
 * It follows the session's M141 rules too: a busy tick whose popup part changed queues its shot
 * (`backlog.ts`), and once a read lands the queue is read oldest first as popup reads, the loop
 * busy all the while; in a popup burst the ticks come on every new frame — the next shot boundary
 * — with the `BURST_TICK_MS` timer as the backstop on a screen that holds still.
 *
 * And M142's: the tick interval floats in the preset's range and the load level cuts the optional
 * reads (`pace.ts`), fed the same measures the session feeds it — and the environment can be made
 * hostile (`StressKnobs`): frames that arrive late, irregularly or not at all, slower reads, late
 * timers and stalls of the page's thread. `capture:stress` sweeps them.
 *
 * And M153's: the hold on a moving screen of nothing grows with each such read in a row, and a black
 * frame is not read, lets the hold go and has the frame after it read at once (`legacyHold` turns
 * both off, for comparison).
 *
 * The caller supplies the two costly parts — a shot's signature and reading a shot — so this file
 * stays free of pixels and engines and its rules can be tested with fakes.
 */
import {
  admit,
  emptyBacklog,
  readStarted,
  shouldQueue,
  motionSince,
  popupPart,
  push,
  take,
  type Backlog,
} from '../../src/app/capture/backlog.ts';
import { changed, isBlack } from '../../src/app/capture/change.ts';
import {
  decide,
  fastTicks,
  finished,
  FRAME_RATE,
  INITIAL_LOOP,
  outcomeOf,
  queuedPopup,
  tickDelay,
  type LoopState,
  type ReadMode,
} from '../../src/app/capture/loop.ts';
import {
  followFrames,
  initialPace,
  leanReads,
  paceDrop,
  paceLateness,
  paceRead,
  isLoadSample,
  paceTick,
  refreshFor,
  type IntervalRange,
  type LoadLevel,
  type PaceState,
} from '../../src/app/capture/pace.ts';
import { INITIAL_TRACKER, trackFrame, type CaptureEvent, type Frame } from '../../src/app/capture/tracker.ts';

/** A shot on screen from `start` (inclusive) to `end` (exclusive), in ms. */
export interface Span {
  shot: number;
  start: number;
  end: number;
}

/**
 * When each shot was on screen. `times` are when the shots were taken (ms, ascending). With a fixed
 * `dwellMs` every shot stays that long, back to back; otherwise a shot lasts until the next one was
 * taken, at most `maxDwellMs` — screenshots are minutes apart across a battle, and the screen in
 * between is not one of them. The last shot gets the cap (or the dwell).
 */
export function timelineOf(times: readonly number[], opts: { dwellMs?: number; maxDwellMs: number }): Span[] {
  const spans: Span[] = [];
  let at = 0;
  times.forEach((time, shot) => {
    const gap = shot + 1 < times.length ? times[shot + 1]! - time : Infinity;
    const length = opts.dwellMs ?? Math.min(Math.max(gap, 1), opts.maxDwellMs);
    spans.push({ shot, start: at, end: at + length });
    at += length;
  });
  return spans;
}

/** What reading one shot gave, and what it cost. */
export interface ShotRead {
  frame: Frame;
  /** OCR (and icon) time the read took — how long the loop stays busy. */
  ms: number;
  ocrCalls: number;
}

/**
 * What can go wrong with the environment (M142, `capture:stress`). Each knob is deterministic — the
 * random ones draw from `seed` — so a run is the same every time. The frames and the timers draw from
 * streams of their own (M153), so two loops that tick differently still see the same frames dropped.
 */
export interface StressKnobs {
  /**
   * The share's frames: the session asks `FRAME_RATE.idle` and, while ticks are fast,
   * `FRAME_RATE.burst` (override with `idleFps`/`burstFps`). `drop` of them never arrive (0..1),
   * and each arrives up to `jitterMs` early or late. A tick sees the newest frame that arrived;
   * fast ticks come on each arriving frame. Omitted = every moment of the timeline is seen, as
   * before M142.
   */
  frames?: { idleFps?: number; burstFps?: number; drop?: number; jitterMs?: number };
  /** Every read takes this many times as long (a slower machine). Default 1. */
  readCost?: number;
  /** Every timer tick fires up to this much late (uniform). Default 0. */
  lateMs?: number;
  /**
   * The page's thread is stuck in these spans: no tick, frame callback or landing read runs inside
   * one; what was due runs when it ends, and sees the newest frame then.
   */
  stalls?: readonly { start: number; end: number }[];
  seed?: number;
}

export interface SimulateInput {
  /** A fixed interval: the range `{ min: intervalMs, max: intervalMs }`. Ignored with `range`. */
  intervalMs?: number;
  /** The preset's range (M142): the tick interval floats in it (`pace.ts`). */
  range?: IntervalRange;
  /**
   * M142's rules: the load ladder, the hold on a moving screen of nothing, the animation guard and
   * fast ticks after a queued popup. False = the loop of M141 (give it a fixed range), for
   * comparison. Default: on with `range`, off with a fixed `intervalMs` (the tests of M108–M141).
   */
  adaptive?: boolean;
  /**
   * M142's hold only: the range's `max` after every read of nothing on a moving screen, black frames
   * read like any other — the loop before M153, for comparison. Default false (with `adaptive`).
   */
  legacyHold?: boolean;
  /**
   * When the first tick fires (default: one interval in, as setInterval does). The timer's phase
   * against the screens is arbitrary in the browser; the bench averages a few.
   */
  firstTickMs?: number;
  timeline: readonly Span[];
  /** The change-detection signature of a shot as seen at time `t` (an animated screen differs per tick). */
  signature: (shot: number, t: number) => Uint8Array;
  /**
   * Read a shot; `held` is what the run holds now (for the fusion confirm), `mode` whether the loop
   * asked for a full read or a popup read of the popup burst (M136), `lean` whether the load ladder
   * cuts the optional raw pass (M142).
   */
  read: (shot: number, held: ReadonlySet<number>, mode: ReadMode, lean: boolean) => Promise<ShotRead>;
  /**
   * Where the popup's regions sit in a signature (`popupRegionIndices`, M141): the backlog compares
   * only those. Omitted = the whole signature.
   */
  popupRegions?: readonly number[];
  stress?: StressKnobs;
  /** Told each step as it happens — for debugging a run, never for its results. */
  log?: (line: string) => void;
}

export interface TimedEvent {
  event: CaptureEvent;
  /** When the read that produced it ended. */
  at: number;
  /** The shot that read was taken of. */
  shot: number;
}

export interface SimulateResult {
  ticks: number;
  reads: number;
  ocrCalls: number;
  ocrMs: number;
  events: TimedEvent[];
  /** Length of the timeline. */
  durationMs: number;
  /** Reads of shots queued under a busy read (M141), and queued shots pushed out unread. */
  queued: number;
  queueDropped: number;
  /**
   * The shots the page could have seen (M142): on a frame that arrived, while that frame was the
   * newest outside a stall. A shot that never was is no miss.
   */
  observable: Set<number>;
  /** The highest load level reached, and the share of the time spent at each (M142). */
  maxLevel: LoadLevel;
  levelMs: [number, number, number];
}

/** When the next shot comes on screen after `t` — the share's next frame — or Infinity. */
function nextBoundary(timeline: readonly Span[], t: number): number {
  for (const span of timeline) if (span.start > t) return span.start;
  return Infinity;
}

/** Which span is on screen at `t`, or null past the end. */
function shotAt(timeline: readonly Span[], t: number): number | null {
  // Spans are contiguous and few (under a few hundred); a scan is fine.
  for (const span of timeline) if (t >= span.start && t < span.end) return span.shot;
  return null;
}

/** Keep the held set as the app would: got adds, sold and fused take away. */
export function foldHeld(held: Set<number>, event: CaptureEvent): void {
  if (event.kind === 'got') held.add(event.giftId);
  else if (event.kind === 'sold') held.delete(event.giftId);
  else if (event.kind === 'fused') for (const id of event.consumed) held.delete(id);
}

/** A small deterministic generator (mulberry32): the stress knobs' only source of chance. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** When something due at `t` runs: at once, or when the stall it falls in ends. */
function afterStalls(stalls: readonly { start: number; end: number }[], t: number): number {
  let at = t;
  for (const s of stalls) if (at >= s.start && at < s.end) at = s.end;
  return at;
}

/**
 * The share's frames as they arrive (M142): one every 1000/fps ms at the rate asked at that time,
 * some never arriving, each a little early or late. Generated lazily, in order, as the clock asks.
 */
class FrameStream {
  /** Frames that arrived: when, and the shot they show. Ascending. */
  readonly arrived: { t: number; shot: number }[] = [];
  private base = 0;
  private last = -Infinity;
  constructor(
    private readonly timeline: readonly Span[],
    private readonly fpsAt: (t: number) => number,
    private readonly drop: number,
    private readonly jitterMs: number,
    private readonly random: () => number,
  ) {}

  /** Make frames until one has arrived after `t` (or the timeline ends). */
  private fill(t: number): void {
    const end = this.timeline.length > 0 ? this.timeline[this.timeline.length - 1]!.end : 0;
    while ((this.arrived.at(-1)?.t ?? -Infinity) <= t && this.base < end) {
      const period = 1000 / this.fpsAt(this.base);
      this.base += period;
      const jitter = (this.random() * 2 - 1) * this.jitterMs;
      // Early or late, but never on the heels of the frame before: half a period at least.
      const at = Math.max(this.last + period / 2, this.base + jitter);
      const dropped = this.random() < this.drop;
      if (dropped || at >= end) continue;
      this.last = at;
      const shot = shotAt(this.timeline, at);
      if (shot !== null) this.arrived.push({ t: at, shot });
    }
  }

  /** Which frame (its index in `arrived`) is the newest to have arrived by `t`, or -1 before the first. */
  frameAt(t: number): number {
    this.fill(t);
    for (let i = this.arrived.length - 1; i >= 0; i--) if (this.arrived[i]!.t <= t) return i;
    return -1;
  }

  /** The shot on the newest frame that arrived by `t`, or null before the first. */
  shotAt(t: number): number | null {
    const i = this.frameAt(t);
    return i < 0 ? null : this.arrived[i]!.shot;
  }

  /** When the next frame arrives after `t`, or Infinity. */
  nextAfter(t: number): number {
    this.fill(t);
    for (const f of this.arrived) if (f.t > t) return f.t;
    return Infinity;
  }
}

/** Whether `[from, to)` has a moment outside every stall. */
function outsideStalls(stalls: readonly { start: number; end: number }[], from: number, to: number): boolean {
  let at = from;
  for (const s of [...stalls].sort((a, b) => a.start - b.start)) {
    if (s.end <= at) continue;
    if (s.start > at) return at < to;
    at = Math.max(at, s.end);
    if (at >= to) return false;
  }
  return at < to;
}

export async function simulate(input: SimulateInput): Promise<SimulateResult> {
  const { timeline, signature, read } = input;
  const stress = input.stress ?? {};
  const stalls = stress.stalls ?? [];
  const random = seeded(stress.seed ?? 1);
  const lateRandom = seeded(((stress.seed ?? 1) ^ 0x5bd1e995) >>> 0);
  const readCost = stress.readCost ?? 1;
  const lateMs = stress.lateMs ?? 0;
  const range: IntervalRange = input.range ?? { min: input.intervalMs ?? 250, max: input.intervalMs ?? 250 };
  const adaptive = input.adaptive ?? input.range !== undefined;
  /** M153's growing hold and black frames: with M142's rules, unless asked for the loop before. */
  const darkRules = adaptive && input.legacyHold !== true;
  const part = (sig: Uint8Array) => (input.popupRegions ? popupPart(sig, input.popupRegions) : sig);
  const durationMs = timeline.length > 0 ? timeline[timeline.length - 1]!.end : 0;
  let loop: LoopState = INITIAL_LOOP;
  let pace: PaceState = initialPace(range, 0);
  let tracker = INITIAL_TRACKER;
  let backlog: Backlog<number> = emptyBacklog();
  let lastScreen: Frame['screen'] = null;
  let tickedBefore: Uint8Array | null = null;
  /** When the signature last moved from one tick to the next (M153). */
  let movedAt = 0;
  let popupTicks: [Uint8Array | null, Uint8Array | null] = [null, null];
  let movingSince: number | null = null;
  let tickedFrame = -1;
  /** The read in flight is of a change or a queued popup, not a re-read (M142). */
  let readingChange = false;
  const held = new Set<number>();
  const level = (): LoadLevel => (adaptive ? pace.level : 0);
  const frames = stress.frames
    ? new FrameStream(
        timeline,
        (t) =>
          fastTicks(loop, t)
            ? (stress.frames!.burstFps ?? FRAME_RATE.burst)
            : (stress.frames!.idleFps ?? FRAME_RATE.idle),
        stress.frames.drop ?? 0,
        stress.frames.jitterMs ?? 0,
        random,
      )
    : null;
  const out: SimulateResult = {
    ticks: 0,
    reads: 0,
    ocrCalls: 0,
    ocrMs: 0,
    events: [],
    durationMs,
    queued: 0,
    queueDropped: 0,
    observable: new Set(),
    maxLevel: 0,
    levelMs: [0, 0, 0],
  };
  /** The read in flight: its OCR ends at `until`, and it lands (on the page's thread) at `lands`. */
  // Set in the helpers below: cast, so the loop does not read it as always null.
  let pending = null as {
    at: number;
    until: number;
    lands: number;
    shot: number;
    mode: ReadMode;
    result: ShotRead;
  } | null;
  /** The next tick booked: when it is due, when it runs, and whether a timer brings it (lateness). */
  type Booked = { due: number; at: number; timer: boolean };
  const timerAt = (due: number): Booked => ({
    due,
    at: afterStalls(stalls, due + (lateMs > 0 ? lateRandom() * lateMs : 0)),
    timer: true,
  });
  /** A fast tick from `from` (M141, M142): the next frame, or the timer as the backstop. */
  const fastTick = (from: number): Booked => {
    const frame = Math.max(from + 1, frames ? frames.nextAfter(from) : nextBoundary(timeline, from));
    const backstop = timerAt(from + tickDelay(loop, from, pace.interval));
    // Both are booked; whichever runs first (a late timer loses to the frame, M141).
    const onFrame = { due: frame, at: afterStalls(stalls, frame), timer: false };
    return onFrame.at <= backstop.at ? onFrame : backstop;
  };
  /**
   * The tick after `from`: the floating interval — on the next frame too while it sits at the
   * range's `min` (`followFrames`, M142) — or fast ticks (M139, M141).
   */
  const book = (from: number): Booked =>
    fastTicks(loop, from) || (adaptive && followFrames(pace))
      ? fastTick(from)
      : timerAt(from + pace.interval);
  let next: Booked = timerAt(input.firstTickMs ?? range.min);
  let levelAt = 0;
  const noteLevel = (now: number): void => {
    out.levelMs[level()] += Math.max(0, now - levelAt);
    levelAt = now;
    out.maxLevel = Math.max(out.maxLevel, level()) as LoadLevel;
  };

  const startRead = async (shot: number, at: number, mode: ReadMode): Promise<void> => {
    const result = await read(shot, held, mode, leanReads(level()));
    const ms = result.ms * readCost;
    out.reads += 1;
    out.ocrCalls += result.ocrCalls;
    out.ocrMs += ms;
    pending = {
      at,
      until: at + ms,
      lands: afterStalls(stalls, at + ms),
      shot,
      mode,
      result: { ...result, ms },
    };
  };

  /**
   * The read in flight is done: its events land, the loop folds what it found — a burst begun
   * brings the booked tick in, as the session's `followBurst` does — and the next queued shot is
   * read at once, the loop busy all the while (M141).
   */
  const land = async (): Promise<void> => {
    if (!pending) return;
    const { at, lands, shot, mode, result } = pending;
    input.log?.(
      `${Math.round(lands)} land ${mode} shot ${shot} → ${result.frame.screen ?? '-'}${result.frame.partial ? ' (partial)' : ''}`,
    );
    pending = null;
    noteLevel(lands);
    // The page measures a read from its start to when it lands — a stall in between counts.
    if (isLoadSample(mode, result.frame.partial === true)) pace = paceRead(pace, lands, mode, lands - at);
    if (!result.frame.partial) lastScreen = result.frame.screen;
    const folded = trackFrame(tracker, result.frame);
    tracker = folded.state;
    for (const event of folded.events) {
      foldHeld(held, event);
      out.events.push({ event, at: lands, shot });
    }
    // A moving screen of nothing holds the next change read back (M142).
    loop = finished(
      loop,
      outcomeOf(result.frame, lands, adaptive ? range.max : 0, darkRules ? undefined : range.max),
    );
    if (fastTicks(loop, lands)) {
      const sooner = fastTick(lands);
      if (sooner.at < next.at) next = sooner;
    }
    const taken = take(backlog);
    if (!taken.entry) return;
    backlog = taken.backlog;
    loop = { ...loop, busy: true };
    readingChange = true;
    out.queued += 1;
    await startRead(taken.entry.payload, lands, 'popup');
  };

  for (;;) {
    if (pending && pending.lands <= next.at) {
      await land();
      continue;
    }
    const t = next.at;
    if (t >= durationMs) break;
    const shot = frames ? frames.shotAt(t) : shotAt(timeline, t);
    if (shot === null) {
      next = book(t);
      if (shotAt(timeline, t) === null) break;
      continue;
    }
    noteLevel(t);
    if (next.timer) pace = paceLateness(pace, t, t - next.due);
    out.ticks += 1;
    input.log?.(
      `${Math.round(t)} tick shot ${shot}${loop.busy ? ' busy' : ''} level ${level()} interval ${pace.interval}`,
    );
    // A frame shows the screen as it was when the share took it, not when the tick looks.
    const frame = frames ? frames.frameAt(t) : out.ticks;
    const sig = signature(shot, frames ? frames.arrived[frame]!.t : t);
    const moved = changed(tickedBefore, sig);
    if (moved) movedAt = t;
    pace = paceTick(pace, {
      now: t,
      changed: moved,
      burst: fastTicks(loop, t),
      unread:
        changed(loop.lastRead, sig) ||
        (loop.busy && readingChange) ||
        loop.dirty ||
        loop.dark ||
        backlog.entries.length > 0,
      screen: lastScreen,
    });
    tickedBefore = sig;
    const popupNow = part(sig);
    // Motion is told frame to frame, as the session's frame watch does (M142).
    if (frame !== tickedFrame) {
      tickedFrame = frame;
      const [before, previous] = popupTicks;
      popupTicks = [previous, popupNow];
      movingSince = motionSince(movingSince, before, previous, popupNow, t);
    }
    const urgent = movingSince === null && changed(loop.lastRead ? part(loop.lastRead) : null, popupNow);
    const black = darkRules && isBlack(sig);
    const step = decide(loop, sig, changed(loop.lastRead, sig), t, refreshFor(level()), urgent, {
      black,
      stillMs: darkRules ? t - movedAt : 0,
    });
    loop = step.state;
    if (step.decision === 'skip' && black) {
      // A black frame (M153): nothing to read, nothing to queue.
    } else if (step.decision === 'skip') {
      // A busy tick whose popup changed queues its shot (M141); since M142 the ticks go fast
      // after it, and a region in motion queues a frame or two only (`admit`).
      const admitted = adaptive
        ? admit(backlog, loop.busy, popupNow, movingSince === null ? null : t - movingSince)
        : { queue: shouldQueue(backlog, loop.busy, popupNow), moving: false };
      if (admitted.queue) {
        const pushed = push(backlog, popupNow, shot, admitted.moving);
        input.log?.(`${Math.round(t)} queue shot ${shot}${admitted.moving ? ' moving' : ''}`);
        backlog = pushed.backlog;
        if (adaptive) loop = queuedPopup(loop, t);
        if (pushed.evicted !== null) {
          input.log?.(`${Math.round(t)} evict shot ${pushed.evicted}`);
          out.queueDropped += 1;
          pace = paceDrop(pace, t);
        }
      }
    } else {
      input.log?.(`${Math.round(t)} read ${step.mode} shot ${shot}`);
      // The ticks under this read queue what differs from its frame (M147).
      backlog = readStarted(backlog, popupNow);
      // Why it reads is the loop's to say, as in the session (M154).
      readingChange = step.reason !== 'refresh';
      await startRead(shot, t, step.mode);
    }
    next = book(t);
  }
  // What is still in flight or queued is read, as the session would.
  while (pending) await land();
  noteLevel(Math.max(levelAt, durationMs));
  // What the page could have seen: each frame that arrived, while it was the newest, outside a stall.
  if (frames) {
    frames.shotAt(durationMs);
    frames.arrived.forEach((f, i) => {
      const until = frames.arrived[i + 1]?.t ?? durationMs;
      if (outsideStalls(stalls, f.t, until)) out.observable.add(f.shot);
      input.log?.(`${Math.round(f.t)} frame shot ${f.shot}`);
    });
  } else for (const s of timeline) if (outsideStalls(stalls, s.start, s.end)) out.observable.add(s.shot);
  return out;
}

/** An event's identity for comparing runs: kind and the ids it names. */
export function eventKey(event: CaptureEvent): string {
  switch (event.kind) {
    case 'enter':
      return `enter:${event.floor}:${event.packId}`;
    case 'got':
    case 'sold':
      return `${event.kind}:${event.giftId}`;
    case 'fused':
      return `fused:${event.resultId}:${[...event.consumed].sort((a, b) => a - b).join(',')}`;
    case 'unsure':
      return `unsure:${event.about}:${[...event.ids].sort((a, b) => a - b).join(',')}`;
    case 'startDone':
      return 'startDone';
    case 'place':
      return `place:${event.shop ? 'shop' : 'out'}`;
  }
}

export interface Comparison {
  /** In the reference, not in the run. */
  missed: string[];
  /** In the run more often than in the reference. */
  extra: string[];
}

/** Compare a run's events with the reference (every shot read once, in order) as multisets. */
export function compareEvents(reference: readonly CaptureEvent[], run: readonly CaptureEvent[]): Comparison {
  const count = (events: readonly CaptureEvent[]) => {
    const m = new Map<string, number>();
    for (const e of events) m.set(eventKey(e), (m.get(eventKey(e)) ?? 0) + 1);
    return m;
  };
  const want = count(reference);
  const got = count(run);
  const missed: string[] = [];
  const extra: string[] = [];
  for (const [key, n] of want) for (let i = got.get(key) ?? 0; i < n; i++) missed.push(key);
  for (const [key, n] of got) for (let i = want.get(key) ?? 0; i < n; i++) extra.push(key);
  return { missed: missed.sort(), extra: extra.sort() };
}

/**
 * How long after its shot came on screen each event was recorded, in ms. The shot is the one the
 * read was taken of; a later re-read of the same screen counts from that screen's start too.
 */
export function latencies(events: readonly TimedEvent[], timeline: readonly Span[]): number[] {
  const startOf = new Map(timeline.map((s) => [s.shot, s.start]));
  return events.map((e) => e.at - (startOf.get(e.shot) ?? e.at));
}

/**
 * Shrink an RGBA image by area average — the bench's stand-in for the browser drawing the frame
 * onto the small preview canvas the signature is taken on.
 */
export function downscale(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
): { data: Uint8Array; width: number; height: number } {
  const tw = Math.max(1, Math.min(width, targetWidth));
  const th = Math.max(1, Math.round((height * tw) / width));
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / tw));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++)
          for (let c = 0; c < 4; c++) sum[c]! += data[(sy * width + sx) * 4 + c]!;
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c++) out[(y * tw + x) * 4 + c] = Math.round(sum[c]! / n);
    }
  }
  return { data: out, width: tw, height: th };
}

/** When a Steam screenshot was taken, from its name (`20261016103707_1.jpg`), in ms; null if not one. */
export function steamShotTime(file: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(file);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s);
}
