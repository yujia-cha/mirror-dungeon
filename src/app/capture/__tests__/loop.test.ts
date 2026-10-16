import { describe, expect, it } from 'vitest';
import { decide, finished, INITIAL_LOOP, READ_INTERVALS, REFRESH_MS } from '../loop.ts';

const sig = new Uint8Array([1, 2, 3]);

describe('decide', () => {
  it('reads the first frame', () => {
    const { decision, state } = decide(INITIAL_LOOP, sig, true, 0);
    expect(decision).toBe('read');
    expect(state).toMatchObject({ busy: true, lastReadAt: 0, lastRead: sig });
  });

  it('skips an unchanged screen until the refresh is due', () => {
    // Arrange: a read at t=0 has finished.
    const idle = finished(decide(INITIAL_LOOP, sig, true, 0).state);
    // Act + Assert
    expect(decide(idle, sig, false, REFRESH_MS - 1).decision).toBe('skip');
    expect(decide(idle, sig, false, REFRESH_MS).decision).toBe('read');
  });

  it('never starts a second read while one runs, and reads the newest frame once it is free', () => {
    // Arrange: busy reading; the screen changes twice meanwhile.
    let state = decide(INITIAL_LOOP, sig, true, 0).state;
    const first = decide(state, sig, true, 100);
    state = first.state;
    const second = decide(state, sig, true, 200);
    state = second.state;
    // Act
    state = finished(state);
    const next = decide(state, sig, false, 300);
    // Assert: both changes while busy were skipped and remembered as one.
    expect([first.decision, second.decision]).toEqual(['skip', 'skip']);
    expect(next.decision).toBe('read');
    expect(next.state.dirty).toBe(false);
  });

  it('keeps the same state object for a skipped, unchanged tick', () => {
    const idle = finished(decide(INITIAL_LOOP, sig, true, 0).state);
    expect(decide(idle, sig, false, 10).state).toBe(idle);
    expect(finished(idle)).toBe(idle);
  });
});

describe('READ_INTERVALS', () => {
  it('offers the four presets from slowest to fastest', () => {
    expect(Object.values(READ_INTERVALS)).toEqual([1000, 500, 250, 125]);
  });
});
