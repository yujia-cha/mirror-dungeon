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
    // Reads on each change, plus the 2s refresh on a still screen — never once per tick. The two
    // popups each start a 3 s burst of 80 ms ticks (M139), so most of the 8 s ticks fast.
    expect(result.ticks).toBe(76);
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

  it('stays busy for as long as a read takes, then reads what came meanwhile, oldest first', async () => {
    // Arrange: a 900ms read starts on the first change; two screens pass under it.
    const timeline = timelineOf([0, 1, 2, 3], { dwellMs: 400, maxDwellMs: 0 });
    const r = reader(frames, 900);
    // Act
    const result = await simulate({ intervalMs: 100, timeline, signature, read: r.read });
    // Assert: shot 0 at 100ms; the shots seen under it were queued (M141) and read after it in
    // the order they came — before M141 the dirty read at 1000ms saw shot 2 and both popups were lost.
    expect(r.reads.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(result.queued).toBeGreaterThanOrEqual(3);
    expect(result.events.map((e) => e.event)).toEqual([
      { kind: 'got', giftId: 9006 },
      { kind: 'got', giftId: 9007 },
    ]);
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

  it('catches every popup sooner when the reads after a popup look for popups only', async () => {
    // Arrange
    const burst = costed(true);
    const always = costed(false);
    // Act
    const quick = await simulate({ intervalMs: 250, timeline, signature, read: burst.read });
    const slow = await simulate({ intervalMs: 250, timeline, signature, read: always.read });
    // Assert: the full read of the blink after the first popup runs past the second. Before M141
    // that popup was lost; now the backlog still reads it, but only once that full read is done.
    const gots = (r: typeof quick) => r.events.filter((e) => e.event.kind === 'got');
    const ids = (r: typeof quick) => gots(r).map((e) => (e.event.kind === 'got' ? e.event.giftId : 0));
    expect(ids(quick)).toEqual([1, 2, 3]);
    expect(ids(slow)).toEqual([1, 2, 3]);
    expect(slow.queued).toBeGreaterThan(0);
    const at = (r: typeof quick, id: number) =>
      gots(r).find((e) => e.event.kind === 'got' && e.event.giftId === id)!.at;
    expect(at(quick, 2)).toBeLessThan(at(slow, 2));
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

describe('simulate — popups shorter than a tick (M139)', () => {
  // The owner's second session: a popup clicked away in about 0.1 s stood between two 250 ms ticks
  // and was never seen. Here the second popup (1260–1360) falls between the ticks at 1250 and 1500.
  const frames = [NOTHING, popup(1), NOTHING, popup(2), NOTHING, popup(3), NOTHING];
  const timeline: Span[] = [
    { shot: 0, start: 0, end: 1000 },
    { shot: 1, start: 1000, end: 1150 },
    { shot: 2, start: 1150, end: 1260 },
    { shot: 3, start: 1260, end: 1360 },
    { shot: 4, start: 1360, end: 1470 },
    { shot: 5, start: 1470, end: 1570 },
    { shot: 6, start: 1570, end: 8000 },
  ];
  const read = async (shot: number, _held: ReadonlySet<number>, mode: ReadMode): Promise<ShotRead> => {
    const frame = frames[shot]!;
    if (frame.screen === 'acquired') return { frame, ms: 150, ocrCalls: 2 };
    return mode === 'popup'
      ? { frame: { ...frame, partial: true }, ms: 60, ocrCalls: 1 }
      : { frame, ms: 600, ocrCalls: 9 };
  };

  it('sees a popup that stands between two preset ticks, by ticking faster in the burst', async () => {
    // Act
    const result = await simulate({ intervalMs: 250, timeline, signature, read, firstTickMs: 1000 });
    // Assert
    const gots = result.events.map((e) => e.event).filter((e) => e.kind === 'got');
    expect(gots.map((e) => (e.kind === 'got' ? e.giftId : 0))).toEqual([1, 2, 3]);
  });

  it('goes back to the preset interval once the burst is over', async () => {
    // Act
    const result = await simulate({ intervalMs: 250, timeline, signature, read, firstTickMs: 1000 });
    // Assert: 7 s at 250 ms is 28 ticks; the 3 s burst adds about 26 more, not a run of 80 ms ticks.
    expect(result.ticks).toBeGreaterThan(28);
    expect(result.ticks).toBeLessThan(70);
  });
});

describe('simulate — a popup under a busy read (M141)', () => {
  // The owner's third session: the observation 「프레스티지 카드」 stood 42.57–42.84 s, entirely under
  // a full read of a confirm dialog that ran 42.31–43.17 s (860 ms, 9 OCR calls). Here the read
  // starts at 0 on the dialog, the popup stands 260–530, a blink, then the next popup.
  const frames = [NOTHING, popup(1), NOTHING, popup(2), NOTHING];
  const timeline: Span[] = [
    { shot: 0, start: 0, end: 260 },
    { shot: 1, start: 260, end: 530 },
    { shot: 2, start: 530, end: 650 },
    { shot: 3, start: 650, end: 1100 },
    { shot: 4, start: 1100, end: 8000 },
  ];
  const read = async (shot: number, _held: ReadonlySet<number>, mode: ReadMode): Promise<ShotRead> => {
    const frame = frames[shot]!;
    if (frame.screen === 'acquired') return { frame, ms: 150, ocrCalls: 2 };
    return mode === 'popup'
      ? { frame: { ...frame, partial: true }, ms: 34, ocrCalls: 1 }
      : { frame, ms: 860, ocrCalls: 9 };
  };

  it('reads the popup that came and went under the read, once the read is done', async () => {
    // Act: every timer phase against the screens.
    const runs = await Promise.all(
      [0, 60, 125, 190].map((phase) =>
        simulate({ intervalMs: 250, timeline, signature, read, firstTickMs: phase }),
      ),
    );
    // Assert: both popups, in the order they were on screen.
    for (const run of runs) {
      const gots = run.events.map((e) => e.event).filter((e) => e.kind === 'got');
      expect(gots.map((e) => (e.kind === 'got' ? e.giftId : 0))).toEqual([1, 2]);
    }
  });

  it('queues a popup once however many busy ticks see it, and nothing that looks like the read', async () => {
    // Act: ticks every 50 ms — five see the first popup, four the second, two the blink.
    const run = await simulate({ intervalMs: 50, timeline, signature, read, firstTickMs: 0 });
    // Assert: popup 1, the blink, popup 2 — each once, never the dialog under the read — and the
    // screen after them, seen while the queue was being read (the loop stays busy until it is empty).
    expect(run.queued).toBe(4);
    expect(run.queueDropped).toBe(0);
  });
});

describe('simulate — a popup shown for one frame (M141)', () => {
  // A double click: in a click-through the second popup is on the share for one 33 ms frame, and
  // falls between the 80 ms burst ticks (410, 490, 570). Reads are cheap here, so no read is busy
  // when it shows: only a tick on that frame sees it.
  const frames = [popup(1), NOTHING, popup(2), NOTHING, popup(3), NOTHING];
  const timeline: Span[] = [
    { shot: 0, start: 0, end: 450 },
    { shot: 1, start: 450, end: 500 },
    { shot: 2, start: 500, end: 533 },
    { shot: 3, start: 533, end: 700 },
    { shot: 4, start: 700, end: 1100 },
    { shot: 5, start: 1100, end: 8000 },
  ];
  const read = async (shot: number, _held: ReadonlySet<number>, mode: ReadMode): Promise<ShotRead> => {
    const frame = frames[shot]!;
    if (frame.screen === 'acquired') return { frame, ms: 150, ocrCalls: 2 };
    return mode === 'popup'
      ? { frame: { ...frame, partial: true }, ms: 20, ocrCalls: 1 }
      : { frame, ms: 600, ocrCalls: 9 };
  };

  it('sees it by ticking on every frame in the burst', async () => {
    // Act
    const result = await simulate({ intervalMs: 250, timeline, signature, read, firstTickMs: 100 });
    // Assert
    const gots = result.events.map((e) => e.event).filter((e) => e.kind === 'got');
    expect(gots.map((e) => (e.kind === 'got' ? e.giftId : 0))).toEqual([1, 2, 3]);
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
