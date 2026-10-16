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
 *
 * React-free: the provider feeds it, the popover reads `stats()`, tests drive it with
 * `memoryStore()`.
 */
import { DIAG_FORMAT, type DiagRecord, type DiagnosticsBundle } from '../../../core/schema.ts';
import type { ReadReport } from '../session.ts';
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

interface ExportMark {
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
  private ring: { t: number; blob: Blob; id: string | null }[] = [];
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

  private keepFrame(t: number, blob: Blob): string {
    const id = `${t}-${this.seq + 1}`;
    const frame: StoredFrame = { id, t, bytes: blob.size, blob };
    this.frameList.push({ id, t, bytes: blob.size });
    void this.enqueue(() => this.store.addFrame(frame));
    // Over a cap: the oldest frames go, and the stats say so.
    const drop: string[] = [];
    let bytes = this.frameList.reduce((sum, f) => sum + f.bytes, 0);
    while (this.frameList.length > MAX_FRAMES || bytes > MAX_FRAME_BYTES) {
      const oldest = this.frameList.shift()!;
      bytes -= oldest.bytes;
      drop.push(oldest.id);
    }
    if (drop.length > 0) {
      this.trimmed += drop.length;
      const trimmed = this.trimmed;
      void this.enqueue(async () => {
        await this.store.deleteFrames(drop);
        await this.store.setMeta('trimmed', trimmed);
      });
    }
    return id;
  }

  onRead(report: ReadReport, image: Blob | null): void {
    if (!this.recording) return;
    this.lastReadT = report.t;
    let frameId: string | null = null;
    if (image && this.images) {
      const sawText = report.trace.some((s) => s.lines.some((line) => line.trim() !== ''));
      const unknown = report.frame.screen === null && sawText;
      const keep =
        report.events.length > 0 || (unknown && report.t - this.lastUnknownFrameAt >= UNKNOWN_FRAME_GAP_MS);
      if (keep) {
        frameId = this.keepFrame(report.t, image);
        if (unknown) this.lastUnknownFrameAt = report.t;
      }
      this.ring.push({ t: report.t, blob: image, id: frameId });
      if (this.ring.length > RING_SIZE) this.ring.shift();
    }
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
        entry.id ??= this.keepFrame(entry.t, entry.blob);
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
   * Everything stored, as one bundle plus its frames, and marked exported. The caller zips and
   * downloads it; clearing is the player's next step (`clearExported`).
   */
  async exportBundle(meta: {
    dataVersion: string;
    season: number;
    layoutReference: DiagnosticsBundle['layoutReference'];
  }): Promise<{ bundle: DiagnosticsBundle; frames: StoredFrame[]; name: string }> {
    await this.flush();
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
    this.exported = mark;
    this.exportedRecords = records.length;
    await this.store.setMeta('exported', mark);
    this.changed();
    return { bundle, frames, name: `md-diagnostics-${stamp(at)}.zip` };
  }

  /** Remove what the last export holds; anything recorded since stays. */
  async clearExported(): Promise<{ records: number; frames: number }> {
    const mark = this.exported;
    if (!mark) return { records: 0, frames: 0 };
    await this.flush();
    const removed = { records: this.exportedRecords, frames: mark.frameIds.length };
    await this.store.clearUpTo(mark.seq, mark.frameIds);
    await this.store.setMeta('exported', null);
    const gone = new Set(mark.frameIds);
    this.frameList = this.frameList.filter((f) => !gone.has(f.id));
    for (const entry of this.ring) if (entry.id && gone.has(entry.id)) entry.id = null;
    this.records -= this.exportedRecords;
    this.exported = null;
    this.exportedRecords = 0;
    this.startedAt = this.records > 0 ? this.startedAt : null;
    this.changed();
    return removed;
  }

  /** Remove everything on the device, exported or not. */
  async clearAll(): Promise<void> {
    await this.flush();
    await this.store.clearAll();
    this.records = 0;
    this.frameList = [];
    this.ring = [];
    this.exported = null;
    this.exportedRecords = 0;
    this.trimmed = 0;
    this.startedAt = null;
    this.changed();
  }
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}
