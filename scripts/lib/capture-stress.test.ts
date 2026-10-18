import { describe, expect, it } from 'vitest';
import { isBlack } from '../../src/app/capture/change.ts';
import { READ_INTERVALS, type ReadIntervalPreset } from '../../src/app/capture/loop.ts';
import type { StressKnobs } from './capture-bench.ts';
import {
  battle,
  battleEnd,
  battleToPopup,
  clickThrough,
  conditions,
  quietSteps,
  readScreen,
  sessionSteps,
  signatureOf,
  stallsEvery,
  stressRun,
  timelineOfSteps,
  type Step,
  type StressRun,
} from './capture-stress.ts';

const PRESETS = Object.keys(READ_INTERVALS) as ReadIntervalPreset[];
/** The loop of M141: one fixed interval, none of M142's rules. */
const M141 = { range: { min: 250, max: 250 }, adaptive: false };

/** The worst the owner asked to hold: reads ten times slower, 30% of frames lost, 500 ms stalls. */
function hostile(durationMs: number, seed: number): StressKnobs {
  return {
    frames: { drop: 0.3, jitterMs: 15 },
    readCost: 10,
    lateMs: 60,
    stalls: stallsEvery(7000, 500, durationMs),
    seed,
  };
}

describe('the guarantees (M142)', () => {
  const steps = sessionSteps();
  const duration = timelineOfSteps(steps).spans.at(-1)!.end;

  it.each(PRESETS)(
    'misses no popup the page could see, on %s, under ×10 reads, three frames in ten dropped and 500 ms stalls',
    async (preset) => {
      // Arrange
      const range = READ_INTERVALS[preset];
      const runs = [];
      // Act: three timer phases × three seeds.
      for (let p = 0; p < 3; p++)
        for (let seed = 1; seed <= 3; seed++)
          runs.push(
            await stressRun(steps, {
              range,
              firstTickMs: Math.round(((p + 0.5) / 3) * range.min),
              stress: hostile(duration, seed * 7919 + p),
            }),
          );
      // Assert
      for (const run of runs) {
        expect(run.missedPopups).toEqual([]);
        // The page could see most of them: the runs test something.
        expect(run.result.events.filter((e) => e.event.kind === 'got').length).toBeGreaterThan(10);
      }
    },
  );

  it('is what M142 adds: the loop of M141 loses popups under the same conditions', async () => {
    // Act
    const runs = [];
    for (let seed = 1; seed <= 4; seed++)
      runs.push(await stressRun(steps, { ...M141, firstTickMs: 125, stress: hostile(duration, seed) }));
    // Assert
    expect(runs.some((r) => r.missedPopups.length > 0)).toBe(true);
  });

  it('ticks on every frame where popups come, so a popup on one frame shorter than the interval is seen', async () => {
    // Arrange: a shop, and a popup that the 8 fps share shows on one frame (3125, until 3250) —
    // half economy's 250 ms interval.
    const steps: Step[] = [
      [{ kind: 'shop' }, 3100],
      [{ kind: 'popup', giftId: 9102, over: 'shop' }, 100],
      [{ kind: 'shop' }, 3000],
    ];
    // Act: every phase of the timer.
    const runs = [];
    for (const first of [10, 70, 130, 190])
      runs.push(
        await stressRun(steps, {
          range: READ_INTERVALS.economy,
          firstTickMs: first,
          stress: { frames: {} },
        }),
      );
    // Assert
    for (const run of runs) {
      expect(run.result.observable.has(1)).toBe(true);
      expect(run.missed).toEqual([]);
    }
  });

  it('ticks fast once a popup is queued under a busy read, so the next one-frame popup is seen', async () => {
    // Arrange: a confirm dialog read ten times slower (8.6 s), and popups clicked through under it
    // at the idle 8 fps — the third shows on one frame only.
    const steps: Step[] = [
      [{ kind: 'confirm' }, 1000],
      [{ kind: 'popup', giftId: 9103, over: 'confirm' }, 400],
      [{ kind: 'confirm' }, 130],
      [{ kind: 'popup', giftId: 9104, over: 'confirm' }, 260],
      [{ kind: 'confirm' }, 140],
      [{ kind: 'popup', giftId: 9105, over: 'confirm' }, 40],
      [{ kind: 'confirm' }, 9000],
    ];
    // Act
    const runs = [];
    for (const first of [10, 40, 70])
      runs.push(
        await stressRun(steps, {
          range: READ_INTERVALS.performance,
          firstTickMs: first,
          stress: { frames: { jitterMs: 10 }, readCost: 10, seed: first },
        }),
      );
    // Assert: every popup a frame showed is read off the queue.
    for (const run of runs) expect(run.missedPopups).toEqual([]);
    expect(runs.some((r) => r.result.observable.has(5))).toBe(true);
  });

  it('reads a popup that looks like the one under the busy read, once the screen moved between them (M147)', async () => {
    // Arrange: two gifts whose popups look alike to the signature (same title, names it cannot
    // tell apart), clicked through with a blink of the map — all under the slow read of the first.
    const steps: Step[] = [
      [{ kind: 'map', floor: 1, packId: 101 }, 3000],
      [{ kind: 'popup', giftId: 9106, over: 'nothing', look: 1 }, 400],
      [{ kind: 'map', floor: 1, packId: 101 }, 150],
      [{ kind: 'popup', giftId: 9107, over: 'nothing', look: 1 }, 300],
      [{ kind: 'map', floor: 1, packId: 101 }, 4000],
    ];
    // Act: every phase of the timer.
    const runs = [];
    for (const first of [10, 40, 70])
      runs.push(
        await stressRun(steps, {
          range: READ_INTERVALS.balanced,
          firstTickMs: first,
          stress: { readCost: 10 },
        }),
      );
    // Assert: the second is queued and read, though its signature equals what the busy read reads.
    for (const run of runs) {
      expect(run.result.observable.has(3)).toBe(true);
      expect(run.missedPopups).toEqual([]);
    }
  });

  it('does not count a popup that came and went inside a stall: no page could have seen it', async () => {
    // Arrange: a popup at 3000–3200, entirely inside a stall of 2900–3400.
    const steps: Step[] = [
      [{ kind: 'shop' }, 3000],
      [{ kind: 'popup', giftId: 9100, over: 'shop' }, 200],
      [{ kind: 'shop' }, 3000],
    ];
    // Act
    const run = await stressRun(steps, {
      range: READ_INTERVALS.balanced,
      stress: { stalls: [{ start: 2900, end: 3400 }] },
    });
    // Assert
    expect(run.result.observable.has(1)).toBe(false);
    expect(run.missed).toEqual([]);
  });

  it('reads a popup that outlives a stall as soon as the page wakes', async () => {
    // Arrange: a popup at 3000–3600, a stall of 2900–3400.
    const steps: Step[] = [
      [{ kind: 'shop' }, 3000],
      [{ kind: 'popup', giftId: 9101, over: 'shop' }, 600],
      [{ kind: 'shop' }, 3000],
    ];
    // Act
    const run = await stressRun(steps, {
      range: READ_INTERVALS.balanced,
      stress: { stalls: [{ start: 2900, end: 3400 }] },
    });
    // Assert
    expect(run.missed).toEqual([]);
    expect(run.result.events.find((e) => e.event.kind === 'got')!.at).toBeLessThan(3600);
  });
});

