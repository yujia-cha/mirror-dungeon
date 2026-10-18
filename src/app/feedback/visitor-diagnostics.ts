/**
 * 피드백용 진단 기록 (M127) — the visitor's own diagnostics, separate from the owner's.
 *
 * The owner's recorder (`capture/diagnostics/`, `#diag`) keeps every OCR pass and, on request,
 * game frames, in IndexedDB, and leaves the device only as a zip the owner carries by hand. A
 * visitor needs none of that and must never send a game frame to a public issue. This one is
 * small and text-only:
 *
 * - **What**: app errors and the visitor's changes (copied from `feedbackLog`), each floor the run
 *   leaves with what the route recommended there and what came of its expected gifts, and — when
 *   the screen reader runs — a line per read that saw something (screen, floor, pack, gift, events),
 *   per event applied or undone, per question answered and per session change. No OCR text
 *   beyond the matched ids, no images.
 * - **Where**: this device's `localStorage` under its own key (`VISITOR_DIAG_KEY`), so it survives a
 *   reload until the visitor sends feedback or clears it. At most `VISITOR_DIAG_CAPACITY` records;
 *   the oldest go first.
 * - **When**: only while the visitor has turned it on in the feedback form. Off by default.
 *
 * Pure apart from the storage it is handed; `visitorDiagnostics` is the page's instance.
 */
import type { CaptureEvent } from '../capture/tracker.ts';
import type { FeedbackLogEntry } from '../lib/feedback-log.ts';

export const VISITOR_DIAG_KEY = 'md-feedback-diagnostics';
export const VISITOR_DIAG_CAPACITY = 400;
/** Writes are batched: one `setItem` per this many ms at most. */
const SAVE_DELAY_MS = 500;

export type VisitorRecord =
  | { t: number; kind: 'error'; source: string; message: string; stack?: string }
  | { t: number; kind: 'action'; text: string }
  | {
      t: number;
      kind: 'floor';
      floor: number;
      /** The pack the route on show put on this floor, and the others that would have done. */
      recommended: number | null;
      alternatives: number[];
      entered: number | null;
      /** Gifts the route expected from the entered pack, with what the run recorded for each. */
      expected: [giftId: number, status: string | null][];
    }
  | {
      t: number;
      kind: 'read';
      screen: string | null;
      floor: number | null;
      pack: number | null;
      gift: number | null;
      events: string[];
    }
  | { t: number; kind: 'applied'; event: string; actions: number; fromRead: boolean }
  | { t: number; kind: 'undo'; logId: number }
  | { t: number; kind: 'answer'; ask: string; picked: number[] }
  | { t: number; kind: 'session'; status: string; error: string | null };

export type VisitorRecordKind = VisitorRecord['kind'];

export interface VisitorDiagStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface Saved {
  v: 1;
  on: boolean;
  records: VisitorRecord[];
}

/** A capture event in a word: `enter F3 1012`, `got 9088`, `fused 9249 ← 9001,9002`. */
export function eventText(event: CaptureEvent | { kind: string }): string {
  const e = event as CaptureEvent;
  switch (e.kind) {
    case 'enter':
      return `enter F${e.floor} ${e.packId}`;
    case 'got':
      return `got ${e.giftId}${e.source ? ` ${e.source}` : ''}`;
    case 'startDone':
      return 'startDone';
    case 'place':
      return e.shop ? 'shop in' : 'shop out';
    case 'sold':
      return `sold ${e.giftId}`;
    case 'fused':
      return `fused ${e.resultId} ← ${e.consumed.join(',')}${e.unsure.length ? ` ?${e.unsure.join(',')}` : ''}`;
    case 'unsure':
      return `unsure ${e.about} ${e.ids.join(',')}`;
    default:
      return String((event as { kind: string }).kind);
  }
}

function isRecord(value: unknown): value is VisitorRecord {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { t?: unknown }).t === 'number' &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

/** Per-kind counts, in a fixed key order. */
export function countByKind(records: readonly VisitorRecord[]): Partial<Record<VisitorRecordKind, number>> {
  const order: VisitorRecordKind[] = [
    'error',
    'action',
    'floor',
    'read',
    'applied',
    'undo',
    'answer',
    'session',
  ];
  const out: Partial<Record<VisitorRecordKind, number>> = {};
  for (const kind of order) {
    const n = records.filter((record) => record.kind === kind).length;
    if (n) out[kind] = n;
  }
  return out;
}

