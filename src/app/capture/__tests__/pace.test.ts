import { describe, expect, it } from 'vitest';
import {
  BASE_REFRESH,
  followFrames,
  initialPace,
  leanReads,
  LOWER_HOLD_MS,
  MIN_LATENESS_SAMPLES,
  MIN_READ_SAMPLES,
  paceDrop,
  paceFrame,
  paceLateness,
  paceRead,
  paceStats,
  paceTick,
  percentileOf,
  popupProne,
  pressure,
  refreshFor,
  RELAX_STEP_MS,
  RELAX_STEP_STRAINED_MS,
  SAMPLE_MAX_AGE_MS,
  SAMPLE_WINDOW,
  STRAIN,
  withRange,
  type PaceState,
  type TickInput,
} from '../pace.ts';

const RANGE = { min: 100, max: 250 };
/** A tick of a still, read, unremarkable screen (the map). */
const still = (now: number): TickInput => ({
  now,
  changed: false,
  burst: false,
  unread: false,
  screen: 'exploring',
});

/** Tick a still screen every `every` ms from `from` to `to`. */
function holdStill(state: PaceState, from: number, to: number, every = 50): PaceState {
  let s = state;
  for (let t = from; t <= to; t += every) s = paceTick(s, still(t));
  return s;
}

/** `n` lateness samples of `ms`, one per 100 ms from `from`. */
function late(state: PaceState, from: number, n: number, ms: number): PaceState {
  let s = state;
  for (let i = 0; i < n; i++) s = paceLateness(s, from + i * 100, ms);
  return s;
}

describe('paceTick — the interval', () => {
  it('starts at the range’s min', () => {
    // Act
    const state = initialPace(RANGE);
    // Assert
    expect(state.interval).toBe(100);
    expect(state.level).toBe(0);
  });

  it('relaxes a still screen one step per second, up to the max and no further', () => {
    // Arrange
    const start = initialPace(RANGE, 0);
    // Act
    const justBefore = holdStill(start, 50, RELAX_STEP_MS - 50);
    const oneStep = paceTick(justBefore, still(RELAX_STEP_MS));
    const long = holdStill(oneStep, RELAX_STEP_MS + 50, 20_000);
    // Assert: 100 → 150 at 1 s, then 225, then capped at 250.
    expect(justBefore.interval).toBe(100);
    expect(oneStep.interval).toBe(150);
    expect(long.interval).toBe(250);
  });

  it.each([
    ['a change since the last tick', { changed: true }],
    ['fast ticks (a burst, a popup queued)', { burst: true }],
    ['a screen not read since it changed', { unread: true }],
    ['a screen where popups come', { screen: 'purchase' as const }],
  ])('pulls the interval to min at once on %s', (_name, override) => {
    // Arrange: relaxed to the max.
    const relaxed = holdStill(initialPace(RANGE, 0), 50, 10_000);
    // Act
    const next = paceTick(relaxed, { ...still(10_050), ...override });
    // Assert
    expect(relaxed.interval).toBe(250);
    expect(next.interval).toBe(100);
  });

  it('starts the second of stillness over after a change, so it cannot oscillate faster', () => {
    // Arrange: 900 ms still, then a change.
    let s = holdStill(initialPace(RANGE, 0), 50, 900);
    s = paceTick(s, { ...still(950), changed: true });
    // Act: 999 ms still after the change, then one more tick.
    const before = holdStill(s, 1000, 1949);
    const after = paceTick(before, still(1950));
    // Assert
    expect(before.interval).toBe(100);
    expect(after.interval).toBe(150);
  });

  it('relaxes twice as fast under load, still only inside the range', () => {
    // Arrange: level 1 from late timers.
    const strained = late(initialPace(RANGE, 0), 0, MIN_LATENESS_SAMPLES, STRAIN.lateness.level1);
    const moved = paceTick(strained, { ...still(1000), changed: true });
    // Act
    const before = holdStill(moved, 1050, 1000 + RELAX_STEP_STRAINED_MS - 50);
    const step = paceTick(before, still(1000 + RELAX_STEP_STRAINED_MS));
    const long = holdStill(step, 1600, 10_000);
    // Assert
    expect(strained.level).toBe(1);
    expect(before.interval).toBe(100);
    expect(step.interval).toBe(150);
    expect(long.interval).toBe(250);
  });

  it('follows the frames only at the range’s min', () => {
    // Arrange
    const relaxed = holdStill(initialPace(RANGE, 0), 50, 5000);
    // Act + Assert
    expect(followFrames(initialPace(RANGE))).toBe(true);
    expect(followFrames(relaxed)).toBe(false);
  });

  it('starts a new preset at its min, keeping the measures', () => {
    // Arrange
    const relaxed = paceRead(holdStill(initialPace(RANGE, 0), 50, 5000), 5000, 'full', 600);
    // Act
    const next = withRange(relaxed, { min: 250, max: 1000 }, 5100);
    // Assert
    expect(next.interval).toBe(250);
    expect(next.fullReads).toHaveLength(1);
  });
});

