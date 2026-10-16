/**
 * M127: 피드백용 진단 기록 — the visitor's own text-only record, separate from the owner's `#diag`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  eventText,
  summarize,
  VISITOR_DIAG_KEY,
  VisitorDiagnostics,
  type VisitorDiagStorage,
} from '../visitor-diagnostics.ts';

function memoryStorage(): VisitorDiagStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('VisitorDiagnostics', () => {
  it('records nothing until turned on, then keeps records on this device under its own key', () => {
    // Arrange
    const storage = memoryStorage();
    let now = 0;
    const diag = new VisitorDiagnostics(storage, () => (now += 1000));
    // Act: off by default.
    diag.add({ kind: 'action', text: 'goal +9088' });
    expect(diag.snapshot()).toEqual({ on: false, count: 0 });
    diag.setOn(true);
    diag.add({ kind: 'action', text: 'goal +9088' });
    diag.onLog({ t: 0, kind: 'error', source: 'render', message: 'boom', stack: 'at x' });
    diag.flush();
    // Assert
    expect(diag.snapshot()).toEqual({ on: true, count: 2 });
    expect(storage.data.has(VISITOR_DIAG_KEY)).toBe(true);
    // Not the owner's store: nothing else was written.
    expect([...storage.data.keys()]).toEqual([VISITOR_DIAG_KEY]);
    const reopened = new VisitorDiagnostics(storage);
    expect(reopened.snapshot()).toEqual({ on: true, count: 2 });
    expect(reopened.list()[1]).toMatchObject({ kind: 'error', message: 'boom', stack: 'at x' });
  });

  it('drops the oldest records past its capacity, and clearing keeps the choice', () => {
    const storage = memoryStorage();
    const diag = new VisitorDiagnostics(storage, () => 0, 3);
    diag.setOn(true);
    for (let i = 0; i < 5; i += 1) diag.add({ kind: 'action', text: `a${i}` });
    expect(diag.list().map((r) => (r.kind === 'action' ? r.text : ''))).toEqual(['a2', 'a3', 'a4']);
    diag.clear();
    expect(diag.snapshot()).toEqual({ on: true, count: 0 });
    diag.setOn(false);
    // Off and empty: nothing is left in storage.
    expect(storage.data.size).toBe(0);
  });

  it('writes a read only when it saw something new, never a frame', () => {
    const diag = new VisitorDiagnostics(null, () => 0);
    diag.setOn(true);
    const read = { screen: 'map', floor: 3, pack: 1012, gift: null, events: [] };
    diag.onRead(read);
    diag.onRead(read);
    diag.onRead({ ...read, screen: null, floor: null, pack: null });
    diag.onRead({ ...read, events: ['enter F3 1012'] });
    diag.onRead({ ...read, screen: 'giftPopup', gift: 9088 });
    expect(diag.list().map((r) => r.kind === 'read' && [r.screen, r.events.length])).toEqual([
      ['map', 0],
      ['map', 1],
      ['giftPopup', 0],
    ]);
    expect(JSON.stringify(diag.list())).not.toMatch(/data:image|blob:/);
  });

  it('survives a broken or blocked store', () => {
    const broken: VisitorDiagStorage = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const diag = new VisitorDiagnostics(broken);
    expect(diag.snapshot()).toEqual({ on: false, count: 0 });
    diag.setOn(true);
    diag.add({ kind: 'undo', logId: 3 });
    expect(() => diag.flush()).not.toThrow();
    expect(diag.snapshot().count).toBe(1);
  });

  it('batches writes', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const diag = new VisitorDiagnostics(storage, () => 0);
    diag.setOn(true);
    setItem.mockClear();
    for (let i = 0; i < 10; i += 1) diag.add({ kind: 'action', text: String(i) });
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe('summarize and eventText', () => {
  it('counts by kind and keeps the newest records', () => {
    const records = [
      { t: 1, kind: 'action' as const, text: 'a' },
      { t: 2, kind: 'undo' as const, logId: 1 },
      { t: 3, kind: 'action' as const, text: 'b' },
    ];
    expect(summarize(records, 2)).toEqual({
      total: 3,
      counts: { action: 2, undo: 1 },
      from: 1,
      to: 3,
      records: records.slice(1),
      omitted: 1,
    });
    expect(summarize(records, 0).records).toEqual([]);
  });

  it('says capture events in a word', () => {
    expect(eventText({ kind: 'enter', floor: 3, packId: 1012 })).toBe('enter F3 1012');
    expect(eventText({ kind: 'fused', resultId: 9249, consumed: [1, 2], unsure: [3] })).toBe(
      'fused 9249 ← 1,2 ?3',
    );
    expect(eventText({ kind: 'unsure', about: 'got', ids: [4, 5] })).toBe('unsure got 4,5');
    expect(eventText({ kind: 'answer' })).toBe('answer');
  });
});
