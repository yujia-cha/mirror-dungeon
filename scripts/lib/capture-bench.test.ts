import { describe, expect, it } from 'vitest';
import { PATCH_H, PATCH_W } from '../../src/app/capture/change.ts';
import type { ReadMode } from '../../src/app/capture/loop.ts';
import type { Frame } from '../../src/app/capture/tracker.ts';
import {
  compareEvents,
  downscale,
  latencies,
  simulate,
  steamShotTime,
  timelineOf,
  type ShotRead,
  type Span,
} from './capture-bench.ts';

const NOTHING: Frame = { screen: null, floor: null, pack: null, gift: null };
const popup = (id: number): Frame => ({
  screen: 'acquired',
  floor: null,
  pack: null,
  gift: { status: 'match', id, score: 1, margin: 1 },
});

/** One grey patch per shot, far enough apart to count as a change. */
const signature = (shot: number) => new Uint8Array(PATCH_W * PATCH_H).fill((shot * 40) % 256);

function reader(frames: readonly Frame[], ms: number) {
  const reads: number[] = [];
  return {
    reads,
    read: async (shot: number): Promise<ShotRead> => {
      reads.push(shot);
      return { frame: frames[shot]!, ms, ocrCalls: 1 };
    },
  };
}

describe('timelineOf', () => {
  it('holds each shot until the next one, capped', () => {
    // Arrange
    const times = [0, 2000, 60_000];
    // Act
    const spans = timelineOf(times, { maxDwellMs: 10_000 });
    // Assert
    expect(spans).toEqual([
      { shot: 0, start: 0, end: 2000 },
      { shot: 1, start: 2000, end: 12_000 },
      { shot: 2, start: 12_000, end: 22_000 },
    ]);
  });

  it('gives every shot the same dwell when asked', () => {
    // Arrange / Act
    const spans = timelineOf([0, 5000], { dwellMs: 300, maxDwellMs: 10_000 });
    // Assert
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      [0, 300],
      [300, 600],
    ]);
  });

  it('is empty without shots', () => {
    expect(timelineOf([], { maxDwellMs: 1000 })).toEqual([]);
  });
});

describe('simulate', () => {
  const frames = [NOTHING, popup(9006), NOTHING, popup(9007)];

  it('records each popup once however many ticks see it', async () => {
    // Arrange
    const timeline = timelineOf([0, 1, 2, 3], { dwellMs: 2000, maxDwellMs: 0 });
    const r = reader(frames, 100);
    // Act
    const result = await simulate({ intervalMs: 250, timeline, signature, read: r.read });
    // Assert
    expect(result.events.map((e) => e.event)).toEqual([
      { kind: 'got', giftId: 9006 },
      { kind: 'got', giftId: 9007 },
    ]);
    // Reads on each change, plus the 2s refresh on a still screen — never once per tick.
    expect(result.ticks).toBe(31);
    expect(result.reads).toBeLessThan(10);
  });

  it('misses a screen shorter than the interval', async () => {
    // Arrange: the first popup is on screen for 300ms only.
    const timeline: Span[] = [
      { shot: 0, start: 0, end: 1100 },
      { shot: 1, start: 1100, end: 1400 },
      { shot: 2, start: 1400, end: 4000 },
      { shot: 3, start: 4000, end: 6000 },
    ];
    // Act
    const slow = await simulate({ intervalMs: 1000, timeline, signature, read: reader(frames, 50).read });
    const fast = await simulate({ intervalMs: 125, timeline, signature, read: reader(frames, 50).read });
    // Assert
    expect(slow.events.map((e) => e.event)).toEqual([{ kind: 'got', giftId: 9007 }]);
    expect(fast.events.map((e) => e.event)).toEqual([
      { kind: 'got', giftId: 9006 },
      { kind: 'got', giftId: 9007 },
    ]);
  });

  it('stays busy for as long as a read takes, then reads the newest screen', async () => {
    // Arrange: a 900ms read starts on the first change; two screens pass under it.
    const timeline = timelineOf([0, 1, 2, 3], { dwellMs: 400, maxDwellMs: 0 });
    const r = reader(frames, 900);
    // Act
    const result = await simulate({ intervalMs: 100, timeline, signature, read: r.read });
    // Assert: shot 0 at 100ms, then the dirty read at the first free tick (1000ms) sees shot 2.
    expect(r.reads.slice(0, 2)).toEqual([0, 2]);
    expect(result.events.map((e) => e.event)).toEqual([]);
  });

  it('times events from when their screen appeared', async () => {
    // Arrange
    const timeline = timelineOf([0, 1], { dwellMs: 1000, maxDwellMs: 0 });
    // Act
    const result = await simulate({ intervalMs: 250, timeline, signature, read: reader(frames, 100).read });
    // Assert: shot 1 appears at 1000, the 1000ms tick reads it, the read ends at 1100.
    expect(latencies(result.events, timeline)).toEqual([100]);
  });

  it('does nothing on an empty timeline', async () => {
    const result = await simulate({ intervalMs: 250, timeline: [], signature, read: reader(frames, 1).read });
    expect(result).toMatchObject({ ticks: 0, reads: 0, events: [], durationMs: 0 });
  });
});