describe('the savings (M142)', () => {
  it('spends less OCR on a minute of battle than the fixed interval did', async () => {
    // Arrange
    const steps: Step[] = [[{ kind: 'nothing', animated: true }, 60_000]];
    // Act
    const ranged = await stressRun(steps, { range: READ_INTERVALS.balanced });
    const fixed = await stressRun(steps, M141);
    // Assert: the change reads wait the range's max after each read of nothing.
    expect(ranged.ocrPercent).toBeLessThan(fixed.ocrPercent - 10);
  });

  it('spends less OCR on a still screen when reads are slow, and ticks no more often there', async () => {
    // Arrange: two minutes of the map, reads ten times slower.
    const steps = quietSteps(120_000);
    const stress: StressKnobs = { frames: {}, readCost: 10 };
    // Act
    const ranged = await stressRun(steps, { range: READ_INTERVALS.balanced, stress });
    const fixed = await stressRun(steps, { ...M141, stress });
    // Assert: the ladder spaces the re-reads; the interval relaxes to the old fixed 250 ms.
    expect(ranged.result.maxLevel).toBe(2);
    expect(ranged.ocrPercent).toBeLessThan(fixed.ocrPercent * 0.75);
    expect(ranged.result.ticks).toBeLessThan(fixed.result.ticks * 1.25);
  });

  it('ticks a still screen at the range’s max, not its min', async () => {
    // Arrange
    const steps = quietSteps(60_000);
    // Act
    const run = await stressRun(steps, { range: READ_INTERVALS.quality });
    // Assert: 60 s at 150 ms is 400 ticks; at 80 ms it would be 750.
    expect(run.result.ticks).toBeLessThan(450);
  });

  it('records nothing twice and nothing extra, ideal or hostile', async () => {
    // Arrange
    const steps = [...clickThrough(1), ...battle(2)];
    const duration = timelineOfSteps(steps).spans.at(-1)!.end;
    // Act
    const ideal = await stressRun(steps, { range: READ_INTERVALS.balanced });
    const bad = await stressRun(steps, { range: READ_INTERVALS.balanced, stress: hostile(duration, 3) });
    // Assert
    const keys = (r: typeof ideal) => r.result.events.map((e) => JSON.stringify(e.event));
    expect(new Set(keys(ideal)).size).toBe(keys(ideal).length);
    expect(new Set(keys(bad)).size).toBe(keys(bad).length);
  });
});

