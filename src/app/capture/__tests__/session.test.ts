import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = { recognize: vi.fn(async () => []), terminate: vi.fn(async () => undefined) };
let engineGate: Promise<void> = Promise.resolve();
vi.mock('../ocr-engine.ts', () => ({
  createOcrEngine: vi.fn(async () => {
    await engineGate;
    return engine;
  }),
}));

const { CaptureSession } = await import('../session.ts');
const { createOcrEngine } = await import('../ocr-engine.ts');

const LAYOUT: unknown = JSON.parse(readFileSync('public/data/capture-layout.json', 'utf8'));
/** The fake share's grey: plain, no text, not black (a black frame is not read, M153). */
const GREY = 60;

/** A share whose answer the test releases, and its one track. */
function fakeShare() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  const getDisplayMedia = vi.fn(async () => {
    await answered;
    return stream;
  });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
  return { track, release };
}

function session() {
  const onStatus = vi.fn();
  const created = new CaptureSession({
    context: () => ({
      lang: 'ko',
      packs: [],
      gifts: [],
      held: [],
      materials: [],
      iconUrl: () => null,
      startOpen: false,
    }),
    onEvents: vi.fn(),
    onStatus,
  });
  return { created, onStatus };
}

describe('CaptureSession.start', () => {
  beforeEach(() => {
    engineGate = Promise.resolve();
    // jsdom has no media playback.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => LAYOUT })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('releases a share granted after Stop, and never runs', async () => {
    // Arrange: the picker is still open when the player presses Stop.
    const { track, release } = fakeShare();
    const { created, onStatus } = session();
    const started = created.start();
    // Act
    created.stop();
    release();
    await started;
    // Assert
    expect(track.stop).toHaveBeenCalled();
    expect(createOcrEngine).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalledWith('running');
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('terminates an engine that finished loading after Stop', async () => {
    // Arrange: the share is granted, the OCR engine still loading.
    const { release } = fakeShare();
    let engineReady!: () => void;
    engineGate = new Promise((resolve) => (engineReady = resolve));
    const { created, onStatus } = session();
    release();
    const started = created.start();
    await vi.waitFor(() => expect(createOcrEngine).toHaveBeenCalled());
    // Act
    created.stop();
    engineReady();
    await started;
    // Assert
    expect(engine.terminate).toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalledWith('running');
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('reports no error once stopped — the share ending afterwards is not this session’s news', async () => {
    // Arrange: a running session.
    const { track, release } = fakeShare();
    const { created, onStatus } = session();
    release();
    await created.start();
    // Act
    created.stop();
    track.dispatchEvent(new Event('ended'));
    // Assert
    expect(onStatus).toHaveBeenLastCalledWith('idle');
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.anything());
  });
});

describe('CaptureSession reads', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => LAYOUT })),
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1009);
    // A plain grey frame: no text on it, and not black — a black frame is not read (M153).
    const ctx = {
      drawImage: () => undefined,
      putImageData: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(GREY),
        width: w,
        height: h,
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    if (typeof ImageData === 'undefined')
      vi.stubGlobal(
        'ImageData',
        class {
          constructor(
            readonly data: Uint8ClampedArray,
            readonly width: number,
            readonly height: number,
          ) {}
        },
      );
    // The acquired popup's title, then its gift's name.
    engine.recognize.mockReset();
    engine.recognize
      .mockResolvedValueOnce(['E.G.O 기프트를 획득했습니다.'] as never)
      .mockResolvedValueOnce(['테스트 기프트'] as never)
      .mockResolvedValue([] as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands on no events once Stop was pressed, even while the frame’s picture is made', async () => {
    // Arrange: diagnostics want pictures; the player presses Stop while one is being made.
    const { release } = fakeShare();
    release();
    let stopped = false;
    const afterStop: string[] = [];
    const stopNow = () => {
      stopped = true;
      created.stop();
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => {
      stopNow();
      done(new Blob([]));
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        stopNow();
        return { width: 1, height: 1, close: () => undefined };
      }),
    );
    const onEvents = vi.fn(() => {
      if (stopped) afterStop.push('events');
    });
    const created = new CaptureSession({
      interval: { min: 5, max: 5 },
      context: () => ({
        lang: 'ko',
        packs: [],
        gifts: [{ id: 9006, name: '테스트 기프트' }],
        held: [],
        materials: [],
        iconUrl: () => null,
        startOpen: false,
      }),
      onEvents,
      onStatus: vi.fn(),
      onRead: vi.fn(),
      wantImage: () => true,
    });
    // Act
    await created.start();
    await vi.waitFor(() => expect(stopped).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Assert: the read either landed before Stop or not at all.
    expect(afterStop).toEqual([]);
    created.stop();
  });
});

