import { describe, expect, it } from 'vitest';
import { READ_INTERVALS, type ReadIntervalPreset } from '../../src/app/capture/loop.ts';
import type { StressKnobs } from './capture-bench.ts';
import {
  battle,
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
