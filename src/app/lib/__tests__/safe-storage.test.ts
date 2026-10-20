/**
 * M160: the store's storage never throws out of an action, and does not rewrite what it wrote.
 */
import { describe, expect, it, vi } from 'vitest';
import { emptyRun, useApp } from '../../store.ts';
import { safeStateStorage, type BackingStore } from '../safe-storage.ts';

/** A backing store that can be told to refuse writes, and counts what reached it. */
function backing(): BackingStore & { writes: string[]; refuse: boolean } {
  const items = new Map<string, string>();
  return {
    writes: [],
    refuse: false,
    getItem: (name) => items.get(name) ?? null,
    setItem(name, value) {
      if (this.refuse) throw new DOMException('full', 'QuotaExceededError');
      items.set(name, value);
      this.writes.push(value);
    },
    removeItem: (name) => void items.delete(name),
  };
}

describe('safeStateStorage', () => {
  it('swallows a write that throws, says so once, and tries again on the next change', () => {
    // Arrange: a full store.
    const store = backing();
    store.refuse = true;
    const warn = vi.fn();
    const storage = safeStateStorage(() => store, warn);
    // Act: two writes fail, then the store has room again.
    expect(() => storage.setItem('k', 'one')).not.toThrow();
    storage.setItem('k', 'two');
    store.refuse = false;
    storage.setItem('k', 'two');
    // Assert: one warning for the two failures, and the retry of the same text went through.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(store.writes).toEqual(['two']);
  });

  it('skips a write of the text already written, and writes again after a remove', () => {
    // Arrange
    const store = backing();
    const storage = safeStateStorage(() => store, vi.fn());
    // Act
    storage.setItem('k', 'same');
    storage.setItem('k', 'same');
    storage.setItem('k', 'other');
    storage.removeItem('k');
    storage.setItem('k', 'other');
    // Assert
    expect(store.writes).toEqual(['same', 'other', 'other']);
    expect(storage.getItem('k')).toBe('other');
  });

  it('reads nothing and writes nothing when the store cannot even be reached', () => {
    // Arrange: `window.localStorage` itself throws under some privacy settings.
    const warn = vi.fn();
    const storage = safeStateStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    }, warn);
    // Act + Assert
    expect(storage.getItem('k')).toBeNull();
    expect(() => storage.setItem('k', 'v')).not.toThrow();
    expect(() => storage.removeItem('k')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the store under a full quota (M160)', () => {
  it('finishes the action instead of throwing after the state changed', () => {
    // Arrange: every write to localStorage fails.
    useApp.setState({ run: emptyRun() });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      // Act
      expect(() => useApp.getState().setGiftStatus(9006, 'got')).not.toThrow();
      // Assert: the state changed, so a caller's next step runs on it.
      expect(useApp.getState().run.giftStatus[9006]).toBe('got');
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
});
