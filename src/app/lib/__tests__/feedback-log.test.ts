/**
 * M127: the feedback form's in-memory log — a ring of the last errors and store changes.
 */
import { describe, expect, it } from 'vitest';
import { emptyRun } from '../../store.ts';
import {
  describeChange,
  describeError,
  FeedbackLog,
  installFeedbackLog,
  Ring,
  shortStack,
  type LoggedState,
} from '../feedback-log.ts';

const base = (): LoggedState => ({
  deck: [10101, 10201],
  deployed: [],
  wanted: [],
  fusionGoal: {},
  options: { startKeyword: null },
  run: emptyRun(),
  lang: 'ko',
  dark: true,
  season: 7,
  ui: { leftTab: 'gifts', rightTab: 'plan' },
});

describe('Ring', () => {
  it('keeps the newest entries up to its capacity, oldest first', () => {
    // Arrange
    const ring = new Ring<number>(3);
    // Act
    for (let i = 1; i <= 5; i += 1) ring.push(i);
    // Assert
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.size).toBe(3);
    ring.clear();
    expect(ring.toArray()).toEqual([]);
  });
});

describe('FeedbackLog', () => {
  it('caps at 50 by default and tells listeners about each entry', () => {
    // Arrange
    let now = 1000;
    const log = new FeedbackLog(undefined, () => (now += 1), 'https://example.test');
    const heard: string[] = [];
    const off = log.subscribe((entry) => heard.push(entry.kind));
    // Act
    for (let i = 0; i < 60; i += 1) log.action(`step ${i}`);
    const error = new TypeError('boom');
    error.stack =
      'TypeError: boom\n    at f (https://example.test/assets/index.js:1:2)\n    at g\n    at h\n    at i\n    at j';
    log.error('window', error);
    off();
    log.action('after');
    // Assert
    const entries = log.entries();
    expect(entries).toHaveLength(50);
    expect(entries[0]).toMatchObject({ kind: 'action', text: 'step 12' });
    const last = entries[entries.length - 2]!;
    expect(entries[entries.length - 1]).toMatchObject({ text: 'after' });
    expect(last).toMatchObject({ kind: 'error', source: 'window', message: 'TypeError: boom' });
    // The stack keeps four lines, without the origin.
    expect(last.kind === 'error' && last.stack).toBe(
      'TypeError: boom\nat f (/assets/index.js:1:2)\nat g\nat h',
    );
    expect(heard).toHaveLength(61);
  });

  it('describes non-Error causes without throwing', () => {
    expect(describeError('plain').message).toBe('plain');
    expect(describeError({ a: 1 }).message).toBe('{"a":1}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular).message).toBe('[object Object]');
    expect(describeError('x'.repeat(400)).message).toHaveLength(300);
    expect(shortStack(undefined)).toBeUndefined();
  });
});

describe('describeChange', () => {
  it('says goals, deck, options and run changes in a word each, and nothing for an unchanged state', () => {
    // Arrange
    const prev = base();
    const next: LoggedState = {
      ...prev,
      deck: [10101, 10202],
      wanted: [9088],
      options: { startKeyword: 'Burn' },
      run: {
        ...prev.run,
        currentFloor: 2,
        visits: { 1: 1012 },
        giftStatus: { 9088: 'got' },
      },
      ui: { leftTab: 'deck', rightTab: 'plan' },
    };
    // Act
    const lines = describeChange(prev, next);
    // Assert
    expect(lines).toEqual([
      'deck +10202 -10201',
      'goal +9088',
      'options startKeyword="Burn"',
      'enter F1 pack 1012',
      'gift 9088 - → got',
      'frontier F1 → F2',
      'left tab deck',
    ]);
    expect(describeChange(prev, { ...prev })).toEqual([]);
  });

  it('says a pack taken back and a theme switch', () => {
    const prev = { ...base(), run: { ...emptyRun(), visits: { 3: 1020 }, currentFloor: 4, stageFloor: 3 } };
    const next = { ...prev, dark: false, run: { ...prev.run, visits: {}, currentFloor: 3 } };
    expect(describeChange(prev, next)).toEqual(['leave F3 pack 1020', 'frontier F4 → F3', 'theme light']);
  });
});

describe('installFeedbackLog', () => {
  it('logs window errors, rejected promises and store changes, and undoes all of it', () => {
    // Arrange
    const target = new EventTarget();
    let listener: ((state: LoggedState, prev: LoggedState) => void) | null = null;
    const store = {
      subscribe: (fn: (state: LoggedState, prev: LoggedState) => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
    };
    const log = new FeedbackLog(10, () => 0);
    // Act
    const undo = installFeedbackLog(target, store, log);
    const errorEvent = new Event('error') as Event & { error: unknown };
    errorEvent.error = new Error('kaput');
    target.dispatchEvent(errorEvent);
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
    rejection.reason = 'nope';
    target.dispatchEvent(rejection);
    listener!({ ...base(), wanted: [9001] }, base());
    undo();
    target.dispatchEvent(errorEvent);
    // Assert
    expect(log.entries().map((e) => (e.kind === 'error' ? `${e.source}:${e.message}` : e.text))).toEqual([
      'window:kaput',
      'promise:nope',
      'goal +9001',
    ]);
    expect(listener).toBeNull();
  });
});