export interface VisitorDiagSnapshot {
  on: boolean;
  count: number;
}

export class VisitorDiagnostics {
  private on = false;
  private records: VisitorRecord[] = [];
  private listeners = new Set<() => void>();
  private snapshotCache: VisitorDiagSnapshot = { on: false, count: 0 };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last read recorded, so a screen held still is not written every 250 ms. */
  private lastRead = '';

  constructor(
    private storage: VisitorDiagStorage | null,
    private now: () => number = Date.now,
    readonly capacity = VISITOR_DIAG_CAPACITY,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(VISITOR_DIAG_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Saved>;
      this.on = saved.on === true;
      this.records = Array.isArray(saved.records) ? saved.records.filter(isRecord).slice(-this.capacity) : [];
    } catch {
      // A broken or blocked store starts empty; the next save rewrites it.
      this.on = false;
      this.records = [];
    }
    this.refresh();
  }

  private refresh(): void {
    this.snapshotCache = { on: this.on, count: this.records.length };
    for (const listener of this.listeners) listener();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DELAY_MS);
  }

  /** Write now. Storage that refuses (private mode, a full quota) keeps the memory copy only. */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      if (!this.on && this.records.length === 0) this.storage?.removeItem(VISITOR_DIAG_KEY);
      else
        this.storage?.setItem(
          VISITOR_DIAG_KEY,
          JSON.stringify({ v: 1, on: this.on, records: this.records } satisfies Saved),
        );
    } catch {
      /* memory only */
    }
  }

  get recording(): boolean {
    return this.on;
  }

  setOn(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    this.lastRead = '';
    this.refresh();
    this.flush();
  }

  /** Forget every record; the on/off choice stays. */
  clear(): void {
    this.records = [];
    this.lastRead = '';
    this.refresh();
    this.flush();
  }

  /** Every record, oldest first. */
  list(): VisitorRecord[] {
    return [...this.records];
  }

  snapshot(): VisitorDiagSnapshot {
    return this.snapshotCache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Add a record when recording; the time is stamped here. */
  add(record: DistributiveOmit<VisitorRecord, 't'>): void {
    if (!this.on) return;
    this.records.push({ t: this.now(), ...record } as VisitorRecord);
    if (this.records.length > this.capacity) this.records.splice(0, this.records.length - this.capacity);
    this.refresh();
    this.scheduleSave();
  }

  /** A feedback-log entry, copied while recording. */
  onLog(entry: FeedbackLogEntry): void {
    if (entry.kind === 'error')
      this.add({
        kind: 'error',
        source: entry.source,
        message: entry.message,
        ...(entry.stack ? { stack: entry.stack } : {}),
      });
    else this.add({ kind: 'action', text: entry.text });
  }

  /**
   * One screen-reader read. Written only when it saw something new: events, or a screen / floor /
   * pack / gift different from the last read written. A read of nothing is not written.
   */
  onRead(read: {
    screen: string | null;
    floor: number | null;
    pack: number | null;
    gift: number | null;
    events: string[];
  }): void {
    if (!this.on) return;
    const key = JSON.stringify([read.screen, read.floor, read.pack, read.gift]);
    if (!read.events.length && (key === this.lastRead || read.screen === null)) return;
    this.lastRead = key;
    this.add({ kind: 'read', ...read });
  }
}

/** `Omit` that keeps a union a union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function pageStorage(): VisitorDiagStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The page's one visitor record. */
export const visitorDiagnostics = new VisitorDiagnostics(pageStorage());

/**
 * What goes into the feedback payload: the counts and the most recent `limit` records as compact
 * rows. The issue URL is small, so the body builder asks for fewer when it must (`limit`).
 */
export interface VisitorDiagSummary {
  total: number;
  counts: Partial<Record<VisitorRecordKind, number>>;
  from: number | null;
  to: number | null;
  /** The newest `limit` records, oldest first. */
  records: VisitorRecord[];
  /** Records left out of `records` (older ones). */
  omitted: number;
}

export function summarize(records: readonly VisitorRecord[], limit = records.length): VisitorDiagSummary {
  const kept = limit > 0 ? records.slice(-limit) : [];
  return {
    total: records.length,
    counts: countByKind(records),
    from: records[0]?.t ?? null,
    to: records[records.length - 1]?.t ?? null,
    records: kept,
    omitted: records.length - kept.length,
  };
}
