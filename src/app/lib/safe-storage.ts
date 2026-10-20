/**
 * The store's localStorage, made safe (M160).
 *
 * zustand's `persist` writes synchronously inside every `set`, and `localStorage.setItem` throws
 * when the quota is full (the visitor's diagnostics share the origin and can fill it). The throw
 * used to escape the action *after* the state had changed, so a caller's next step was skipped —
 * `enterAt` never showed the floor it entered, `execute` stopped halfway through its steps. Here a
 * failed write is swallowed, said once in the feedback log, and tried again on the next change.
 *
 * It also skips a write whose text is the one already written (C6): a `set` of a field `partialize`
 * leaves out (`captureLive`) serialises the same blob, and writing it again bought nothing.
 */
import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';
import { feedbackLog } from './feedback-log.ts';

/** What the storage needs of its backing store: the synchronous part of `Storage`. */
export interface BackingStore {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

let warned = false;

/** Said once per page: a storage that is full stays full, and the log is a ring. */
function warnOnce(cause: unknown): void {
  if (warned) return;
  warned = true;
  const name = cause instanceof Error ? cause.name : 'Error';
  feedbackLog.action(`storage write failed (${name})`);
}

/**
 * A `StateStorage` that never throws: a read that fails is empty, a write that fails is noted
 * (`warn`, once) and forgotten so the next change tries again, and a write of the text already
 * written is skipped. `backing` is read on every call, so a store that becomes available (or
 * throws on access, as `window.localStorage` does under some privacy settings) is handled alike.
 */
export function safeStateStorage(
  backing: () => BackingStore = () => window.localStorage,
  warn: (cause: unknown) => void = warnOnce,
): StateStorage {
  const written = new Map<string, string>();
  return {
    getItem(name) {
      try {
        return backing().getItem(name);
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      if (written.get(name) === value) return;
      try {
        backing().setItem(name, value);
        written.set(name, value);
      } catch (cause) {
        written.delete(name);
        warn(cause);
      }
    },
    removeItem(name) {
      written.delete(name);
      try {
        backing().removeItem(name);
      } catch {
        // Nothing to remove, or no store to remove it from.
      }
    },
  };
}

/** The store's persist storage: JSON over `safeStateStorage`. */
export function safePersistStorage<S>(backing?: () => BackingStore): PersistStorage<S, unknown> {
  // `createJSONStorage` is undefined only when the getter throws; this one never does.
  return createJSONStorage<S>(() => safeStateStorage(backing))!;
}
