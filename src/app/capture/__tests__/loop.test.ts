import { describe, expect, it } from 'vitest';
import {
  afterTransition,
  BURST_REFRESH_MS,
  BURST_TICK_MS,
  decide,
  fastTicks,
  finished,
  HOLD_MAX_MS,
  inBurst,
  holdFor,
  INITIAL_LOOP,
  outcomeOf,
  POPUP_BURST_MS,
  QUEUED_FAST_MS,
  queuedPopup,
  READ_INTERVALS,
  REFRESH_MAX_MS,
  REFRESH_MS,
  tickDelay,
  TRANSITION_TICKS_MS,
  type LoopState,
} from '../loop.ts';
import { refreshFor } from '../pace.ts';

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
  it('offers the four presets from slowest to fastest, each a range (M142)', () => {
    // Act
    const ranges = Object.values(READ_INTERVALS);
    // Assert
    expect(ranges.map((r) => r.min)).toEqual([250, 150, 100, 80]);
    expect(ranges.map((r) => r.max)).toEqual([1000, 500, 250, 150]);
    for (const r of ranges) expect(r.min).toBeLessThan(r.max);
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
    const delay = tickDelay(INITIAL_LOOP, 1000, READ_INTERVALS.balanced.max);
    // Assert
    expect(delay).toBe(READ_INTERVALS.balanced.max);
  });

  it('ticks every BURST_TICK_MS while the burst lasts, and not a moment longer', () => {
    // Act
    const inside = tickDelay(burst, 200 + POPUP_BURST_MS - 1, READ_INTERVALS.balanced.max);
    const atEnd = tickDelay(burst, 200 + POPUP_BURST_MS, READ_INTERVALS.balanced.max);
    // Assert
    expect(inside).toBe(BURST_TICK_MS);
    expect(atEnd).toBe(READ_INTERVALS.balanced.max);
  });

  it('never ticks slower in a burst than the preset asks', () => {
    // Act
    const fast = tickDelay(burst, 500, BURST_TICK_MS / 2);
    // Assert
    expect(fast).toBe(BURST_TICK_MS / 2);
  });
});

describe('a map read short of its floor or pack (M148)', () => {
  it('brings the next re-read of the unchanged screen in to BURST_REFRESH_MS, then doubles', () => {
    // Arrange: a read of a changed frame, which saw the map but not the pack.
    expect(BURST_REFRESH_MS).toBe(500);
    let state = decide(INITIAL_LOOP, sig, true, 0).state;
    state = finished(state, { at: 300, popup: false, partial: false, incomplete: true });
    // Act / Assert: nothing before 500 ms, a read at 500 ms, the next one a second later.
    expect(decide(state, sig, false, 400).decision).toBe('skip');
    const second = decide(state, sig, false, 500);
    expect(second.decision).toBe('read');
    state = finished(second.state, { at: 600, popup: false, partial: false });
    expect(decide(state, sig, false, 1400).decision).toBe('skip');
    expect(decide(state, sig, false, 1500).decision).toBe('read');
  });

  it('counts a map read without a sure floor and pack as incomplete, and only that', () => {
    const map = { screen: 'exploring' as const, partial: undefined };
    expect(outcomeOf({ ...map, floor: 3, pack: { status: 'none' } }, 1).incomplete).toBe(true);
    expect(
      outcomeOf({ ...map, floor: null, pack: { status: 'match', id: 1, score: 1, margin: 1 } }, 1).incomplete,
    ).toBe(true);
    expect(
      outcomeOf({ ...map, floor: 3, pack: { status: 'match', id: 1, score: 1, margin: 1 } }, 1).incomplete,
    ).toBe(false);
    expect(outcomeOf({ screen: 'shop', floor: null, pack: null }, 1).incomplete).toBe(false);
  });
});

describe('decide with a load level’s re-reads (M142)', () => {
  it('keeps the first re-read at 2 s and spaces the later ones by the policy', () => {
    // Arrange: a change read at t=0, then the screen holds still; level 1's policy.
    const policy = refreshFor(1);
    let state: LoopState = finished(decide(INITIAL_LOOP, sig, true, 0, policy).state);
    const reads: number[] = [];
    // Act: tick every 100 ms for three minutes.
    for (let t = 100; t <= 180_000; t += 100) {
      const step = decide(state, sig, false, t, policy);
      state = step.decision === 'read' ? finished(step.state) : step.state;
      if (step.decision === 'read') reads.push(t);
    }
    // Assert: 2 s, then 8, 32, 64, 64 … after the previous re-read.
    expect(reads.slice(0, 5)).toEqual([2000, 10_000, 42_000, 106_000, 170_000]);
  });
});

