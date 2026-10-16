/**
 * The owner's diagnostics recorder (M112): what the screen reader read, what the player corrected,
 * and how the route compared with the run, kept on this device until exported.
 *
 * What it keeps:
 * - every read (its trace of OCR passes, what it matched, the events it made);
 * - what the reader applied, what the player undid or answered, and run changes made by hand —
 *   while the reader runs, a hand-made change is most likely something it missed;
 * - one record per floor left (what the route offered, what was entered, how the gifts went) and
 *   one per run that ended;
 * - frames, only when asked and only where they say something: a read that made an event, the
 *   last few reads before a hand-made change while reading, and at most one a minute of a screen
 *   that showed text but no screen it knows (a screen it may be missing).
 *
 * Lifecycle: everything stored goes into the next export, one zip. After exporting, the player
 * clears what that zip holds (the browser cannot say whether the file was saved, so it is never
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
import { DIAG_FORMAT, type DiagRecord, type DiagnosticsBundle } from '../../../core/schema.ts';
import type { FrameSource, ReadReport } from '../session.ts';
import { memoryStore, type DiagStore, type StoredFrame } from './store.ts';

/** Reads kept in memory for a hand-made change to look back on. */
export const RING_SIZE = 8;
/** Caps: past them the oldest frames go, and recording stops at the record cap. */
export const MAX_RECORDS = 20_000;
export const MAX_FRAMES = 300;
export const MAX_FRAME_BYTES = 150 * 1024 * 1024;
/** At most one frame a minute of a screen with text the reader did not recognise. */
export const UNKNOWN_FRAME_GAP_MS = 60_000;

export interface DiagStats {
  records: number;
  frames: number;
  bytes: number;
  /** Records (and their frames) already in an export, still on the device. */
  exportedRecords: number;
  lastExportAt: number | null;
  /** Frames dropped to stay under the caps. */
  trimmedFrames: number;
  /** The record cap was reached: nothing more is recorded until the device is cleared. */
  full: boolean;
}

export interface ExportMark {
  seq: number;
  frameIds: string[];
  at: number;
}

type Without<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type RecordInput = Without<DiagRecord, 't'>;