describe('simulate — a click-through of popups (M136)', () => {
  // Three popups clicked through in about half a second each, a blink between, then the map.
  const frames = [popup(1), NOTHING, popup(2), NOTHING, popup(3), NOTHING];
  const timeline: Span[] = [
    { shot: 0, start: 0, end: 450 },
    { shot: 1, start: 450, end: 570 },
    { shot: 2, start: 570, end: 1020 },
    { shot: 3, start: 1020, end: 1140 },
    { shot: 4, start: 1140, end: 1590 },
    { shot: 5, start: 1590, end: 8000 },
  ];
  /** What reads cost on the owner's machine: a full read of nothing reads every title (~600 ms). */
  function costed(honoursMode: boolean) {
    const reads: [number, ReadMode][] = [];
    return {
      reads,
      read: async (shot: number, _held: ReadonlySet<number>, mode: ReadMode): Promise<ShotRead> => {
        reads.push([shot, mode]);
        const frame = frames[shot]!;
        if (frame.screen === 'acquired') return { frame, ms: 150, ocrCalls: 2 };
        return honoursMode && mode === 'popup'
          ? { frame: { ...frame, partial: true }, ms: 60, ocrCalls: 1 }
          : { frame, ms: 600, ocrCalls: 9 };
      },
    };
  }

  it('catches every popup when the reads after a popup look for popups only', async () => {
    // Arrange
    const burst = costed(true);
    const always = costed(false);
    // Act
    const caught = await simulate({ intervalMs: 250, timeline, signature, read: burst.read });
    const missed = await simulate({ intervalMs: 250, timeline, signature, read: always.read });
    // Assert: the full read of the blink after the first popup runs past the second.
    const gots = (r: typeof caught) => r.events.map((e) => e.event).filter((e) => e.kind === 'got');
    expect(gots(caught).map((e) => (e.kind === 'got' ? e.giftId : 0))).toEqual([1, 2, 3]);
    expect(gots(missed).length).toBeLessThan(3);
  });

  it('reads the screen the popups gave way to in full once the burst is over', async () => {
    // Arrange
    const burst = costed(true);
    // Act
    await simulate({ intervalMs: 250, timeline, signature, read: burst.read });
    // Assert: the map was first read by a popup read, then once in full.
    const map = burst.reads.filter(([shot]) => shot === 5).map(([, mode]) => mode);
    expect(map[0]).toBe('popup');
    expect(map).toContain('full');
  });
});

describe('compareEvents', () => {
  it('counts missed and extra events as multisets', () => {
    // Arrange
    const reference = [
      { kind: 'got' as const, giftId: 1 },
      { kind: 'enter' as const, floor: 1, packId: 1101 },
    ];
    const run = [
      { kind: 'got' as const, giftId: 1 },
      { kind: 'got' as const, giftId: 1 },
    ];
    // Act
    const result = compareEvents(reference, run);
    // Assert
    expect(result).toEqual({ missed: ['enter:1:1101'], extra: ['got:1'] });
  });

  it('ignores the order of consumed ingredients', () => {
    const a = [{ kind: 'fused' as const, resultId: 5, consumed: [2, 1], unsure: [] }];
    const b = [{ kind: 'fused' as const, resultId: 5, consumed: [1, 2], unsure: [] }];
    expect(compareEvents(a, b)).toEqual({ missed: [], extra: [] });
  });
});

describe('downscale', () => {
  it('averages each block', () => {
    // Arrange: a 4×2 image, left half black, right half white.
    const data = new Uint8Array(4 * 2 * 4);
    for (let y = 0; y < 2; y++) for (let x = 2; x < 4; x++) data.set([255, 255, 255, 255], (y * 4 + x) * 4);
    // Act
    const small = downscale(data, 4, 2, 2);
    // Assert
    expect([small.width, small.height]).toEqual([2, 1]);
    expect([...small.data]).toEqual([0, 0, 0, 0, 255, 255, 255, 255]);
  });

  it('never enlarges', () => {
    expect(downscale(new Uint8Array(4), 1, 1, 480).width).toBe(1);
  });
});

describe('steamShotTime', () => {
  it('reads the time out of a Steam screenshot name', () => {
    expect(steamShotTime('20261016103716_1.jpg')! - steamShotTime('20261016103707_1.jpg')!).toBe(9000);
  });

  it('is null for any other name', () => {
    expect(steamShotTime('popup.png')).toBeNull();
  });
});
