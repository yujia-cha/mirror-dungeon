/**
 * Where the owner's diagnostics wait to be exported (M112): records and kept frames, on this
 * device only. IndexedDB, so a reload or a crash keeps them; an in-memory stand-in where there is
 * no IndexedDB (jsdom, a browser that refuses it), which loses them on reload and says nothing —
 * the export still works for what this page recorded.
 *
 * No dependency: the four operations the recorder needs are a few lines over the raw API.
 */
import type { DiagFrameClass, DiagRecord } from '../../../core/schema.ts';

export interface StoredRecord {
  seq: number;
  rec: DiagRecord;
}

export interface StoredFrame {
  id: string;
  t: number;
  bytes: number;
  blob: Blob;
  /** Why it was kept (M134). Frames stored before M134 have none: read them as `routine`. */
  class?: DiagFrameClass;
}

/**
 * The recorder's counters (M154), kept in the meta store beside the records they count — written
 * in the same transaction as each record — so opening the device need not read every record back.
 */
export interface DiagCounts {
  records: number;
  /** Routine reads among them (no event, no frame — M153). */
  readRecords: number;
  /** The last record's seq. */
  seq: number;
  /** The first record's time, or null. */
  startedAt: number | null;
}

export interface DiagStore {
  /** Add a record; `counts` (M154), when given, are the counters with it, stored with it. */
  addRecord(seq: number, rec: DiagRecord, counts?: DiagCounts): Promise<void>;
  /** How many records are stored, without reading them (M154). */
  countRecords(): Promise<number>;
  addFrame(frame: StoredFrame): Promise<void>;
  records(): Promise<StoredRecord[]>;
  frames(): Promise<StoredFrame[]>;
  deleteFrames(ids: readonly string[]): Promise<void>;
  /** A kept frame turned out to matter more (an event undone): its class goes up. */
  setFrameClass(id: string, cls: DiagFrameClass): Promise<void>;
  /** Drop records up to and including `seq`, and the frames named; `counts` as for `addRecord`. */
  clearUpTo(seq: number, frameIds: readonly string[], counts?: DiagCounts): Promise<void>;
  clearAll(): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export function memoryStore(): DiagStore {
  const records = new Map<number, DiagRecord>();
  const frames = new Map<string, StoredFrame>();
  const meta = new Map<string, unknown>();
  return {
    addRecord: async (seq, rec, counts) => {
      records.set(seq, rec);
      if (counts) meta.set(COUNTS, counts);
    },
    countRecords: async () => records.size,
    addFrame: async (frame) => void frames.set(frame.id, frame),
    records: async () => [...records].sort(([a], [b]) => a - b).map(([seq, rec]) => ({ seq, rec })),
    frames: async () => [...frames.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)),
    deleteFrames: async (ids) => ids.forEach((id) => frames.delete(id)),
    setFrameClass: async (id, cls) => {
      const frame = frames.get(id);
      if (frame) frames.set(id, { ...frame, class: cls });
    },
    clearUpTo: async (seq, ids, counts) => {
      for (const key of [...records.keys()]) if (key <= seq) records.delete(key);
      ids.forEach((id) => frames.delete(id));
      if (counts) meta.set(COUNTS, counts);
    },
    clearAll: async () => {
      records.clear();
      frames.clear();
      meta.clear();
    },
    getMeta: async <T>(key: string) => meta.get(key) as T | undefined,
    setMeta: async (key, value) => void meta.set(key, value),
  };
}

const DB = 'md-diagnostics';
/** The meta key of the recorder's counters (`DiagCounts`, M154). */
export const COUNTS = 'counts';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function idbStore(db: IDBDatabase): DiagStore {
  const tx = (stores: string[], mode: IDBTransactionMode) => db.transaction(stores, mode);
  return {
    async addRecord(seq, rec, counts) {
      const t = tx(counts ? ['records', 'meta'] : ['records'], 'readwrite');
      t.objectStore('records').put(rec, seq);
      if (counts) t.objectStore('meta').put(counts, COUNTS);
      await done(t);
    },
    async countRecords() {
      const t = tx(['records'], 'readonly');
      return request(t.objectStore('records').count());
    },
    async addFrame(frame) {
      const t = tx(['frames'], 'readwrite');
      t.objectStore('frames').put(frame, frame.id);
      await done(t);
    },
    async records() {
      const t = tx(['records'], 'readonly');
      const store = t.objectStore('records');
      const [keys, values] = await Promise.all([
        request(store.getAllKeys() as IDBRequest<number[]>),
        request(store.getAll() as IDBRequest<DiagRecord[]>),
      ]);
      return keys.map((seq, i) => ({ seq, rec: values[i]! }));
    },
    async frames() {
      const t = tx(['frames'], 'readonly');
      const all = await request(t.objectStore('frames').getAll() as IDBRequest<StoredFrame[]>);
      return all.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    },
    async deleteFrames(ids) {
      const t = tx(['frames'], 'readwrite');
      for (const id of ids) t.objectStore('frames').delete(id);
      await done(t);
    },
    async setFrameClass(id, cls) {
      const t = tx(['frames'], 'readwrite');
      const store = t.objectStore('frames');
      const frame = await request(store.get(id) as IDBRequest<StoredFrame | undefined>);
      if (frame) store.put({ ...frame, class: cls }, id);
      await done(t);
    },
    async clearUpTo(seq, ids, counts) {
      const t = tx(['records', 'frames', 'meta'], 'readwrite');
      t.objectStore('records').delete(IDBKeyRange.upperBound(seq));
      for (const id of ids) t.objectStore('frames').delete(id);
      if (counts) t.objectStore('meta').put(counts, COUNTS);
      await done(t);
    },
    async clearAll() {
      const t = tx(['records', 'frames', 'meta'], 'readwrite');
      for (const name of ['records', 'frames', 'meta']) t.objectStore(name).clear();
      await done(t);
    },
    async getMeta<T>(key: string) {
      const t = tx(['meta'], 'readonly');
      return (await request(t.objectStore('meta').get(key))) as T | undefined;
    },
    async setMeta(key, value) {
      const t = tx(['meta'], 'readwrite');
      t.objectStore('meta').put(value, key);
      await done(t);
    },
  };
}

/** The device's store, or the in-memory one when IndexedDB is missing or refuses. */
export async function openDiagStore(): Promise<DiagStore> {
  if (typeof indexedDB === 'undefined') return memoryStore();
  try {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of ['records', 'frames', 'meta'])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    return idbStore(await request(open));
  } catch {
    return memoryStore();
  }
}