describe('the hold on a moving screen of nothing (M142)', () => {
  const NOTHING_READ = { popup: false, partial: false, nothing: true, holdMs: 250 };
  /** A full read at 0 under which the screen moved, done at 600. */
  function heldAt600(): LoopState {
    let state = decide(INITIAL_LOOP, sig, true, 0).state;
    state = decide(state, sig, true, 300).state; // dirty while busy
    return finished(state, { at: 600, ...NOTHING_READ });
  }

  it('waits holdMs after a read of nothing the screen moved under, then reads the change', () => {
    // Arrange
    const held = heldAt600();
    // Act + Assert
    expect(held.holdUntil).toBe(850);
    expect(decide(held, sig, true, 849).decision).toBe('skip');
    expect(decide(held, sig, true, 850).decision).toBe('read');
  });

  it('holds nothing when the screen held still under the read, or the read named a screen', () => {
    // Arrange
    const still = finished(decide(INITIAL_LOOP, sig, true, 0).state, { at: 600, ...NOTHING_READ });
    let busy = decide(INITIAL_LOOP, sig, true, 0).state;
    busy = decide(busy, sig, true, 300).state;
    const named = finished(busy, { at: 600, ...NOTHING_READ, nothing: false });
    // Act + Assert
    expect(still.holdUntil).toBe(-Infinity);
    expect(named.holdUntil).toBe(-Infinity);
    expect(decide(named, sig, true, 601).decision).toBe('read');
  });

  it('lets a settled popup region through at once (`urgent`)', () => {
    // Act
    const step = decide(heldAt600(), sig, true, 700, undefined, true);
    // Assert
    expect(step.decision).toBe('read');
  });

  it('counts the hold from the last queued popup read that follows the read', () => {
    // Arrange: the queue is drained after the read; its popup reads find nothing.
    const held = { ...heldAt600(), busy: true };
    // Act
    const after = finished(held, { at: 800, popup: false, partial: true, holdMs: 250 });
    // Assert
    expect(after.holdUntil).toBe(1050);
  });

  it('never holds back the full read a burst owes', () => {
    // Arrange
    const owed: LoopState = { ...heldAt600(), owed: true };
    // Act + Assert
    expect(decide(owed, sig, false, 700).decision).toBe('read');
  });
});

