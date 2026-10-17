/**
 * A screen-capture session in the browser (M103): the game window in, run events out.
 *
 * Owns the pieces with side effects — the shared screen (`getDisplayMedia`), canvases, the OCR
 * engine, the timer — and wires the pure ones together:
 *
 *   tick (every interval) → signature of the watched regions on a small copy (`change.ts`)
 *     → `decide` (`loop.ts`): read only on change, a pending change, or the refresh — and right
 *       after a popup, only the popup's title (the popup burst, M136)
 *     → snapshot at full size → the window's title bar, if shared with it (`window-frame.ts`)
 *     → `readFrame` (OCR and icon slots on the regions it asks for,
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
import { decide, finished, INITIAL_LOOP, READ_INTERVALS, type LoopState, type ReadMode } from './loop.ts';
import { prepareReference, prepareSlot, type IconRef } from './match-icon.ts';
import type { NameCandidate } from './match-name.ts';
import { createOcrEngine, type OcrEngine } from './ocr-engine.ts';
import { pixelRect, toPnm, type Region } from './preprocess.ts';
import { readFrame, type RegionReader } from './read-frame.ts';
import { INITIAL_TRACKER, trackFrame, type CaptureEvent, type Frame, type TrackerState } from './tracker.ts';
import { layoutInFrame, titleBarHeight, titleBarRows } from './window-frame.ts';

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
  /** The run start is open: look for its pickers (M135). */
  startOpen: boolean;
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
  /** A full read, or a popup read of the popup burst (M136). */
  mode: ReadMode;
  ms: number;
  ocrCalls: number;
  frame: Frame;
  trace: DiagTraceStep[];
  events: CaptureEvent[];
  captureSize: { width: number; height: number };
}

/**
 * What the shared picture is (M134): its size, and how much of its top is the window's title bar
 * rather than the game. Told when the first frame is read and whenever either changes.
 */
export interface CaptureGeometry {
  captureSize: { width: number; height: number };
  inset: { top: number };
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
  onGeometry?: (geometry: CaptureGeometry) => void;
  /**
   * Every tick, after the loop decided (M134): the owner's filmstrip. `preview` is the tick's
   * small picture when `wantImage()` said so — already copied, encoded only if kept.
   */
  onTick?: (tick: TickReport, preview: FrameSource | null) => void;
}

/** One tick, as the owner's diagnostics keep it (M134). */
export interface TickReport {
  /** Wall-clock time, ms. */
  t: number;
  /** This tick started a read. */
  read: boolean;
  /** A read was still running, so this tick was skipped. */
  busy: boolean;
  /** The signature differs from the frame last handed to a read. */
  changed: boolean;
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
/** JPEG quality of a kept read (re-read with OCR) and of a filmstrip preview (only looked at). */
const FULL_QUALITY = 0.85;
const PREVIEW_QUALITY = 0.7;

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export class CaptureSession {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private engine: OcrEngine | null = null;
  /** The layout as measured: regions in fractions of the game's client area. */
  private layout: CaptureLayout | null = null;
  /** The layout moved into the shared picture, below its title bar (M134); what is read and watched. */
  private frameLayout: CaptureLayout | null = null;
  private regions: Region[] = [];
  /** The picture's size and title bar as last told (`onGeometry`); null before the first read. */
  private geometry: CaptureGeometry | null = null;
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
      this.frameLayout = this.layout;
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
    this.reportTick(step.decision === 'read', step.decision === 'skip' && step.state.busy, isChanged);
    if (step.decision === 'skip') return;
    const started = performance.now();
    let frame: Frame | null = null;
    try {
      frame = await this.read(video, width, height, reason, step.mode);
    } finally {
      this.stats.reads += 1;
      this.stats.readMs += performance.now() - started;
      // What the read found starts or extends the popup burst (M136).
      this.loop = finished(
        this.loop,
        frame
          ? { at: performance.now(), popup: frame.screen === 'acquired', partial: frame.partial === true }
          : undefined,
      );
    }
  }

