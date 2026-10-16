/**
 * Where the owner's diagnostics wait to be exported (M112): records and kept frames, on this
 * device only. IndexedDB, so a reload or a crash keeps them; an in-memory stand-in where there is
 * no IndexedDB (jsdom, a browser that refuses it), which loses them on reload and says nothing —
 * the export still works for what this page recorded.
 *
 * No dependency: the four operations the recorder needs are a few lines over the raw API.
 */
import type { DiagRecord } from '../../../core/schema.ts';

export interface StoredRecord {
  seq: number;
  rec: DiagRecord;
}

export interface StoredFrame {
  id: string;
  t: number;
  bytes: number;
  blob: Blob;
}

export interface DiagStore {
  addRecord(seq: number, rec: DiagRecord): Promise<void>;
  addFrame(frame: StoredFrame): Promise<void>;
  records(): Promise<StoredRecord[]>;
  frames(): Promise<StoredFrame[]>;
  deleteFrames(ids: readonly string[]): Promise<void>;
  /** Drop records up to and including `seq`, and the frames named. */
  clearUpTo(seq: number, frameIds: readonly string[]): Promise<void>;
  clearAll(): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export function memoryStore(): DiagStore {
  const records = new Map<number, DiagRecord>();
  const frames = new Map<string, StoredFrame>();
  const meta = new Map<string, unknown>();
  return {
    addRecord: async (seq, rec) => void records.set(seq, rec),
    addFrame: async (frame) => void frames.set(frame.id, frame),
    records: async () => [...records].sort(([a], [b]) => a - b).map(([seq, rec]) => ({ seq, rec })),
    frames: async () => [...frames.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)),
    deleteFrames: async (ids) => ids.forEach((id) => frames.delete(id)),
    clearUpTo: async (seq, ids) => {
      for (const key of [...records.keys()]) if (key <= seq) records.delete(key);
      ids.forEach((id) => frames.delete(id));
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
    async addRecord(seq, rec) {
      const t = tx(['records'], 'readwrite');
      t.objectStore('records').put(rec, seq);
      await done(t);
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
    async clearUpTo(seq, ids) {
      const t = tx(['records', 'frames'], 'readwrite');
      t.objectStore('records').delete(IDBKeyRange.upperBound(seq));
      for (const id of ids) t.objectStore('frames').delete(id);
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