describe('CaptureSession backlog (M141)', () => {
  /** What the share shows: every pixel this grey, so a change of level is a change of screen. */
  let level = GREY;
  beforeEach(() => {
    level = GREY;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => LAYOUT })),
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1009);
    const ctx = {
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(level),
        width: w,
        height: h,
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a popup that came and went under a busy read, once that read is done', async () => {
    // Arrange: the first OCR call of the first (full) read waits until a busy tick has queued the
    // popup; the full read then finds nothing (9 title passes), and the queued read finds the popup.
    const { release } = fakeShare();
    release();
    let calls = 0;
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => (unblock = resolve));
    engine.recognize.mockReset();
    engine.recognize.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await blocked;
      if (calls === 10) return ['E.G.O 기프트를 획득했습니다.'] as never;
      if (calls === 11) return ['테스트 기프트'] as never;
      return [] as never;
    });
    const crops: number[][] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (_source: unknown, ...rect: number[]) => {
        crops.push(rect);
        return { width: rect[2], height: rect[3], close: () => undefined };
      }),
    );
    const onEvents = vi.fn();
    const onRead = vi.fn();
    const created = new CaptureSession({
      interval: { min: 5, max: 5 },
      context: () => ({
        lang: 'ko',
        packs: [],
        gifts: [{ id: 9006, name: '테스트 기프트' }],
        held: [],
        materials: [],
        iconUrl: () => null,
        startOpen: false,
      }),
      onEvents,
      onStatus: vi.fn(),
      onRead,
    });
    await created.start();
    await vi.waitFor(() => expect(calls).toBe(1));
    // Act: the popup shows while the read is busy, then is clicked away before it is done.
    level = 120;
    await vi.waitFor(() => expect(crops).toHaveLength(1));
    level = GREY;
    unblock();
    await vi.waitFor(() => expect(onEvents).toHaveBeenCalled());
    created.stop();
    // Assert: the gift, from a queued popup read of a crop — not of the whole picture.
    expect(onEvents).toHaveBeenCalledWith([{ kind: 'got', giftId: 9006 }]);
    const reports = onRead.mock.calls.map(([r]) => r as { queued?: { lagMs: number } });
    const report = reports.find((r) => r.queued);
    expect(report).toMatchObject({ mode: 'popup', frame: { screen: 'acquired' } });
    expect(report!.queued!.lagMs).toBeGreaterThanOrEqual(0);
    const [, , width, height] = crops[0]!;
    expect(width! * height!).toBeLessThan(1920 * 1009 * 0.25);
    expect(created.stats.queued).toBe(1);
  });

  it('reads no black frame, and the first frame after the black at once (M153)', async () => {
    // Arrange: the share shows black — a fade between sections.
    level = 0;
    const { release } = fakeShare();
    release();
    engine.recognize.mockReset();
    engine.recognize.mockResolvedValue([] as never);
    const created = new CaptureSession({
      interval: { min: 5, max: 5 },
      context: () => ({
        lang: 'ko',
        packs: [],
        gifts: [],
        held: [],
        materials: [],
        iconUrl: () => null,
        startOpen: false,
      }),
      onEvents: vi.fn(),
      onStatus: vi.fn(),
    });
    await created.start();
    await vi.waitFor(() => expect(created.stats.ticks).toBeGreaterThan(5));
    const blackReads = created.stats.reads;
    // Act: the next screen fades in.
    level = GREY;
    await vi.waitFor(() => expect(created.stats.reads).toBe(1));
    created.stop();
    // Assert
    expect(blackReads).toBe(0);
  });
});

describe('CaptureSession environment (M142)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => LAYOUT })),
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1009);
    const ctx = {
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(GREY),
        width: w,
        height: h,
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    engine.recognize.mockReset();
    engine.recognize.mockResolvedValue([] as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const context = () => ({
    lang: 'ko' as const,
    packs: [],
    gifts: [],
    held: [],
    materials: [],
    iconUrl: () => null,
    startOpen: false,
  });

  it('tells the environment periodically: the range, the interval, the level and what was asked', async () => {
    // Arrange
    const { release } = fakeShare();
    release();
    const onEnv = vi.fn();
    const created = new CaptureSession({
      interval: { min: 5, max: 40 },
      envPeriodMs: 30,
      context,
      onEvents: vi.fn(),
      onStatus: vi.fn(),
      onEnv,
    });
    // Act
    await created.start();
    await vi.waitFor(() => expect(onEnv).toHaveBeenCalled());
    created.stop();
    // Assert
    expect(onEnv.mock.calls[0]![0]).toMatchObject({
      reason: 'periodic',
      fps: { requested: 8, delivered: null },
      range: { min: 5, max: 40 },
      level: 0,
      queueDropped: 0,
    });
    const { interval } = onEnv.mock.calls[0]![0] as { interval: number };
    expect(interval).toBeGreaterThanOrEqual(5);
    expect(interval).toBeLessThanOrEqual(40);
  });

  it('tells a level change at once when the page’s thread holds the ticks back', async () => {
    // Arrange: every OCR call blocks the page for 80 ms, so the timer ticks fire late.
    const { release } = fakeShare();
    release();
    engine.recognize.mockImplementation(async () => {
      const until = performance.now() + 80;
      while (performance.now() < until) {
        // busy: the page's thread is held
      }
      return [] as never;
    });
    const onEnv = vi.fn();
    const created = new CaptureSession({
      interval: { min: 5, max: 5 },
      context,
      onEvents: vi.fn(),
      onStatus: vi.fn(),
      onEnv,
    });
    // Act
    await created.start();
    await vi.waitFor(
      () => expect(onEnv.mock.calls.some(([e]) => (e as { reason: string }).reason === 'level')).toBe(true),
      { timeout: 8000 },
    );
    created.stop();
    // Assert
    const told = onEnv.mock.calls.map(([e]) => e as { reason: string; level: number; stats: unknown });
    const level = told.find((e) => e.reason === 'level')!;
    expect(level.level).toBeGreaterThanOrEqual(1);
    expect(level.stats).toMatchObject({ lateness: { p90: expect.any(Number) } });
    expect(created.level).toBeGreaterThanOrEqual(1);
  }, 10_000);
});
