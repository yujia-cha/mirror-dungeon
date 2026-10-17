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
 * The caller supplies the two costly parts — a shot's signature and reading a shot — so this file
 * stays free of pixels and engines and its rules can be tested with fakes.
 */
import {
  emptyBacklog,
  popupPart,
  push,
  shouldQueue,
  take,
  type Backlog,
} from '../../src/app/capture/backlog.ts';
import { changed } from '../../src/app/capture/change.ts';
import {
  decide,
  finished,
  inBurst,
  INITIAL_LOOP,
  tickDelay,
  type LoopState,
  type ReadMode,
} from '../../src/app/capture/loop.ts';
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

export interface SimulateInput {
  intervalMs: number;
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
   * asked for a full read or a popup read of the popup burst (M136).
   */
  read: (shot: number, held: ReadonlySet<number>, mode: ReadMode) => Promise<ShotRead>;
  /**
   * Where the popup's regions sit in a signature (`popupRegionIndices`, M141): the backlog compares
   * only those. Omitted = the whole signature.
   */
  popupRegions?: readonly number[];
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

export async function simulate(input: SimulateInput): Promise<SimulateResult> {
  const { intervalMs, timeline, signature, read } = input;
  const part = (sig: Uint8Array) => (input.popupRegions ? popupPart(sig, input.popupRegions) : sig);
  const durationMs = timeline.length > 0 ? timeline[timeline.length - 1]!.end : 0;
  let loop: LoopState = INITIAL_LOOP;
  let tracker = INITIAL_TRACKER;
  let backlog: Backlog<number> = emptyBacklog();
  const held = new Set<number>();
  const out: SimulateResult = {
    ticks: 0,
    reads: 0,
    ocrCalls: 0,
    ocrMs: 0,
    events: [],
    durationMs,
    queued: 0,
    queueDropped: 0,
  };
  /** The read in flight: it ends at `until` with these results. */
  // Set in the helpers below: cast, so the loop does not read it as always null.
  let pending = null as { until: number; shot: number; result: ShotRead } | null;
  /** The next tick booked. */
  let t = input.firstTickMs ?? intervalMs;

  /**
   * A burst's next tick from `from` (M141): the share's next frame, the timer as the backstop —
   * at least 1 ms on, as a callback comes no sooner than the next turn.
   */
  const burstTick = (from: number): number =>
    Math.max(from + 1, Math.min(from + tickDelay(loop, from, intervalMs), nextBoundary(timeline, from)));
  /** The tick after `from`: the preset's interval, or the burst's (M139, M141). */
  const book = (from: number): number => (inBurst(loop, from) ? burstTick(from) : from + intervalMs);

  const startRead = async (shot: number, at: number, mode: ReadMode): Promise<void> => {
    const result = await read(shot, held, mode);
    out.reads += 1;
    out.ocrCalls += result.ocrCalls;
    out.ocrMs += result.ms;
    pending = { until: at + result.ms, shot, result };
  };

  /**
   * The read in flight is done: its events land, the loop folds what it found — a burst begun
   * brings the booked tick in, as the session's `followBurst` does — and the next queued shot is
   * read at once, the loop busy all the while (M141).
   */
  const land = async (): Promise<void> => {
    if (!pending) return;
    const { until, shot, result } = pending;
    pending = null;
    const folded = trackFrame(tracker, result.frame);
    tracker = folded.state;
    for (const event of folded.events) {
      foldHeld(held, event);
      out.events.push({ event, at: until, shot });
    }
    loop = finished(loop, {
      at: until,
      popup: result.frame.screen === 'acquired',
      partial: result.frame.partial === true,
    });
    if (inBurst(loop, until)) t = Math.min(t, burstTick(until));
    const next = take(backlog);
    if (!next.entry) return;
    backlog = next.backlog;
    loop = { ...loop, busy: true };
    out.queued += 1;
    await startRead(next.entry.payload, until, 'popup');
  };

  for (;;) {
    if (pending && pending.until <= t) {
      await land();
      continue;
    }
    if (t >= durationMs) break;
    const shot = shotAt(timeline, t);
    if (shot === null) break;
    out.ticks += 1;
    const sig = signature(shot, t);
    const step = decide(loop, sig, changed(loop.lastRead, sig), t);
    loop = step.state;
    if (step.decision === 'skip') {
      // A busy tick whose popup changed queues its shot (M141).
      const reading = loop.lastRead ? part(loop.lastRead) : null;
      if (shouldQueue(backlog, loop.busy, reading, part(sig))) {
        const pushed = push(backlog, part(sig), shot);
        backlog = pushed.backlog;
        if (pushed.evicted !== null) out.queueDropped += 1;
      }
    } else await startRead(shot, t, step.mode);
    t = book(t);
  }
  // What is still in flight or queued is read, as the session would.
  while (pending) await land();
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
