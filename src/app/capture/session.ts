/**
 * A screen-capture session in the browser (M103): the game window in, run events out.
 *
 * Owns the pieces with side effects — the shared screen (`getDisplayMedia`), canvases, the OCR
 * engine, the timer — and wires the pure ones together:
 *
 *   tick (every interval) → signature of the watched regions on a small copy (`change.ts`)
 *     → `decide` (`loop.ts`): read only on change, a pending change, or the refresh
 *     → snapshot at full size → `readFrame` (OCR and icon slots on the regions it asks for,
 *       each read off the snapshot canvas on its own — M116)
 *     → `trackFrame` → events to the caller
 *
 * The caller (M104's UI) applies the events to the run and supplies what the reading needs
 * through `context()`, read fresh on every frame so candidates follow the run.
 */
import type { CaptureLayout, DiagTraceStep } from '../../core/schema.ts';
import { captureLayoutSchema } from '../../core/schema.ts';
import type { Lang } from '../i18n.ts';
import { changed, signatureOf, watchedRegions } from './change.ts';
import { decide, finished, INITIAL_LOOP, READ_INTERVALS, type LoopState } from './loop.ts';
import { prepareReference, prepareSlot, type IconRef } from './match-icon.ts';
import type { NameCandidate } from './match-name.ts';
import { createOcrEngine, type OcrEngine } from './ocr-engine.ts';
import { pixelRect, toPnm, type Region } from './preprocess.ts';
import { readFrame, type RegionReader } from './read-frame.ts';
import { INITIAL_TRACKER, trackFrame, type CaptureEvent, type Frame, type TrackerState } from './tracker.ts';

export type CaptureStatus = 'idle' | 'starting' | 'running' | 'error';
/** Why a session stopped on its own: no API, the player said no, the share ended, OCR failed to load. */
export type CaptureError = 'unsupported' | 'denied' | 'ended' | 'engine' | 'layout';

export interface CaptureContext {
  lang: Lang;
  packs: readonly NameCandidate[];
  gifts: readonly NameCandidate[];
  /** Gifts the run holds now (giftStatus 'got'), the fusion confirm's candidates. */
  held: readonly number[];
  /** The 잔영 materials, always candidates. */
  materials: readonly number[];
  /** The picture URL of a gift's game icon, or null. */
  iconUrl: (giftId: number) => string | null;
}

export interface CaptureStats {
  ticks: number;
  reads: number;
  ocrCalls: number;
  /** Total time spent in reads, ms. */
  readMs: number;
}

/** One read, as the owner's diagnostics keep it (M112). */
export interface ReadReport {
  /** Wall-clock time of the read's start, ms. */
  t: number;
  reason: 'change' | 'dirty' | 'refresh';
  ms: number;
  ocrCalls: number;
  frame: Frame;
  trace: DiagTraceStep[];
  events: CaptureEvent[];
  captureSize: { width: number; height: number };
}

export interface SessionOptions {
  intervalMs?: number;
  context: () => CaptureContext;
  onEvents: (events: CaptureEvent[]) => void;
  onStatus: (status: CaptureStatus, error?: CaptureError) => void;
  /**
   * Every read, just before its events are handed on (M112). `frame` is the read's picture when
   * `wantImage()` said so at the time: copied after the events, encoded only if kept (M116).
   */
  onRead?: (report: ReadReport, frame: FrameSource | null) => void;
  wantImage?: () => boolean;
}

/**
 * A read's picture for the owner's diagnostics (M116). Taking it is a cheap copy of the snapshot;
 * the full-size JPEG encode happens only for a frame the recorder keeps, once (`encode` is
 * memoised). `close` frees the copy; a frame being encoded is freed when the encode is done.
 */
export interface FrameSource {
  encode(): Promise<Blob | null>;
  close(): void;
}

