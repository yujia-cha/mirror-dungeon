/**
 * The owner's diagnostics recorder (M112): what the screen reader read, what the player corrected,
 * and how the route compared with the run, kept on this device until exported.
 *
 * What it keeps:
 * - every read (its trace of OCR passes, what it matched, the events it made, and how many ticks
 *   it kept waiting — M134; a popup queued under a busy read is a read of its own, `queued` with its
 *   lag, and keeps no frame — it is a crop — M141) — except two kinds, summed instead (M153,
 *   `readSummary` records): popup reads that found no popup (`scan` — the title alone; the owner's
 *   hour made 11 700 of them, 60% of the records, and the cap of 20 000 then stopped everything,
 *   events too, an hour and a half before the run ended), and reads that made no event and kept no
 *   frame once `MAX_READ_RECORDS` of them are kept (`capped`);
 * - what the reader applied, what the player undid or answered, and run changes made by hand —
 *   while the reader runs, a hand-made change is most likely something it missed;
 * - one record per floor left (what the route offered, what was entered, how the gifts went) and
 *   one per run that ended;
 * - frames, only when asked and only where they say something: a read that made an event, the
 *   last few reads before a hand-made change while reading, and at most one a minute of a screen
 *   that showed text but no screen it knows (a screen it may be missing);
 * - a filmstrip around each event and each hand-made change while reading (M134): the session's
 *   small preview of every tick from `STRIP_BEFORE_MS` before to `STRIP_AFTER_MS` after, so a
 *   popup that came and went while a slow read was busy is still on record — a read only ever
 *   sees its own snapshot.
 *
 * Records have two caps (M153). Routine reads — no event, no frame — stop at `MAX_READ_RECORDS`
 * and are summed from there on (`full` says so). Everything else — reads with events or frames,
 * what was applied, undone or answered, hand-made changes, floors, runs, run marks, sessions,
 * environments, filmstrips, the summaries — is kept up to `MAX_RECORDS`, a backstop against a
 * runaway writer far above what a run makes (the owner's hour: about 1100 such records, and some
 * 360 summaries an hour at most), at which recording stops (`stopped`).
 *
 * Past the caps a frame goes by its class (M134, `DiagFrameClass`), not by age alone: the oldest
 * `routine` frame first (an event the player let stand — the trace already says the read was
 * right), then `sample` (the first `SAMPLES_PER_SCREEN` events of each screen kind, kept as
 * regression fixtures), then `unknown`, then `evidence` (the ring of a hand-made change, an event
 * later undone, a read that asked). So an hour's run keeps its first floors' misses. Previews are
 * a pool of their own with their own caps, oldest first.
 *
 * Lifecycle: everything stored goes into the next export — one zip, or several of at most 25 MB
 * each when it is bigger (M146, `export-parts.ts`). After exporting, the player clears what it holds (the browser cannot say whether the file was saved, so it is never
 * cleared on its own); until then the stats say how much exported data is still on the device.
 * The export is marked only once the zip was handed to the browser (`markExported`, M116) — a
 * failed zip leaves nothing to clear.
 *
 * Every write, read-back and clear runs in one queue (M116), so a clear never races a write and the
 * counts always match what is on the device. Frames are encoded only when kept, inside that queue.
 *
 * React-free: the provider feeds it, the popover reads `stats()`, tests drive it with
 * `memoryStore()`.
 */
import {
  DIAG_FORMAT,
  type DiagFrameClass,
  type DiagRecord,
  type DiagnosticsBundle,
} from '../../../core/schema.ts';
import type { EnvReport, FrameSource, ReadReport, TickReport } from '../session.ts';
import { planParts } from './export-parts.ts';
import { memoryStore, type DiagStore, type StoredFrame } from './store.ts';

/** Reads kept in memory for a hand-made change to look back on. */
export const RING_SIZE = 8;
/**
 * Caps: routine reads (no event, no frame) are records up to `MAX_READ_RECORDS`, summed past it
 * (M153); recording stops at `MAX_RECORDS`; past the frame caps frames go by class.
 */