describe('popupProne', () => {
  it('says popups come on a popup, a start picker and a screen inside a pack, not on the map', () => {
    expect(popupProne('acquired')).toBe(true);
    expect(popupProne('observationSelect')).toBe(true);
    expect(popupProne('fusion')).toBe(true);
    expect(popupProne('exploring')).toBe(false);
    expect(popupProne('packSelect')).toBe(false);
    expect(popupProne(null)).toBe(false);
  });
});

describe('the load level', () => {
  it('stays at 0 on a healthy machine', () => {
    // Act
    let s = late(initialPace(RANGE, 0), 0, 20, 3);
    for (let i = 0; i < 5; i++) s = paceRead(s, 3000 + i * 700, 'full', 600);
    for (let i = 0; i < 5; i++) s = paceRead(s, 7000 + i * 100, 'popup', 34);
    // Assert
    expect(s.level).toBe(0);
  });

  it('raises nothing on one 500 ms lag spike among thirty ticks', () => {
    // Arrange
    let s = late(initialPace(RANGE, 0), 0, 29, 3);
    // Act
    s = paceLateness(s, 3000, 500);
    // Assert
    expect(s.level).toBe(0);
  });

  it('raises to 1 when the p90 lateness reaches its threshold, and not a ms below', () => {
    // Act
    const below = late(initialPace(RANGE, 0), 0, 10, STRAIN.lateness.level1 - 1);
    const at = late(initialPace(RANGE, 0), 0, 10, STRAIN.lateness.level1);
    // Assert
    expect(below.level).toBe(0);
    expect(at.level).toBe(1);
  });

  it('needs enough samples before lateness says anything', () => {
    // Act
    const few = late(initialPace(RANGE, 0), 0, MIN_LATENESS_SAMPLES - 1, 1000);
    // Assert
    expect(few.level).toBe(0);
  });

  it('holds lateness against the range: a slow preset tolerates later ticks', () => {
    // Arrange: 100 ms late — half of economy's 250 ms min is 125.
    const slow = initialPace({ min: 250, max: 1000 }, 0);
    // Act
    const s = late(slow, 0, 10, 100);
    // Assert
    expect(s.level).toBe(0);
    expect(late(slow, 0, 10, 125).level).toBe(1);
  });

  it('raises to 2 on slow reads, full and popup apart', () => {
    // Act
    let full = initialPace(RANGE, 0);
    for (let i = 0; i < MIN_READ_SAMPLES; i++)
      full = paceRead(full, i * 4000, 'full', STRAIN.fullRead.level2);
    let popup = initialPace(RANGE, 0);
    for (let i = 0; i < MIN_READ_SAMPLES; i++)
      popup = paceRead(popup, i * 400, 'popup', STRAIN.popupRead.level1);
    // Assert: full reads at level 2's threshold, popup reads at level 1's.
    expect(full.level).toBe(2);
    expect(popup.level).toBe(1);
  });

  it('raises to at least 1 when the backlog overflows, and lets go once that is old', () => {
    // Arrange
    const dropped = paceDrop(initialPace(RANGE, 0), 1000);
    // Act: calm ever after.
    const s = holdStill(dropped, 1050, 1000 + SAMPLE_MAX_AGE_MS + LOWER_HOLD_MS + 500, 250);
    // Assert
    expect(dropped.level).toBe(1);
    expect(dropped.drops).toBe(1);
    expect(s.level).toBe(0);
  });

  it('lowers one step at a time, each after LOWER_HOLD_MS of calm', () => {
    // Arrange: level 2 from three slow full reads; then fast reads only.
    let s = initialPace(RANGE, 0);
    for (let i = 0; i < 3; i++) s = paceRead(s, i * 4000, 'full', 4000);
    expect(s.level).toBe(2);
    // Act: the slow samples age out at 38 s; calm from then on.
    const t0 = 8000 + SAMPLE_MAX_AGE_MS + 1;
    s = paceTick(s, still(t0));
    const justBefore = holdStill(s, t0 + 250, t0 + LOWER_HOLD_MS - 1, 250);
    const one = paceTick(justBefore, still(t0 + LOWER_HOLD_MS));
    const two = holdStill(one, t0 + LOWER_HOLD_MS + 250, t0 + 2 * LOWER_HOLD_MS + 250, 250);
    // Assert
    expect(justBefore.level).toBe(2);
    expect(one.level).toBe(1);
    expect(two.level).toBe(0);
  });

  it('does not lower while a measure sits between half the threshold and the threshold', () => {
    // Arrange: level 1 from lateness, then lateness at 60% of the threshold, steadily.
    let s = late(initialPace(RANGE, 0), 0, 10, STRAIN.lateness.level1);
    // Act
    for (let t = 1000; t < 1000 + 3 * LOWER_HOLD_MS; t += 100)
      s = paceLateness(s, t, STRAIN.lateness.level1 * 0.6);
    // Assert
    expect(s.level).toBe(1);
  });

  it('raises at once from 0 to 2 when the measures call for it', () => {
    // Act
    const s = late(initialPace(RANGE, 0), 0, 10, STRAIN.lateness.level2);
    // Assert
    expect(pressure(s, 1000)).toBe(2);
    expect(s.level).toBe(2);
  });
});