export class DiagRecorder {
  private seq = 0;
  private records = 0;
  private frameList: { id: string; t: number; bytes: number }[] = [];
  private exported: ExportMark | null = null;
  private exportedRecords = 0;
  private trimmed = 0;
  private startedAt: number | null = null;
  /** The last reads' pictures, not encoded unless a hand-made change keeps them. */
  private ring: { t: number; frame: FrameSource; id: string | null }[] = [];
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
    this.seq = records.reduce((max, r) => Math.max(max, r.seq), 0);
    this.startedAt = records[0]?.rec.t ?? null;
    this.frameList = frames.map(({ id, t, bytes }) => ({ id, t, bytes }));
    this.exported = mark ?? null;
    this.exportedRecords = mark ? records.filter((r) => r.seq <= mark.seq).length : 0;
    this.trimmed = trimmed ?? 0;
  }

  /** Turn recording and frames on or off (frames only ever with recording). */
  setFlags(recording: boolean, images: boolean): void {
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
      full: this.records >= MAX_RECORDS,
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
   * and only then does the frame count — past a cap, the oldest frames go and the stats say so.
   */
  private keepFrame(t: number, frame: FrameSource): string {
    const id = `${t}-${this.seq + 1}`;
    // Asked for right after this read's events are handed on (a microtask: the session hands
    // them on in the same task), and before any later read can push the picture out of the ring
    // and free it — so it is encoded even if the queue is still busy with earlier writes.
    const jpeg = Promise.resolve().then(() => frame.encode());
    void this.enqueue(async () => {
      const blob = await jpeg;
      if (!blob) return;
      this.frameList.push({ id, t, bytes: blob.size });
      await this.store.addFrame({ id, t, bytes: blob.size, blob });
      const drop: string[] = [];
      let bytes = this.frameList.reduce((sum, f) => sum + f.bytes, 0);
      while (this.frameList.length > MAX_FRAMES || bytes > MAX_FRAME_BYTES) {
        const oldest = this.frameList.shift()!;
        bytes -= oldest.bytes;
        drop.push(oldest.id);
      }
      if (drop.length > 0) {
        this.trimmed += drop.length;
        // A ring entry must not go on naming a frame that is gone: it is kept anew if needed.
        const gone = new Set(drop);
        for (const entry of this.ring) if (entry.id && gone.has(entry.id)) entry.id = null;
        await this.store.deleteFrames(drop);
        await this.store.setMeta('trimmed', this.trimmed);
      }
      this.changed();
    });
    return id;
  }

  onRead(report: ReadReport, frame: FrameSource | null): void {
    if (!this.recording) {
      frame?.close();
      return;
    }
    this.lastReadT = report.t;
    let frameId: string | null = null;
    if (frame && this.images) {
      const sawText = report.trace.some((s) => s.lines.some((line) => line.trim() !== ''));
      const unknown = report.frame.screen === null && sawText;
      const keep =
        report.events.length > 0 || (unknown && report.t - this.lastUnknownFrameAt >= UNKNOWN_FRAME_GAP_MS);
      if (keep) {
        frameId = this.keepFrame(report.t, frame);
        if (unknown) this.lastUnknownFrameAt = report.t;
      }
      this.ring.push({ t: report.t, frame, id: frameId });
      if (this.ring.length > RING_SIZE) this.ring.shift()!.frame.close();
    } else frame?.close();
    this.add(
      {
        kind: 'read',
        reason: report.reason,
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
      },
      report.t,
    );
  }

  onSession(input: Without<Extract<DiagRecord, { kind: 'session' }>, 't' | 'kind'>): void {
    this.add({ kind: 'session', ...input });
  }

  /** The reader applied `event` as log entry `logId` (`fromRead`: the latest read made it). */
  onApplied(logId: number, event: { kind: string }, actions: unknown[], fromRead: boolean): void {
    const readT = fromRead ? this.lastReadT : null;
    this.add({ kind: 'applied', logId, readT, event, actions });
  }

  onUndo(logId: number): void {
    this.add({ kind: 'undo', logId });
  }

  onAnswer(ask: { kind: string }, picked: number[]): void {
    this.add({ kind: 'answer', ask, picked });
  }

  /** A run change made by hand. While reading, the last few frames are kept: it is likely a miss. */
  onManual(input: Without<Extract<DiagRecord, { kind: 'manual' }>, 't' | 'kind' | 'frameIds'>): void {
    if (!this.recording) return;
    const frameIds: string[] = [];
    if (input.capturing && this.images) {
      for (const entry of this.ring) {
        entry.id ??= this.keepFrame(entry.t, entry.frame);
        frameIds.push(entry.id);
      }
    }
    this.add({ kind: 'manual', ...input, frameIds });
  }

  onFloor(input: Without<Extract<DiagRecord, { kind: 'floor' }>, 't' | 'kind'>): void {
    this.add({ kind: 'floor', ...input });
  }

  onRun(input: Without<Extract<DiagRecord, { kind: 'run' }>, 't' | 'kind'>): void {
    this.add({ kind: 'run', ...input });
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
        frames: frames.map(({ id, t, bytes }) => ({ id, t, bytes })),
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
    for (const entry of this.ring) if (entry.id && gone.has(entry.id)) entry.id = null;
    this.records -= this.exportedRecords;
    this.exported = null;
    this.exportedRecords = 0;
    this.startedAt = this.records > 0 ? this.startedAt : null;
    this.changed();
    return this.inTurn(async () => {
      await this.store.clearUpTo(mark.seq, mark.frameIds);
      await this.store.setMeta('exported', null);
      return removed;
    });
  }

  /** Remove everything on the device, exported or not — after every write before it. */
  clearAll(): Promise<void> {
    // Records count from the call (a record made after it is kept); frames are counted in the
    // queue's turn, so the frames still being encoded before the clear go with it.
    this.records = 0;
    for (const entry of this.ring) entry.frame.close();
    this.ring = [];
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