  private async read(
    video: HTMLVideoElement,
    width: number,
    height: number,
    reason: ReadReport['reason'],
    mode: ReadMode,
  ): Promise<Frame | null> {
    const t = Date.now();
    const started = performance.now();
    const engine = this.engine!;
    // One snapshot per read: the reading takes several OCR calls, and the screen must not change
    // under them. Only the regions the reading asks for come back off the canvas (M116) — a read
    // that stops at the popup's title touches one strip, not the 1920×1009 frame.
    const canvas = this.snapshotCanvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const snapshot = canvas.getContext('2d', { willReadFrequently: true })!;
    snapshot.drawImage(video, 0, 0, width, height);
    const layout = this.placeLayout(snapshot, width, height);
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
      startOpen: ctx.startOpen,
      popupOnly: mode === 'popup',
      // A popup's icon, when its name is no sure match (M136): a handful of gifts, loaded once each.
      iconRefs: refsOf,
    });
    this.stats.ocrCalls += ocrCalls;
    if (this.stopped) return null;
    const out = trackFrame(this.tracker, frame);
    this.tracker = out.state;
    // Nothing waits from here on (M116): a Stop pressed now cannot land between the check above
    // and the events, and the events never wait for a picture.
    const picture = this.options.onRead && this.options.wantImage?.() ? new SnapshotFrame(canvas) : null;
    this.options.onRead?.(
      {
        t,
        reason,
        mode,
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
    return frame;
  }

  /**
   * The layout for this picture: below the window's title bar when the game window was shared
   * with it (M134). The bar is looked for on a strip of the top rows only. Once found it holds
   * until the picture changes size; while none is found it is looked for again on every read, so a
   * first frame whose top happens to match the bar's colour does not settle it at 0.
   */
  private placeLayout(snapshot: CanvasRenderingContext2D, width: number, height: number): CaptureLayout {
    const before = this.geometry;
    const sameSize = before?.captureSize.width === width && before.captureSize.height === height;
    if (sameSize && before.inset.top > 0) return this.frameLayout!;
    const rows = titleBarRows(height);
    const top =
      rows > 0 ? titleBarHeight(snapshot.getImageData(0, 0, width, rows).data, width, rows, height) : 0;
    if (!sameSize || before.inset.top !== top) {
      this.frameLayout = layoutInFrame(this.layout!, top, height);
      this.regions = watchedRegions(this.frameLayout);
      this.geometry = { captureSize: { width, height }, inset: { top } };
      this.options.onGeometry?.(this.geometry);
    }
    return this.frameLayout!;
  }

  /** The tick to the owner's diagnostics, with a copy of the preview when they keep pictures (M134). */
  private reportTick(read: boolean, busy: boolean, changed: boolean): void {
    if (!this.options.onTick) return;
    const preview = this.options.wantImage?.()
      ? new SnapshotFrame(this.previewCanvas, PREVIEW_QUALITY)
      : null;
    preview?.take();
    this.options.onTick({ t: Date.now(), read, busy, changed }, preview);
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
function toJpeg(canvas: HTMLCanvasElement, quality = FULL_QUALITY): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}

/** Where kept pictures are drawn to be encoded; one for the page, made on first use. */
let encodeCanvas: HTMLCanvasElement | null = null;

/** A picture as JPEG. Draw and `toBlob` run together, so one canvas serves every encode. */
function bitmapToJpeg(bitmap: ImageBitmap, quality: number): Promise<Blob | null> {
  try {
    encodeCanvas ??= document.createElement('canvas');
    encodeCanvas.width = bitmap.width;
    encodeCanvas.height = bitmap.height;
    encodeCanvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return toJpeg(encodeCanvas, quality);
  } catch {
    // A picture already freed, or no 2D context.
    return Promise.resolve(null);
  }
}

/**
 * The snapshot of one read — or a tick's preview, at a lower quality (M134) — for the diagnostics
 * (`FrameSource`). `take` copies the canvas into an
 * `ImageBitmap` — before the next read draws over it; the session calls it right after the events.
 * Without `createImageBitmap` the copy is the JPEG itself, encoded at once.
 */
class SnapshotFrame implements FrameSource {
  private copy: Promise<ImageBitmap | Blob | null> | null = null;
  private jpeg: Promise<Blob | null> | null = null;
  private closed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly quality = FULL_QUALITY,
  ) {}

  take(): void {
    if (this.copy) return;
    this.copy =
      typeof createImageBitmap === 'function'
        ? createImageBitmap(this.canvas).catch(() => null)
        : toJpeg(this.canvas, this.quality);
  }

  encode(): Promise<Blob | null> {
    if (this.jpeg) return this.jpeg;
    if (this.closed) return Promise.resolve(null);
    this.take();
    this.jpeg = this.copy!.then((copy) =>
      copy === null || copy instanceof Blob ? copy : bitmapToJpeg(copy, this.quality),
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