/** The small copy the signature is taken on: wide enough to see a popup appear, cheap to read back. */
const PREVIEW_WIDTH = 480;

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export class CaptureSession {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private engine: OcrEngine | null = null;
  private layout: CaptureLayout | null = null;
  private regions: Region[] = [];
  private loop: LoopState = INITIAL_LOOP;
  private tracker: TrackerState = INITIAL_TRACKER;
  private refs = new Map<number, Promise<IconRef | null>>();
  private intervalMs: number;
  // Reused every tick: a fresh canvas per frame would also throw away the read-back hint.
  private previewCanvas = document.createElement('canvas');
  private snapshotCanvas = document.createElement('canvas');
  private stopped = false;
  readonly stats: CaptureStats = { ticks: 0, reads: 0, ocrCalls: 0, readMs: 0 };

  constructor(private readonly options: SessionOptions) {
    this.intervalMs = options.intervalMs ?? READ_INTERVALS.balanced;
  }

  /**
   * Ask for the game window and start reading. Resolves once running, or after reporting the error.
   *
   * Every step waits — the picker, the layout, the engine — and the player may press Stop during
   * any of them (M116). So after each wait the session looks again, and if it was stopped it
   * releases what that step just brought (the share's tracks, the engine) and says nothing more.
   */
  async start(): Promise<void> {
    if (!captureSupported()) return this.fail('unsupported');
    this.options.onStatus('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8 } },
        audio: false,
      });
    } catch {
      return this.fail('denied');
    }
    if (this.stopped) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    track?.addEventListener('ended', () => this.fail('ended'));
    try {
      const base = import.meta.env.BASE_URL.endsWith('/')
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
      const response = await fetch(`${base}data/capture-layout.json`);
      this.layout = captureLayoutSchema.parse(await response.json());
      this.regions = watchedRegions(this.layout);
    } catch {
      return this.fail('layout');
    }
    if (this.stopped) return;
    let engine: OcrEngine;
    try {
      engine = await createOcrEngine(this.options.context().lang);
    } catch {
      return this.fail('engine');
    }
    if (this.stopped) {
      void engine.terminate();
      return;
    }
    this.engine = engine;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    // Not awaited: `play()` settles on the first frame, and a window that never repaints sends
    // none — the session would sit in 「연결 중」 for good. A tick before the first frame sees
    // `videoWidth === 0` and waits.
    void video.play().catch(() => undefined);
    this.video = video;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.options.onStatus('running');
  }

  /** Change the read interval while running. */
  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), ms);
  }

  /** Stop sharing and release everything. Safe to call twice. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video = null;
    void this.engine?.terminate();
    this.engine = null;
    this.options.onStatus('idle');
  }

  /** Stop on an error and say why — unless already stopped: a later session may own the status now. */
  private fail(error: CaptureError): void {
    if (this.stopped) return;
    this.stop();
    this.options.onStatus('error', error);
  }

  private async tick(): Promise<void> {
    const video = this.video;
    if (!video || !this.layout || !this.engine || video.videoWidth === 0) return;
    this.stats.ticks += 1;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const preview = drawScaled(
      this.previewCanvas,
      video,
      PREVIEW_WIDTH,
      Math.round((height * PREVIEW_WIDTH) / width),
    );
    const signature = signatureOf(preview.data, preview.width, preview.height, this.regions);
    const isChanged = changed(this.loop.lastRead, signature);
    const reason: ReadReport['reason'] = isChanged ? 'change' : this.loop.dirty ? 'dirty' : 'refresh';
    const step = decide(this.loop, signature, isChanged, performance.now());
    this.loop = step.state;
    if (step.decision === 'skip') return;
    const started = performance.now();
    try {
      await this.read(video, width, height, reason);
    } finally {
      this.stats.reads += 1;
      this.stats.readMs += performance.now() - started;
      this.loop = finished(this.loop);
    }
  }

  private async read(
    video: HTMLVideoElement,
    width: number,
    height: number,
    reason: ReadReport['reason'],
  ): Promise<void> {
    const t = Date.now();
    const started = performance.now();
    const layout = this.layout!;
    const engine = this.engine!;
    // One snapshot per read: the reading takes several OCR calls, and the screen must not change
    // under them. Only the regions the reading asks for come back off the canvas (M116) — a read
    // that stops at the popup's title touches one strip, not the 1920×1009 frame.
    const canvas = this.snapshotCanvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const snapshot = canvas.getContext('2d', { willReadFrequently: true })!;
    snapshot.drawImage(video, 0, 0, width, height);
    const pixelsOf = (region: Region) => {
      const rect = pixelRect(width, height, region);
      const data =
        rect.width > 0 && rect.height > 0
          ? snapshot.getImageData(rect.left, rect.top, rect.width, rect.height).data
          : new Uint8ClampedArray(0);
      return { rect, data };
    };
    const ctx = this.options.context();
    const reader: RegionReader = {
      ocr: async (region, light) => {
        const { rect, data } = pixelsOf(region);
        return engine.recognize(toPnm(data, rect.width, rect.height, light));
      },
      slot: async (region) => {
        const { rect, data } = pixelsOf(region);
        return prepareSlot(data, width, height, region, rect);
      },
    };
    const refsOf = async (ids: readonly number[]) =>
      (await Promise.all(ids.map((id) => this.ref(id, ctx.iconUrl)))).filter((r): r is IconRef => r !== null);
    const [held, materials] = await Promise.all([refsOf(ctx.held), refsOf(ctx.materials)]);
    const { frame, ocrCalls, trace } = await readFrame(reader, layout, {
      lang: ctx.lang,
      packs: ctx.packs,
      gifts: ctx.gifts,
      held,
      materials,
    });
    this.stats.ocrCalls += ocrCalls;
    if (this.stopped) return;
    const out = trackFrame(this.tracker, frame);
    this.tracker = out.state;
    // Nothing waits from here on (M116): a Stop pressed now cannot land between the check above
    // and the events, and the events never wait for a picture.
    const picture = this.options.onRead && this.options.wantImage?.() ? new SnapshotFrame(canvas) : null;
    this.options.onRead?.(
      {
        t,
        reason,
        ms: performance.now() - started,
        ocrCalls,
        frame,
        trace,
        events: out.events,
        captureSize: { width, height },
      },
      picture,
    );
    if (out.events.length > 0) this.options.onEvents(out.events);
    picture?.take();
  }

  /** A gift icon reduced for matching, decoded once per session. */
  private ref(id: number, iconUrl: (giftId: number) => string | null): Promise<IconRef | null> {
    let cached = this.refs.get(id);
    if (!cached) {
      cached = loadRef(id, iconUrl(id));
      this.refs.set(id, cached);
    }
    return cached;
  }
}