describe('percentileOf', () => {
  it('is nearest-rank over the samples young enough, null below the minimum', () => {
    // Arrange
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v, i) => ({ t: i, v }));
    // Act + Assert
    expect(percentileOf(samples, 10, 50)).toBe(50);
    expect(percentileOf(samples, 10, 90)).toBe(90);
    expect(percentileOf(samples, 10, 90, 11)).toBeNull();
    expect(percentileOf(samples, 9 + SAMPLE_MAX_AGE_MS, 50)).toBe(100);
    expect(percentileOf([], 0, 50)).toBeNull();
  });

  it('keeps at most SAMPLE_WINDOW samples', () => {
    // Act
    const s = late(initialPace(RANGE, 0), 0, SAMPLE_WINDOW + 10, 5);
    // Assert
    expect(s.lateness).toHaveLength(SAMPLE_WINDOW);
  });
});

describe('the ladder', () => {
  it('cuts the later re-reads first, keeping the first at 2 s', () => {
    // Act
    const calm = refreshFor(0);
    const strained = refreshFor(1);
    // Assert
    expect(calm).toEqual(BASE_REFRESH);
    expect(strained.firstMs).toBe(BASE_REFRESH.firstMs);
    expect(strained.growth).toBeGreaterThan(calm.growth);
    expect(strained.maxMs).toBeGreaterThan(calm.maxMs);
    expect(refreshFor(2)).toEqual(strained);
  });

  it('cuts the unneeded raw pass at level 2 only', () => {
    expect([leanReads(0), leanReads(1), leanReads(2)]).toEqual([false, false, true]);
  });
});

describe('paceStats', () => {
  it('reports p50/p90 of each measure and the delivered frame rate', () => {
    // Arrange
    let s = late(initialPace(RANGE, 0), 0, 10, 4);
    s = paceRead(paceRead(s, 1000, 'full', 600), 2000, 'full', 800);
    s = paceRead(s, 2100, 'popup', 34);
    for (let i = 0; i < 5; i++) s = paceFrame(s, 2200 + i * 125, 125);
    // Act
    const stats = paceStats(s, 3000);
    // Assert
    expect(stats.lateness).toEqual({ p50: 4, p90: 4 });
    expect(stats.fullRead).toEqual({ p50: 600, p90: 800, n: 2 });
    expect(stats.popupRead).toEqual({ p50: 34, p90: 34, n: 1 });
    expect(stats.deliveredFps).toBe(8);
  });

  it('says nothing of what it never measured', () => {
    // Act
    const stats = paceStats(initialPace(RANGE, 0), 0);
    // Assert
    expect(stats).toEqual({ lateness: null, fullRead: null, popupRead: null, deliveredFps: null });
  });

  it('does not let the frame rate move the level', () => {
    // Act: a share that delivers one frame a second.
    let s = initialPace(RANGE, 0);
    for (let i = 0; i < 20; i++) s = paceFrame(s, i * 1000, 1000);
    // Assert
    expect(s.level).toBe(0);
  });
});