export const MAX_READ_RECORDS = 20_000;
export const MAX_RECORDS = 100_000;
/** A summary of reads not kept one by one is written at most this often (M153). */
export const SUMMARY_PERIOD_MS = 10_000;
export const MAX_FRAMES = 300;
export const MAX_FRAME_BYTES = 150 * 1024 * 1024;
/** The filmstrip's own caps (a preview is ~15–30 KB): past them the oldest previews go. */
export const MAX_PREVIEWS = 600;
export const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
/** At most one frame a minute of a screen with text the reader did not recognise. */
export const UNKNOWN_FRAME_GAP_MS = 60_000;
/** Event frames of each screen kind kept as `sample` rather than `routine`. */
export const SAMPLES_PER_SCREEN = 3;
/** A filmstrip holds the ticks this long before its event and this long after. */
export const STRIP_BEFORE_MS = 3000;
export const STRIP_AFTER_MS = 4000;

/** Which class goes first past the caps: lower first. Previews are a pool apart. */
const EVICT_RANK: Record<DiagFrameClass, number> = {
  routine: 0,
  sample: 1,
  unknown: 2,
  evidence: 3,
  preview: 0,
};

interface KeptFrame {
  id: string;
  t: number;
  bytes: number;
  class: DiagFrameClass;
}

/** A picture in memory, not encoded unless something keeps it; `id` once it is. */
interface Pending {
  t: number;
  frame: FrameSource;
  id: string | null;
}

export interface DiagStats {
  records: number;
  frames: number;
  bytes: number;
  /** Records (and their frames) already in an export, still on the device. */
  exportedRecords: number;
  lastExportAt: number | null;
  /** Full frames dropped to stay under the caps (previews are a moving window and not counted). */
  trimmedFrames: number;
  /**
   * Routine reads reached their cap (`MAX_READ_RECORDS`, M153): reads with nothing in them are
   * counted from here on, not kept one by one; events and everything else are still recorded.
   */
  full: boolean;
  /** The record cap was reached (`MAX_RECORDS`): nothing more is recorded until the device is cleared. */
  stopped: boolean;
  /**
   * How many files the export would take by the frames alone (M146, `planParts`); the records
   * may add one. More than one says the export comes in parts.
   */
  parts: number;
}

export interface ExportMark {
  seq: number;
  frameIds: string[];
  at: number;
}

type Without<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type RecordInput = Without<DiagRecord, 't'>;
type ReadSummary = Extract<DiagRecord, { kind: 'readSummary' }>;

/** A read kept as a record of its own that says nothing: no event, no frame (M153). */
function isRoutineRead(rec: DiagRecord): boolean {
  return rec.kind === 'read' && rec.events.length === 0 && rec.frameId === null;
}

export class DiagRecorder {
  private seq = 0;
  private records = 0;
  /** Routine reads kept as records (`isRoutineRead`), against `MAX_READ_RECORDS` (M153). */
  private readRecords = 0;
  /** Reads summed, not yet written, by cause and mode (M153). */
  private summaries = new Map<string, ReadSummary>();
  private frameList: KeptFrame[] = [];
  private exported: ExportMark | null = null;
  private exportedRecords = 0;
  private trimmed = 0;
  private startedAt: number | null = null;
  /** The last reads' pictures, not encoded unless a hand-made change keeps them. */
  private ring: Pending[] = [];
  /** The last `STRIP_BEFORE_MS` of tick previews, for a filmstrip to start from. */
  private ticks: Pending[] = [];
  /** The filmstrip being kept: until when, around what, and its previews so far. */
  private strip: { until: number; reads: number[]; manual: number[]; frameIds: string[] } | null = null;
  private previewSeq = 0;
  /** Ticks skipped while the read in flight was busy, and those that saw the screen change. */
  private busyTicks = 0;
  private busyChanges = 0;
  /** Event frames kept as `sample` so far, by screen kind (this recorder's lifetime). */
  private samples = new Map<string, number>();
  /** The latest read's kept frame, and the frame of each applied entry's read — for undo and ask. */
  private lastReadFrameId: string | null = null;
  private frameOfLog = new Map<number, string>();
  private lastUnknownFrameAt = -Infinity;
  private lastReadT: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  recording = false;
  images = false;

  private constructor(
    private readonly store: DiagStore,
    private readonly now: () => number,
  ) {}