/** The video's current frame at a size, as RGBA, drawn on `canvas`. */
function drawScaled(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** A canvas as JPEG at full size — the diagnostics re-read it with OCR, so no downscale. */
function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    } catch {
      resolve(null);
    }
  });
}

/** Where kept pictures are drawn to be encoded; one for the page, made on first use. */
let encodeCanvas: HTMLCanvasElement | null = null;

/** A picture as JPEG. Draw and `toBlob` run together, so one canvas serves every encode. */
function bitmapToJpeg(bitmap: ImageBitmap): Promise<Blob | null> {
  try {
    encodeCanvas ??= document.createElement('canvas');
    encodeCanvas.width = bitmap.width;
    encodeCanvas.height = bitmap.height;
    encodeCanvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return toJpeg(encodeCanvas);
  } catch {
    // A picture already freed, or no 2D context.
    return Promise.resolve(null);
  }
}

/**
 * The snapshot of one read, for the diagnostics (`FrameSource`). `take` copies the canvas into an
 * `ImageBitmap` — before the next read draws over it; the session calls it right after the events.
 * Without `createImageBitmap` the copy is the JPEG itself, encoded at once.
 */
class SnapshotFrame implements FrameSource {
  private copy: Promise<ImageBitmap | Blob | null> | null = null;
  private jpeg: Promise<Blob | null> | null = null;
  private closed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  take(): void {
    if (this.copy) return;
    this.copy =
      typeof createImageBitmap === 'function'
        ? createImageBitmap(this.canvas).catch(() => null)
        : toJpeg(this.canvas);
  }

  encode(): Promise<Blob | null> {
    if (this.jpeg) return this.jpeg;
    if (this.closed) return Promise.resolve(null);
    this.take();
    this.jpeg = this.copy!.then((copy) =>
      copy === null || copy instanceof Blob ? copy : bitmapToJpeg(copy),
    );
    return this.jpeg;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const copy = this.copy;
    if (!copy) return;
    void (this.jpeg ?? Promise.resolve(null))
      .then(() => copy)
      .then((bitmap) => {
        if (bitmap && !(bitmap instanceof Blob)) bitmap.close();
      });
  }
}

async function loadRef(id: number, url: string | null): Promise<IconRef | null> {
  if (!url) return null;
  try {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return prepareReference(id, image.data, image.width, image.height);
  } catch {
    return null;
  }
}
