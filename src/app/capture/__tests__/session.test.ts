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
    // A blank frame: jsdom draws nothing, so every region reads as black.
    const ctx = {
      drawImage: () => undefined,
      putImageData: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
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
      intervalMs: 5,
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