  static async open(store?: DiagStore, now: () => number = Date.now): Promise<DiagRecorder> {
    const recorder = new DiagRecorder(store ?? memoryStore(), now);
    await recorder.load();
    return recorder;
  }

  private async load(): Promise<void> {
    const [records, frames, mark, trimmed] = await Promise.all([
      this.store.records(),
      this.store.frames(),
      this.store.getMeta<ExportMark>('exported'),
      this.store.getMeta<number>('trimmed'),
    ]);
    this.records = records.length;
    this.readRecords = records.filter((r) => isRoutineRead(r.rec)).length;
    this.seq = records.reduce((max, r) => Math.max(max, r.seq), 0);
    this.startedAt = records[0]?.rec.t ?? null;
    // Frames stored before M134 have no class: an event the player let stand, as far as we know.
    this.frameList = frames.map(({ id, t, bytes, class: cls }) => ({
      id,
      t,
      bytes,
      class: cls ?? 'routine',
    }));
    this.exported = mark ?? null;
    this.exportedRecords = mark ? records.filter((r) => r.seq <= mark.seq).length : 0;
    this.trimmed = trimmed ?? 0;
  }

  /** Turn recording and frames on or off (frames only ever with recording). */
  setFlags(recording: boolean, images: boolean): void {
    if (!(recording && images)) this.dropTicks();
    // What was summed so far is written while recording is still on.
    if (!recording) this.writeSummaries();
    this.recording = recording;
    this.images = recording && images;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  /** The same object until something changes — React's external-store contract. */
  private snapshot: DiagStats | null = null;

  stats(): DiagStats {
    this.snapshot ??= this.computeStats();
    return this.snapshot;
  }

  private computeStats(): DiagStats {
    return {
      records: this.records,
      frames: this.frameList.length,
      bytes: this.frameList.reduce((sum, f) => sum + f.bytes, 0),
      exportedRecords: this.exportedRecords,
      lastExportAt: this.exported?.at ?? null,
      trimmedFrames: this.trimmed,
      full: this.readRecords >= MAX_READ_RECORDS,
      stopped: this.records >= MAX_RECORDS,
      parts: planParts(0, this.frameList).parts.length,
    };
  }

  /** Writes run one after another, so the seq order on disk is the order things happened. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work).catch(() => undefined);
    return this.queue;
  }

  /** `work` in its turn in the queue, with its result — or its error, which the queue survives. */
  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      void this.enqueue(async () => {
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /** Wait for every write so far (tests, and export). */
  flush(): Promise<void> {
    return this.queue;
  }

  private add(input: RecordInput, t = this.now()): void {
    if (!this.recording || this.records >= MAX_RECORDS) return;
    const rec = { ...input, t } as DiagRecord;
    const seq = ++this.seq;
    this.records += 1;
    this.startedAt ??= t;
    void this.enqueue(() => this.store.addRecord(seq, rec));
    this.changed();
  }

  /**
   * Keep a picture. The id is the record's to name now; the encode and the write run in the queue,
   * and only then does the frame count — past a cap, frames go by class (`evict`) and the stats
   * say so.
   */
  private keepFrame(t: number, frame: FrameSource, cls: DiagFrameClass): string {
    const id = cls === 'preview' ? `p${t}-${++this.previewSeq}` : `${t}-${this.seq + 1}`;
    // Asked for right after this read's events are handed on (a microtask: the session hands
    // them on in the same task), and before any later read can push the picture out of the ring
    // and free it — so it is encoded even if the queue is still busy with earlier writes.
    const jpeg = Promise.resolve().then(() => frame.encode());
    void this.enqueue(async () => {
      const blob = await jpeg;
      if (!blob) return;
      this.frameList.push({ id, t, bytes: blob.size, class: cls });
      await this.store.addFrame({ id, t, bytes: blob.size, blob, class: cls });
      await this.evict(cls === 'preview');
      this.changed();
    });
    return id;
  }

  /**
   * Bring one pool under its caps: previews oldest first; full frames the oldest of the lowest
   * class first (`EVICT_RANK`). Only full frames count as trimmed.
   */
  private async evict(previews: boolean): Promise<void> {
    const [maxCount, maxBytes] = previews ? [MAX_PREVIEWS, MAX_PREVIEW_BYTES] : [MAX_FRAMES, MAX_FRAME_BYTES];
    // In the order kept, so the first of a class is its oldest.
    let pool = this.frameList.filter((f) => (f.class === 'preview') === previews);
    let bytes = pool.reduce((sum, f) => sum + f.bytes, 0);
    const drop = new Set<string>();
    while (pool.length > maxCount || bytes > maxBytes) {
      const lowest = Math.min(...pool.map((f) => EVICT_RANK[f.class]));
      const victim = pool.find((f) => EVICT_RANK[f.class] === lowest)!;
      pool = pool.filter((f) => f !== victim);
      bytes -= victim.bytes;
      drop.add(victim.id);
    }
    if (drop.size === 0) return;
    this.frameList = this.frameList.filter((f) => !drop.has(f.id));
    // A pending picture must not go on naming a frame that is gone: it is kept anew if needed.
    for (const entry of [...this.ring, ...this.ticks]) if (entry.id && drop.has(entry.id)) entry.id = null;
    await this.store.deleteFrames([...drop]);
    if (previews) return;
    this.trimmed += drop.size;
    await this.store.setMeta('trimmed', this.trimmed);
  }

  /** A kept frame matters more than it was kept for: raise its class (never lower it). */
  private raise(id: string, cls: DiagFrameClass): void {
    void this.enqueue(async () => {
      const frame = this.frameList.find((f) => f.id === id);
      if (!frame || EVICT_RANK[frame.class] >= EVICT_RANK[cls]) return;
      frame.class = cls;
      await this.store.setFrameClass(id, cls);
    });
  }

  /** Keep a pending picture as `cls`, or raise the frame it was already kept as. */
  private keepPending(entry: Pending, cls: DiagFrameClass): string {
    if (entry.id) this.raise(entry.id, cls);
    else entry.id = this.keepFrame(entry.t, entry.frame, cls);
    return entry.id;
  }

  /**
   * Every tick of the session (M134). Counts the ticks a busy read made wait; holds the last few
   * seconds of previews, and while a filmstrip is open keeps each one.
   */
  onTick(tick: TickReport, preview: FrameSource | null): void {
    if (!this.recording) {
      preview?.close();
      return;
    }
    if (tick.busy) {
      this.busyTicks += 1;
      if (tick.changed) this.busyChanges += 1;
    }
    if (this.strip && tick.t > this.strip.until) this.closeStrip();
    if (!preview || !this.images) {
      preview?.close();
      return;
    }
    const entry: Pending = { t: tick.t, frame: preview, id: null };
    if (this.strip) this.strip.frameIds.push(this.keepPending(entry, 'preview'));
    this.ticks.push(entry);
    while (this.ticks.length > 0 && this.ticks[0]!.t < tick.t - STRIP_BEFORE_MS)
      this.ticks.shift()!.frame.close();
  }

  /**
   * Keep the previews around something that happens now: the ones held from before, and every
   * tick's until `STRIP_AFTER_MS` from now. An open strip is stretched instead — popups clicked
   * through one after another make one strip.
   */
  private openStrip(around: { read?: number; manual?: number }): void {
    if (!this.images) return;
    const until = this.now() + STRIP_AFTER_MS;
    if (this.strip) this.strip.until = Math.max(this.strip.until, until);
    else
      this.strip = {
        until,
        reads: [],
        manual: [],
        frameIds: this.ticks.map((entry) => this.keepPending(entry, 'preview')),
      };
    if (around.read !== undefined) this.strip.reads.push(around.read);
    if (around.manual !== undefined) this.strip.manual.push(around.manual);
  }

  /** The open filmstrip, as a record naming its previews — none when no tick came with one. */
  private closeStrip(): void {
    const strip = this.strip;
    this.strip = null;
    if (!strip || strip.frameIds.length === 0) return;
    this.add({ kind: 'strip', reads: strip.reads, manual: strip.manual, frameIds: strip.frameIds });
  }

  /** End the filmstrip being kept (with what it has) and free the previews held for the next. */
  private dropTicks(): void {
    this.closeStrip();
    for (const entry of this.ticks) entry.frame.close();
    this.ticks = [];
  }

  onRead(report: ReadReport, frame: FrameSource | null): void {
    if (!this.recording) {
      frame?.close();
      return;
    }
    this.writeSummaries(report.t);
    let frameId: string | null = null;
    if (frame && this.images) {
      const sawText = report.trace.some((s) => s.lines.some((line) => line.trim() !== ''));
      // A popup read of nothing (M136) looked at one title only: it says no screen is unknown.
      const unknown = report.frame.screen === null && !report.frame.partial && sawText;
      if (report.events.length > 0) frameId = this.keepFrame(report.t, frame, this.eventClass(report));
      else if (unknown && report.t - this.lastUnknownFrameAt >= UNKNOWN_FRAME_GAP_MS) {
        frameId = this.keepFrame(report.t, frame, 'unknown');
        this.lastUnknownFrameAt = report.t;
      }
      this.ring.push({ t: report.t, frame, id: frameId });
      if (this.ring.length > RING_SIZE) this.ring.shift()!.frame.close();
    } else frame?.close();
    const waited = { busyTicks: this.busyTicks, busyChanges: this.busyChanges };
    this.busyTicks = 0;
    this.busyChanges = 0;
    // A popup read of nothing, or past the cap a read of nothing kept (M153): summed, not a record.
    const routine = report.events.length === 0 && frameId === null;
    const scan = routine && report.mode === 'popup' && report.frame.partial === true;
    if (scan || (routine && this.readRecords >= MAX_READ_RECORDS)) {
      this.sum(scan ? 'scan' : 'capped', report, waited);
      return;
    }
    if (routine) this.readRecords += 1;
    this.lastReadT = report.t;
    this.lastReadFrameId = frameId;
    if (report.events.length > 0) this.openStrip({ read: report.t });
    this.add(
      {
        kind: 'read',
        reason: report.reason,
        ...(report.mode === 'popup' ? { mode: 'popup' as const } : {}),
        ...(report.queued ? { queued: true as const, lagMs: Math.round(report.queued.lagMs) } : {}),
        ...(report.queueDropped ? { queueDropped: report.queueDropped } : {}),
        ms: Math.round(report.ms),
        ocrCalls: report.ocrCalls,
        screen: report.frame.screen,
        floor: report.frame.floor,
        pack: report.frame.pack,
        gift: report.frame.gift,
        ingredients: report.frame.ingredients ?? null,
        trace: report.trace,
        events: report.events,
        frameId,
        ...waited,
      },
      report.t,
    );
  }

  /**
   * Add a read to its summary (M153): the record it would have been, in sums — the counts
   * `capture:feedback` reports come out the same.
   */
  private sum(
    cause: ReadSummary['cause'],
    report: ReadReport,
    waited: { busyTicks: number; busyChanges: number },
  ): void {
    const key = `${cause}:${report.mode}`;
    const s =
      this.summaries.get(key) ??
      ({
        kind: 'readSummary',
        t: report.t,
        from: report.t,
        cause,
        mode: report.mode,
        reads: 0,
        ms: 0,
        ocrCalls: 0,
        queued: 0,
        lagMs: 0,
        lagMaxMs: 0,
        popups: 0,
        queuedPopups: 0,
        queueDropped: 0,
        busyTicks: 0,
        busyChanges: 0,
        changedUnder: 0,
        screens: {},
      } satisfies ReadSummary);
    const popup = report.frame.screen === 'acquired';
    const lag = report.queued ? Math.round(report.queued.lagMs) : 0;
    const screen = report.frame.screen ?? '(none)';
    this.summaries.set(key, {
      ...s,
      t: Math.max(s.t, report.t),
      from: Math.min(s.from, report.t),
      reads: s.reads + 1,
      ms: s.ms + Math.round(report.ms),
      ocrCalls: s.ocrCalls + report.ocrCalls,
      queued: s.queued + (report.queued ? 1 : 0),
      lagMs: s.lagMs + lag,
      lagMaxMs: Math.max(s.lagMaxMs, lag),
      popups: s.popups + (popup ? 1 : 0),
      queuedPopups: s.queuedPopups + (popup && report.queued ? 1 : 0),
      queueDropped: s.queueDropped + (report.queueDropped ?? 0),
      busyTicks: s.busyTicks + waited.busyTicks,
      busyChanges: s.busyChanges + waited.busyChanges,
      changedUnder: s.changedUnder + (waited.busyChanges > 0 ? 1 : 0),
      screens: { ...s.screens, [screen]: (s.screens[screen] ?? 0) + 1 },
    });
  }

  /**
   * Write the summaries (M153): those begun `SUMMARY_PERIOD_MS` before `now`, or all of them when no
   * time is given — the session's status changed, recording stops, the device exports.
   */
  private writeSummaries(now?: number): void {
    for (const [key, s] of this.summaries) {
      if (now !== undefined && now - s.from < SUMMARY_PERIOD_MS) continue;
      this.summaries.delete(key);
      const { t, ...rest } = s;
      this.add(rest, t);
    }
  }

  /** The first few event frames of a screen kind are samples; the rest are routine. */
  private eventClass(report: ReadReport): DiagFrameClass {
    const screen = report.frame.screen ?? '';
    const kept = this.samples.get(screen) ?? 0;
    if (kept >= SAMPLES_PER_SCREEN) return 'routine';
    this.samples.set(screen, kept + 1);
    return 'sample';
  }

  onSession(input: Without<Extract<DiagRecord, { kind: 'session' }>, 't' | 'kind'>): void {
    // A session that stops ends its filmstrip; the next starts without the old one's ticks.
    if (input.status !== 'running') this.dropTicks();
    this.writeSummaries();
    this.busyTicks = 0;
    this.busyChanges = 0;
    this.add({ kind: 'session', ...input });
  }

  /**
   * The environment the reader runs in (M142): every 10 s and when the load level moves. Text only,
   * so it is kept with or without pictures.
   */
  onEnv(env: EnvReport): void {
    if (!this.recording) return;
    this.writeSummaries(env.t);
    const { stats } = env;
    this.add(
      {
        kind: 'env',
        reason: env.reason,
        fps: env.fps,
        lateness: stats.lateness,
        readFull: stats.fullRead,
        readPopup: stats.popupRead,
        queueDropped: env.queueDropped,
        range: { min: env.range.min, max: env.range.max },
        interval: env.interval,
        level: env.level,
      },
      env.t,
    );
  }

  /** The reader applied `event` as log entry `logId` (`fromRead`: the latest read made it). */
  onApplied(logId: number, event: { kind: string }, actions: unknown[], fromRead: boolean): void {
    const readT = fromRead ? this.lastReadT : null;
    if (fromRead && this.lastReadFrameId) this.frameOfLog.set(logId, this.lastReadFrameId);
    this.add({ kind: 'applied', logId, readT, event, actions });
  }

  /** The player undid an entry: the read that made it was wrong, so its frame is evidence. */
  onUndo(logId: number): void {
    const frameId = this.frameOfLog.get(logId);
    if (frameId && this.recording) this.raise(frameId, 'evidence');
    this.add({ kind: 'undo', logId });
  }

  /** The latest read raised a question: its frame shows what the reader could not settle. */
  onAsk(): void {
    if (this.lastReadFrameId && this.recording) this.raise(this.lastReadFrameId, 'evidence');
  }

  onAnswer(ask: { kind: string }, picked: number[]): void {
    this.add({ kind: 'answer', ask, picked });
  }

  /**
   * A run change made by hand. While reading, it is likely a miss: the last few reads' frames are
   * kept as evidence, and a filmstrip around it.
   */
  onManual(input: Without<Extract<DiagRecord, { kind: 'manual' }>, 't' | 'kind' | 'frameIds'>): void {
    if (!this.recording) return;
    const frameIds: string[] = [];
    if (input.capturing && this.images)
      for (const entry of this.ring) frameIds.push(this.keepPending(entry, 'evidence'));
    const t = this.now();
    this.add({ kind: 'manual', ...input, frameIds }, t);
    if (input.capturing) this.openStrip({ manual: t });
  }

  onFloor(input: Without<Extract<DiagRecord, { kind: 'floor' }>, 't' | 'kind'>): void {
    this.add({ kind: 'floor', ...input });
  }

  onRun(input: Without<Extract<DiagRecord, { kind: 'run' }>, 't' | 'kind'>): void {
    this.add({ kind: 'run', ...input });
  }

  /** The run was started with the reader, new or continued, or rolled back to before it (M143). */
  onRunMark(input: Without<Extract<DiagRecord, { kind: 'runMark' }>, 't' | 'kind'>): void {
    this.add({ kind: 'runMark', ...input });
  }

  /**
   * Everything stored, as one bundle plus its frames, read in the queue's turn. Nothing is marked
   * yet: the caller zips and downloads it and then calls `markExported` with `mark` — a zip that
   * failed must not leave the device thinking it was exported (M116).
   */
  exportBundle(meta: {
    dataVersion: string;
    season: number;
    layoutReference: DiagnosticsBundle['layoutReference'];
  }): Promise<{ bundle: DiagnosticsBundle; frames: StoredFrame[]; name: string; mark: ExportMark }> {
    // A filmstrip still open goes in with what it has; the ticks after it start a new one. So do
    // the reads summed so far (M153).
    this.closeStrip();
    this.writeSummaries();
    return this.inTurn(async () => {
      const [records, frames] = await Promise.all([this.store.records(), this.store.frames()]);
      const at = this.now();
      const startedAt = records[0]?.rec.t ?? at;
      const bundle: DiagnosticsBundle = {
        format: DIAG_FORMAT,
        bundleId: String(startedAt),
        startedAt,
        exportedAt: at,
        ...meta,
        records: records.map((r) => r.rec),
        frames: frames.map(({ id, t, bytes, class: cls }) => ({ id, t, bytes, class: cls ?? 'routine' })),
      };
      const mark: ExportMark = {
        seq: records.reduce((max, r) => Math.max(max, r.seq), 0),
        frameIds: frames.map((f) => f.id),
        at,
      };
      return { bundle, frames, name: `md-diagnostics-${stamp(at)}.zip`, mark };
    });
  }

  /** The zip of `mark` reached the browser: what it holds now counts as exported. */
  markExported(mark: ExportMark): Promise<void> {
    this.exported = mark;
    // Records up to the mark's seq; a clear in between makes the count catch up on reload.
    this.exportedRecords = Math.min(this.records, this.countUpTo(mark.seq));
    this.changed();
    return this.enqueue(() => this.store.setMeta('exported', mark));
  }

  /** Records numbered up to `seq` still held — every one since the last clear. */
  private countUpTo(seq: number): number {
    return Math.max(0, this.records - (this.seq - seq));
  }

  /** Remove what the last export holds; anything recorded since stays. */
  clearExported(): Promise<{ records: number; frames: number }> {
    const mark = this.exported;
    if (!mark) return Promise.resolve({ records: 0, frames: 0 });
    const removed = { records: this.exportedRecords, frames: mark.frameIds.length };
    const gone = new Set(mark.frameIds);
    this.frameList = this.frameList.filter((f) => !gone.has(f.id));
    for (const entry of [...this.ring, ...this.ticks]) if (entry.id && gone.has(entry.id)) entry.id = null;
    if (this.strip) this.strip.frameIds = this.strip.frameIds.filter((id) => !gone.has(id));
    this.records -= this.exportedRecords;
    this.exported = null;
    this.exportedRecords = 0;
    this.startedAt = this.records > 0 ? this.startedAt : null;
    this.changed();
    return this.inTurn(async () => {
      await this.store.clearUpTo(mark.seq, mark.frameIds);
      await this.store.setMeta('exported', null);
      // The routine reads left are those recorded since the export (M153).
      this.readRecords = (await this.store.records()).filter((r) => isRoutineRead(r.rec)).length;
      this.changed();
      return removed;
    });
  }

  /** Remove everything on the device, exported or not — after every write before it. */
  clearAll(): Promise<void> {
    // Records count from the call (a record made after it is kept); frames are counted in the
    // queue's turn, so the frames still being encoded before the clear go with it.
    this.records = 0;
    this.readRecords = 0;
    this.summaries.clear();
    for (const entry of [...this.ring, ...this.ticks]) entry.frame.close();
    this.ring = [];
    this.ticks = [];
    this.strip = null;
    this.samples.clear();
    this.frameOfLog.clear();
    this.lastReadFrameId = null;
    this.exported = null;
    this.exportedRecords = 0;
    this.startedAt = null;
    this.changed();
    return this.inTurn(async () => {
      await this.store.clearAll();
      this.frameList = [];
      this.trimmed = 0;
      this.changed();
    });
  }
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}