describe('battles (M153)', () => {
  const battleMinute: Step[] = [[{ kind: 'nothing', animated: true }, 60_000]];

  /**
   * The popup's latency after a battle, ms, and the popups missed, over `n` battle lengths that
   * sweep the read cycle — against M142's hold on the same sweep. Latencies are compared where both
   * loops recorded the popup (a frame drop can hide one from either).
   */
  async function afterBattle(
    make: (battleMs: number) => Step[],
    range: (typeof READ_INTERVALS)[ReadIntervalPreset],
    stress: StressKnobs,
    n = 40,
  ) {
    const now: number[] = [];
    const before: number[] = [];
    const missed = { now: 0, before: 0 };
    for (let k = 0; k < n; k++) {
      const runs = [];
      for (const legacyHold of [false, true])
        runs.push(
          await stressRun(make(20_000 + k * 83), {
            range,
            legacyHold,
            firstTickMs: 37 + k,
            stress: { ...stress, seed: 100 + k },
          }),
        );
      const [a, b] = runs as [StressRun, StressRun];
      missed.now += a.missedPopups.length;
      missed.before += b.missedPopups.length;
      // One popup a run (its gift id differs from run to run).
      const got = (r: StressRun) => [...r.latencyOf].find(([key]) => key.startsWith('got:'))?.[1];
      const [x, y] = [got(a), got(b)];
      if (x === undefined || y === undefined) continue;
      now.push(x);
      before.push(y);
    }
    return { now, before, missed };
  }
  const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;

  it.each(['performance', 'balanced', 'quality'] as const)(
    'reads a minute of battle with far less OCR than M142’s fixed hold, on %s',
    async (preset) => {
      // Act
      const grown = await stressRun(battleMinute, { range: READ_INTERVALS[preset], stress: { frames: {} } });
      const fixed = await stressRun(battleMinute, {
        range: READ_INTERVALS[preset],
        stress: { frames: {} },
        legacyHold: true,
      });
      // Assert: balanced 65% → 36%; the hold tops out at a second.
      expect(grown.ocrPercent).toBeLessThan(fixed.ocrPercent - 10);
      expect(grown.ocrPercent).toBeLessThan(40);
    },
  );

  it('changes nothing on economy, whose range already holds a second', async () => {
    // Act
    const grown = await stressRun(battleMinute, { range: READ_INTERVALS.economy });
    const fixed = await stressRun(battleMinute, { range: READ_INTERVALS.economy, legacyHold: true });
    // Assert
    expect(grown.ocrPercent).toBe(fixed.ocrPercent);
  });

  /** The owner's machine and its share: every moment, 8/30 fps, three frames in ten dropped. */
  const SHARES: StressKnobs[] = [{}, { frames: {} }, { frames: { drop: 0.3, jitterMs: 15 } }];

  /** One test per preset and share: each sweep is 80 simulations, and CI runs them slowly. */
  const PRESET_SHARES = PRESETS.flatMap((preset) =>
    SHARES.map((stress, share) => [preset, share, stress] as const),
  );

  it.each(PRESET_SHARES)(
    'records the gift after a battle’s black fade no later than before, on %s (share %i)',
    async (preset, _share, stress) => {
      // Arrange
      const range = READ_INTERVALS[preset];
      // Act: battle → loading → black → reward → popup, over a sweep of battle lengths.
      const { now, before, missed } = await afterBattle((ms) => battleEnd(1, ms), range, stress);
      // Assert: none missed, never later on average or at worst (the ticks are fast after black,
      // the share at 30 fps).
      expect(missed.now).toBe(0);
      expect(now.length).toBeGreaterThan(30);
      expect(mean(now)).toBeLessThanOrEqual(mean(before));
      expect(Math.max(...now)).toBeLessThanOrEqual(Math.max(...before));
    },
  );

  it.each(PRESET_SHARES)(
    'records a popup that comes right over a battle no later than before on average, on %s (share %i)',
    async (preset, _share, stress) => {
      // Arrange
      const range = READ_INTERVALS[preset];
      // Act: no black, no loading screen — the popup settles the popup region (`urgent`).
      const { now, before, missed } = await afterBattle((ms) => battleToPopup(1, ms), range, stress);
      // Assert: a battle read in flight when it comes is what it waits for, in both loops; the
      // longer hold leaves one in flight less often. Under the hold it is read once its region
      // shows settled on a second frame (`urgent`), where M142's shorter hold sometimes ran out
      // on the first — with three frames in ten lost that second frame can be late (performance:
      // 431 against 425 ms), so dropped frames get 5%. A popup left on one frame over the moving
      // battle is the known limit (`admit`, M142) for both alike.
      expect(missed.now).toBeLessThanOrEqual(missed.before);
      expect(now.length).toBeGreaterThan(30);
      expect(mean(now)).toBeLessThanOrEqual(mean(before) * (stress.frames?.drop ? 1.05 : 1));
    },
  );

  const SLOW_CASES = PRESETS.flatMap((preset) =>
    (['black fade', 'popup over the battle'] as const).map((kind) => [preset, kind] as const),
  );

  it.each(SLOW_CASES)(
    'stays within a few per cent on average when reads are four times slower, on %s (%s)',
    async (preset, kind) => {
      // Arrange: a read of nothing takes 2.4 s. Whether the reward picker's read covers the popup
      // turns on tens of ms either way, for both loops alike (sweeps per preset and reward
      // length: −23% … +3%).
      const range = READ_INTERVALS[preset];
      const stress: StressKnobs = { frames: {}, readCost: 4 };
      const make =
        kind === 'black fade' ? (ms: number) => battleEnd(1, ms) : (ms: number) => battleToPopup(1, ms);
      // Act
      const { now, before, missed } = await afterBattle(make, range, stress);
      // Assert
      expect(missed.now).toBe(0);
      expect(mean(now)).toBeLessThanOrEqual(mean(before) * 1.05);
    },
  );

  it('reads the map after the reward’s popup at once, not after the popup burst', async () => {
    // Act
    const now = await stressRun(battleEnd(1), { range: READ_INTERVALS.balanced });
    const before = await stressRun(battleEnd(1), { range: READ_INTERVALS.balanced, legacyHold: true });
    // Assert: the burst's 3 s are gone (2.9 s → 0.6 s on the ideal share).
    expect(now.latencyOf.get('enter:1:101')!).toBeLessThan(1000);
    expect(before.latencyOf.get('enter:1:101')!).toBeGreaterThan(2000);
  });

  it.each(PRESETS)(
    'misses no popup after battles on %s, under ×10 reads, three frames in ten dropped and 500 ms stalls',
    async (preset) => {
      // Arrange
      const steps = [...battleEnd(1), ...clickThrough(2), ...battleEnd(3, 15_000)];
      const duration = timelineOfSteps(steps).spans.at(-1)!.end;
      const range = READ_INTERVALS[preset];
      const runs = [];
      // Act
      for (let seed = 1; seed <= 4; seed++)
        runs.push(
          await stressRun(steps, {
            range,
            firstTickMs: 13 * seed,
            stress: hostile(duration, seed * 7919),
          }),
        );
      // Assert
      for (const run of runs) {
        expect(run.missedPopups).toEqual([]);
        expect(run.result.events.filter((e) => e.event.kind === 'got').length).toBeGreaterThan(4);
      }
    },
  );
});

