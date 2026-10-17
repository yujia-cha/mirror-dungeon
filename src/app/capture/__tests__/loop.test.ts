import { describe, expect, it } from 'vitest';
import {
  BURST_REFRESH_MS,
  BURST_TICK_MS,
  decide,
  finished,
  INITIAL_LOOP,
  POPUP_BURST_MS,
  READ_INTERVALS,
  REFRESH_MAX_MS,
  REFRESH_MS,
  tickDelay,
  type LoopState,
} from '../loop.ts';

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

  it('waits twice as long for each further re-read of a still screen, up to the cap', () => {
    // Arrange: a change read at t=0, then the screen holds still.
    let state: LoopState = finished(decide(INITIAL_LOOP, sig, true, 0).state);
    const reads: number[] = [];
    // Act: tick every 100ms for a minute.
    for (let t = 100; t <= 60_000; t += 100) {
      const step = decide(state, sig, false, t);
      state = step.decision === 'read' ? finished(step.state) : step.state;
      if (step.decision === 'read') reads.push(t);
    }
    // Assert: 2s, then 4, 8, 16, 16, 16 … after the previous re-read.
    expect(reads).toEqual([2000, 6000, 14_000, 30_000, 46_000]);
    expect(state.refreshGap).toBe(REFRESH_MAX_MS);
  });

  it('starts the re-reads over after a change', () => {
    // Arrange: two re-reads have stretched the gap to 8s.
    let state: LoopState = finished(decide(INITIAL_LOOP, sig, true, 0).state);
    state = finished(decide(state, sig, false, 2000).state);
    state = finished(decide(state, sig, false, 6000).state);
    expect(state.refreshGap).toBe(8000);
    // Act
    state = finished(decide(state, sig, true, 7000).state);
    // Assert
    expect(state.refreshGap).toBe(REFRESH_MS);
    expect(decide(state, sig, false, 7000 + REFRESH_MS).decision).toBe('read');
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

describe('the popup burst (M136)', () => {
  const POPUP = { popup: true, partial: false };
  const NOTHING = { popup: false, partial: true };

  it('reads popups only for a while after a popup, then in full again', () => {
    // Arrange: a full read at t=0 found a popup and finished at t=200.
    const after = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 200, ...POPUP });
    // Act
    const inside = decide(after, sig, true, 200 + POPUP_BURST_MS - 1);
    const outside = decide(after, sig, true, 200 + POPUP_BURST_MS);
    // Assert
    expect(inside).toMatchObject({ decision: 'read', mode: 'popup' });
    expect(outside).toMatchObject({ decision: 'read', mode: 'full' });
  });

  it('extends the burst with each popup found', () => {
    // Arrange: a popup at 200, another read by a popup read at 2000.
    let state = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 200, ...POPUP });
    state = finished(decide(state, sig, true, 1900).state, { at: 2000, ...POPUP });
    // Act
    const step = decide(state, sig, true, 200 + POPUP_BURST_MS + 100);
    // Assert
    expect(step.mode).toBe('popup');
  });

  it('owes a full read after the burst when a popup read found none, even before a refresh is due', () => {
    // Arrange: popup at 0–200 (burst to 3200); the screen after it read at 3000 by a popup read.
    let state = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 200, ...POPUP });
    state = finished(decide(state, sig, true, 3000).state, { at: 3060, ...NOTHING });
    // Act: the screen holds still to the end of the burst and past it.
    const during = decide(state, sig, false, 3100);
    const end = decide(state, sig, false, 200 + POPUP_BURST_MS);
    // Assert: the first tick after the burst reads in full though 2 s have not passed, and the debt
    // is paid.
    expect(during.decision).toBe('skip');
    expect(end).toMatchObject({ decision: 'read', mode: 'full' });
    expect(end.state.owed).toBe(false);
  });

  it('owes nothing when the last read of the burst was a popup', () => {
    let state = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 200, ...POPUP });
    state = finished(decide(state, sig, true, 500).state, { at: 560, ...NOTHING });
    const owing = state.owed;
    state = finished(decide(state, sig, true, 800).state, { at: 900, ...POPUP });
    expect(owing).toBe(true);
    expect(state.owed).toBe(false);
  });

  it('re-reads an unchanged screen once sooner during the burst — a popup caught mid-fade', () => {
    // Arrange: a popup read at 0–200; it stays on screen.
    const state = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 200, ...POPUP });
    // Act
    const early = decide(state, sig, false, BURST_REFRESH_MS - 1);
    const first = decide(state, sig, false, BURST_REFRESH_MS);
    const after = finished(first.state, { at: BURST_REFRESH_MS + 100, ...POPUP });
    const second = decide(after, sig, false, 2 * BURST_REFRESH_MS);
    // Assert: one quick re-read, then the usual doubling — not every half second.
    expect(early.decision).toBe('skip');
    expect(first).toMatchObject({ decision: 'read', mode: 'popup' });
    expect(second.decision).toBe('skip');
  });

  it('starts no burst without an outcome, as before M136', () => {
    const state = finished(decide(INITIAL_LOOP, sig, true, 0).state);
    expect(state).toMatchObject({ busy: false, burstUntil: -Infinity, owed: false });
  });
});

describe('tickDelay (M139)', () => {
  // A full read at t=0 found a popup and finished at t=200: the burst runs to 200 + POPUP_BURST_MS.
  const burst = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 200, popup: true, partial: false });

  it('ticks at the preset interval outside a burst', () => {
    // Act
    const delay = tickDelay(INITIAL_LOOP, 1000, READ_INTERVALS.balanced);
    // Assert
    expect(delay).toBe(READ_INTERVALS.balanced);
  });

  it('ticks every BURST_TICK_MS while the burst lasts, and not a moment longer', () => {
    // Act
    const inside = tickDelay(burst, 200 + POPUP_BURST_MS - 1, READ_INTERVALS.balanced);
    const atEnd = tickDelay(burst, 200 + POPUP_BURST_MS, READ_INTERVALS.balanced);
    // Assert
    expect(inside).toBe(BURST_TICK_MS);
    expect(atEnd).toBe(READ_INTERVALS.balanced);
  });

  it('never ticks slower in a burst than the preset asks', () => {
    // Act
    const fast = tickDelay(burst, 500, BURST_TICK_MS / 2);
    // Assert
    expect(fast).toBe(BURST_TICK_MS / 2);
  });
});