describe('the growing hold and black frames (M153)', () => {
  const moved = new Uint8Array([9, 9, 9]);
  /** A full read of nothing at `start`, the screen moving under it, done `ms` later. */
  function battleRead(state: LoopState, start: number, ms = 300, holdMaxMs?: number): LoopState {
    let s = decide(state, sig, true, start).state;
    s = decide(s, moved, true, start + ms / 2).state;
    return finished(s, outcomeOf({ screen: null, floor: null, pack: null }, start + ms, 250, holdMaxMs));
  }

  it('grows the hold with each read of nothing in a row, 250 → 500 → 1000, and no further', () => {
    // Arrange / Act: four battle reads back to back, each as soon as the hold lets it.
    let s = INITIAL_LOOP;
    const holds: number[] = [];
    let at = 0;
    for (let i = 0; i < 4; i++) {
      s = battleRead(s, at);
      holds.push(s.holdUntil - (at + 300));
      at = s.holdUntil;
    }
    // Assert
    expect(holds).toEqual([250, 500, HOLD_MAX_MS, HOLD_MAX_MS]);
    expect(s.holdStreak).toBe(4);
  });

  it('keeps M142’s fixed hold when the outcome caps it at its own length', () => {
    // Act
    const s = battleRead(battleRead(INITIAL_LOOP, 0, 300, 250), 550, 300, 250);
    // Assert
    expect(s.holdUntil).toBe(850 + 250);
  });

  it('holds economy at its own range max, never less', () => {
    // Act / Assert
    expect(holdFor(1000, 1)).toBe(1000);
    expect(holdFor(1000, 5)).toBe(1000);
    expect(holdFor(250, 0)).toBe(0);
    expect(holdFor(150, 4)).toBe(1000);
  });

  it('lets the grown hold go when a read names something, and on a still screen keeps its count', () => {
    // Arrange: three battle reads in a row.
    let s = INITIAL_LOOP;
    for (const at of [0, 550, 1350]) s = battleRead(s, at);
    // Act
    const named = finished(decide(s, sig, true, 3000, undefined, true).state, {
      at: 3100,
      popup: true,
      partial: false,
      nothing: false,
      holdMs: 250,
    });
    const still = finished(decide(s, sig, true, 3000, undefined, true).state, {
      at: 3100,
      popup: false,
      partial: false,
      nothing: true,
      holdMs: 250,
    });
    // Assert: a pause in the battle keeps the count — the next moving read of nothing holds 1 s.
    expect(named).toMatchObject({ holdUntil: -Infinity, holdStreak: 0 });
    expect(still).toMatchObject({ holdUntil: -Infinity, holdStreak: 3 });
    expect(battleRead(still, 3200).holdUntil).toBe(3500 + HOLD_MAX_MS);
  });

  it('does not read a black frame, lets the hold go, and reads the next frame at once', () => {
    // Arrange: a battle read leaves a hold to 2650 (third in a row).
    let s = INITIAL_LOOP;
    for (const at of [0, 550, 1350]) s = battleRead(s, at);
    expect(s.holdUntil).toBe(2650);
    // Act: black at 1700, then the reward screen at 1800 — unchanged to the signature, no urgency.
    const black = decide(s, new Uint8Array(3), true, 1700, undefined, false, { black: true });
    const after = decide(black.state, sig, false, 1800);
    // Assert
    expect(black.decision).toBe('skip');
    expect(black.state).toMatchObject({ dark: true, holdUntil: -Infinity, holdStreak: 0, busy: false });
    expect(after.decision).toBe('read');
    expect(after.state.dark).toBe(false);
  });

  it('lets no hold follow a read that a black frame came under', () => {
    // Arrange: a read of a battle frame; the screen moves, then goes black, under it.
    let s = decide(INITIAL_LOOP, sig, true, 0).state;
    s = decide(s, moved, true, 100).state;
    s = decide(s, new Uint8Array(3), true, 200, undefined, false, { black: true }).state;
    // Act
    const done = finished(s, outcomeOf({ screen: null, floor: null, pack: null }, 300, 250));
    // Assert: no hold, and the next frame reads at once.
    expect(done).toMatchObject({ holdUntil: -Infinity, holdStreak: 0, dark: true });
    expect(decide(done, moved, false, 310).decision).toBe('read');
  });

  it('skips black frames in a row without reading them, and ticks fast for a while after', () => {
    // Arrange
    const black = new Uint8Array(3);
    const first = decide(INITIAL_LOOP, black, true, 0, undefined, false, { black: true });
    // Act
    const second = decide(first.state, black, true, 100, undefined, false, { black: true });
    // Assert
    expect(first.decision).toBe('skip');
    expect(second.decision).toBe('skip');
    expect(second.state).toMatchObject({ dark: true, blackAt: 100 });
    expect(afterTransition(second.state, 100 + TRANSITION_TICKS_MS - 1)).toBe(true);
    expect(afterTransition(second.state, 100 + TRANSITION_TICKS_MS)).toBe(false);
    expect(afterTransition(INITIAL_LOOP, 0)).toBe(false);
    expect(fastTicks(second.state, 100 + TRANSITION_TICKS_MS - 1)).toBe(true);
    expect(tickDelay(second.state, 200, 250)).toBe(BURST_TICK_MS);
    expect(decide(second.state, sig, true, 200).mode).toBe('full');
  });

  it('ends a popup burst on black, so the screen after it is read in full at once', () => {
    // Arrange: a popup read at 0 began a burst to 3000.
    const popupRead = finished(decide(INITIAL_LOOP, sig, true, 0).state, {
      at: 100,
      popup: true,
      partial: false,
    });
    expect(inBurst(popupRead, 1000)).toBe(true);
    // Act: black at 1000, the map at 1400.
    const black = decide(popupRead, new Uint8Array(3), true, 1000, undefined, false, { black: true });
    const map = decide(black.state, moved, true, 1400);
    // Assert
    expect(inBurst(black.state, 1001)).toBe(false);
    expect(map).toMatchObject({ decision: 'read', mode: 'full' });
  });

  it('reads a screen that held still for the hold’s base through a grown hold', () => {
    // Arrange: three battle reads in a row hold the next to 2650.
    let s = INITIAL_LOOP;
    for (const at of [0, 550, 1350]) s = battleRead(s, at);
    // Act + Assert: still for 249 ms it waits; for the base (250) it reads.
    expect(decide(s, sig, true, 1900, undefined, false, { stillMs: 249 }).decision).toBe('skip');
    expect(decide(s, sig, true, 1900, undefined, false, { stillMs: 250 }).decision).toBe('read');
  });

  it('still lets a settled popup region through a grown hold at once (`urgent`)', () => {
    // Arrange
    let s = INITIAL_LOOP;
    for (const at of [0, 550, 1350]) s = battleRead(s, at);
    // Act + Assert
    expect(decide(s, sig, true, 1700).decision).toBe('skip');
    expect(decide(s, sig, true, 1700, undefined, true).decision).toBe('read');
  });
});

describe('fast ticks after a queued popup (M142)', () => {
  it('ticks every BURST_TICK_MS for QUEUED_FAST_MS after a popup was queued, reads unchanged', () => {
    // Arrange
    const queued = queuedPopup(INITIAL_LOOP, 1000);
    // Act + Assert
    expect(fastTicks(queued, 1000 + QUEUED_FAST_MS - 1)).toBe(true);
    expect(fastTicks(queued, 1000 + QUEUED_FAST_MS)).toBe(false);
    expect(tickDelay(queued, 1500, 250)).toBe(BURST_TICK_MS);
    expect(decide(queued, sig, true, 1500).mode).toBe('full');
  });

  it('extends, never shortens, the fast window', () => {
    // Act
    const twice = queuedPopup(queuedPopup(INITIAL_LOOP, 1000), 500);
    // Assert
    expect(twice.fastUntil).toBe(1000 + QUEUED_FAST_MS);
  });
});