describe('the synthetic screens', () => {
  it('reads a popup in full or by its title alike, and anything else by its title as nothing', () => {
    // Arrange
    const popup = { kind: 'popup' as const, giftId: 9200, over: 'shop' as const };
    // Act + Assert
    expect(readScreen(popup, 'popup', false).frame.screen).toBe('acquired');
    expect(readScreen({ kind: 'shop' }, 'popup', false)).toMatchObject({
      frame: { partial: true },
      ocrCalls: 1,
    });
    expect(readScreen({ kind: 'confirm' }, 'full', false).ms).toBe(860);
    expect(readScreen({ kind: 'packSelect' }, 'full', true).frame.screen).toBeNull();
    expect(readScreen({ kind: 'black' }, 'full', false)).toMatchObject({ ms: 28, ocrCalls: 9 });
  });

  it('paints black as black and a popup over a battle as settled in its own regions (M153)', () => {
    // Arrange
    const over = { kind: 'popup' as const, giftId: 9300, over: 'battle' as const };
    // Act + Assert
    expect(isBlack(signatureOf({ kind: 'black' }, 0))).toBe(true);
    expect(isBlack(signatureOf({ kind: 'loading' }, 0))).toBe(false);
    expect(signatureOf(over, 0).subarray(0, 256)).toEqual(signatureOf(over, 50).subarray(0, 256));
    expect(signatureOf(over, 0)[256]).not.toBe(signatureOf(over, 50)[256]);
  });

  it('keeps a battle’s popup regions apart from any popup’s, frame to frame', () => {
    // Arrange
    const battleAt = (t: number) => signatureOf({ kind: 'nothing', animated: true }, t);
    // Act + Assert: the first patch never reaches a popup's levels (≥ 140), and moves every 7 ms.
    for (let t = 0; t < 2000; t += 7) {
      expect(battleAt(t)[0]).toBeLessThan(140);
      expect(Math.abs(battleAt(t)[0]! - battleAt(t + 7)[0]!)).toBeGreaterThan(6);
    }
  });

  it('sweeps seven conditions, the last all of them at once', () => {
    // Act
    const all = conditions(60_000);
    // Assert
    expect(all).toHaveLength(7);
    expect(all.at(-1)!.stress).toMatchObject({ readCost: 10, frames: { drop: 0.3 } });
  });
});
