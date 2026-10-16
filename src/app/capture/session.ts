/**
 * A screen-capture session in the browser (M103): the game window in, run events out.
 *
 * Owns the pieces with side effects — the shared screen (`getDisplayMedia`), canvases, the OCR
 * engine, the timer — and wires the pure ones together:
 *
 *   tick (every interval) → signature of the watched regions on a small copy (`change.ts`)
 *     → `decide` (`loop.ts`): read only on change, a pending change, or the refresh
 *     → snapshot at full size → `readFrame` (OCR and icon slots on crops of the snapshot)
 *     → `trackFrame` → events to the caller
 *
 * The caller (M104's UI) applies the events to the run and supplies what the reading needs
 * through `context()`, read fresh on every frame so candidates follow the run.
 */
import type { CaptureLayout } from '../../core/schema.ts';
import { captureLayoutSchema } from '../../core/schema.ts';
import type { Lang } from '../i18n.ts';
import { changed, signatureOf, watchedRegions } from './change.ts';
import { decide, finished, INITIAL_LOOP, READ_INTERVALS, type LoopState } from './loop.ts';
import { prepareReference, prepareSlot, type IconRef } from './match-icon.ts';
import type { NameCandidate } from './match-name.ts';
import { createOcrEngine, type OcrEngine } from './ocr-engine.ts';
import { cropRgba, isolateLightText, type Region } from './preprocess.ts';
import { readFrame, type RegionReader } from './read-frame.ts';
import { INITIAL_TRACKER, trackFrame, type CaptureEvent, type TrackerState } from './tracker.ts';

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

export interface SessionOptions {
  intervalMs?: number;
  context: () => CaptureContext;
  onEvents: (events: CaptureEvent[]) => void;
  onStatus: (status: CaptureStatus, error?: CaptureError) => void;
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

  /** Ask for the game window and start reading. Resolves once running, or after reporting the error. */
  async start(): Promise<void> {
    if (!captureSupported()) return this.fail('unsupported');
    this.options.onStatus('starting');
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8 } },
        audio: false,
      });
    } catch {
      return this.fail('denied');
    }
    const track = this.stream.getVideoTracks()[0];
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
    try {
      this.engine = await createOcrEngine(this.options.context().lang);
    } catch {
      return this.fail('engine');
    }
    if (this.stopped) return;
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

  private fail(error: CaptureError): void {
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
    const step = decide(this.loop, signature, changed(this.loop.lastRead, signature), performance.now());
    this.loop = step.state;
    if (step.decision === 'skip') return;
    const started = performance.now();
    try {
      await this.read(video, width, height);
    } finally {
      this.stats.reads += 1;
      this.stats.readMs += performance.now() - started;
      this.loop = finished(this.loop);
    }
  }

  private async read(video: HTMLVideoElement, width: number, height: number): Promise<void> {
    const layout = this.layout!;
    const engine = this.engine!;
    // One snapshot per read: the reading takes several OCR calls, and the screen must not change
    // under them.
    const snapshot = drawScaled(this.snapshotCanvas, video, width, height);
    const ctx = this.options.context();
    const reader: RegionReader = {
      ocr: async (region, light) => {
        const crop = cropRgba(snapshot.data, width, height, region);
        const pixels = light ? isolateLightText(crop.data) : new Uint8ClampedArray(crop.data);
        return engine.recognize(toCanvas(pixels, crop.width, crop.height));
      },
      slot: async (region) => prepareSlot(snapshot.data, width, height, region),
    };
    const refsOf = async (ids: readonly number[]) =>
      (await Promise.all(ids.map((id) => this.ref(id, ctx.iconUrl)))).filter((r): r is IconRef => r !== null);
    const [held, materials] = await Promise.all([refsOf(ctx.held), refsOf(ctx.materials)]);
    const { frame, ocrCalls } = await readFrame(reader, layout, {
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
    if (out.events.length > 0) this.options.onEvents(out.events);
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

function toCanvas(pixels: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas;
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
