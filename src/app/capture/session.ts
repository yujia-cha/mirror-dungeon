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
 *   a tick skipped for a busy read whose popup changed → a crop of the popup's box, queued
 *     (`backlog.ts`, M141) and read as a popup read once the busy read is done, oldest first
 *
 * In a popup burst the ticks follow the share's frames (`requestVideoFrameCallback`, M141), with
 * the `BURST_TICK_MS` timer as a backstop: a window that does not repaint sends no frames.
 *
 * Outside a burst the tick interval floats inside the preset's range, and the optional reads follow
 * the machine's load (`pace.ts`, M142): the session feeds the controller every tick (did the
 * signature change since the last one, what screen was last read), every timer tick's lateness,
 * every read's time, every backlog overflow and the share's delivered frames, and tells the caller
 * the environment every `ENV_PERIOD_MS` and whenever the load level moves (`onEnv`).
 *
 * The caller (M104's UI) applies the events to the run and supplies what the reading needs
 * through `context()`, read fresh on every frame so candidates follow the run.
 */
import type { CaptureLayout } from '../../core/schema.ts';
import { captureLayoutSchema } from '../../core/schema.ts';
import {
  emptyBacklog,
  popupBox,
  admit,
  motionSince,
  popupPart,
  popupRegionIndices,
  push,
  readStarted,
  take,
  type Backlog,
} from './backlog.ts';
import { changed, isBlack, signatureOf, watchedRegions } from './change.ts';
import {
  initialPace,
  leanReads,
  paceDrop,
  paceFrame,
  paceLateness,
  paceRead,
  isLoadSample,
  paceStats,
  paceTick,
  refreshFor,
  withRange,
  type IntervalRange,
  type LoadLevel,
  type PaceState,
} from './pace.ts';
import {
  decide,
  fastTicks,
  finished,
  FRAME_RATE,
  INITIAL_LOOP,
  outcomeOf,
  queuedPopup,
  READ_INTERVALS,
  tickDelay,
  type LoopState,
  type ReadMode,
} from './loop.ts';
import { IconRefs } from './icon-refs.ts';
import { prepareSlot, type IconRef } from './match-icon.ts';
import type { SlotRanking } from './fusion.ts';
import { chipTiers } from './tier-chip.ts';
import { createOcrEngine, type OcrEngine } from './ocr-engine.ts';
import { pixelRect, toPnm, type PixelRect, type Region } from './preprocess.ts';
import { readFrame, type RegionReader } from './read-frame.ts';
import { drawScaled, PREVIEW_QUALITY, SnapshotFrame } from './snapshot.ts';
import {
  ENV_PERIOD_MS,
  type CaptureError,
  type CaptureGeometry,
  type CaptureStats,
  type EnvReport,
  type ReadReport,
  type SessionOptions,
} from './session-types.ts';
import { TickScheduler } from './tick-scheduler.ts';
import { INITIAL_TRACKER, trackFrame, type Frame, type TrackerState } from './tracker.ts';
import { layoutInFrame, titleBarHeight, titleBarRows } from './window-frame.ts';

// The session's API, as before M167 split the types, the pictures, the icons and the ticks out.
export { ENV_PERIOD_MS } from './session-types.ts';
export type {
  CaptureContext,
  CaptureError,
  CaptureGeometry,
  CaptureStats,
  CaptureStatus,
  EnvReport,
  ReadReport,
  SessionOptions,
  TickReport,
} from './session-types.ts';
export type { FrameSource } from './snapshot.ts';

/** The OCR engine rejected a call (M154): the session cannot read on, and stops with `engine`. */
class EngineFailure extends Error {}

/** A popup waiting in the backlog (M141): the crop of its box, and how to read it back. */
interface QueuedShot {
  /** The crop, copied off the video when the tick saw it; null when the copy failed. */
  bitmap: Promise<ImageBitmap | null>;
  /** Where the crop sits in the picture, px. */
  box: PixelRect;
  /** The layout and picture size at the time: the regions are read where they were then. */
  layout: CaptureLayout;
  width: number;
  height: number;
  /** When it was taken: wall clock (the record's `t`) and `performance.now()` (its lag). */
  t: number;
  at: number;
}

/** One read for `readAndReport`: where the pixels come from and what the record says of it. */
interface ReadJob {
  t: number;
  started: number;
  reason: ReadReport['reason'];
  mode: ReadMode;
  queued?: ReadReport['queued'];
  layout: CaptureLayout;
  width: number;
  height: number;
  /** A region's pixel rectangle in the picture, and its RGBA. */
  pixelsOf: (region: Region) => { rect: PixelRect; data: Uint8ClampedArray };
  /** The read's picture for the diagnostics, when they keep pictures; null when there is none. */
  picture: () => SnapshotFrame | null;
}

/** The small copy the signature is taken on: wide enough to see a popup appear, cheap to read back. */
const PREVIEW_WIDTH = 480;

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export class CaptureSession {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  /** When the session ticks (M139, M141, M142): the timer, the frame booking and the frame watch. */
  private readonly ticks: TickScheduler;
  /** Popups seen while a read was busy, waiting for their read (M141). */
  private backlog: Backlog<QueuedShot> = emptyBacklog();
  /** `stats.queueDropped` as last told in a read report. */
  private droppedTold = 0;
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
  /** Icon references by gift, loaded once each; a failed one is dropped after `REF_RETRY_MS` (M154). */
  private refs = new IconRefs();
  /** The fusion screen ring's rankings by what each slot showed (M175, `ReadContext.ringMemo`). */
  private ringMemo = new Map<string, SlotRanking>();
  /** The tick interval and load level (M142). */
  private pace: PaceState;
  /** The previous tick's signature: what moved since then pulls the interval in (M142). */
  private signatureBefore: Uint8Array | null = null;
  /** When the signature last moved from one tick to the next (M153): how long the screen held still. */
  private movedAt = 0;
  /** The popup part of the two frames before this one, oldest first: is it animating (M142)? */
  private popupTicks: [Uint8Array | null, Uint8Array | null] = [null, null];
  /** The read in flight is of a change or a queued popup, not a re-read of a known screen (M142). */
  private readingChange = false;
  /** Since when the popup region has been moving frame to frame (`motionSince`, M142); null: still. */
  private movingSince: number | null = null;
  /** The screen the last read named — popups come on some (`popupProne`). */
  private lastScreen: Frame['screen'] = null;
  /** When the environment was last told, the level it said, and the overflow count it had. */
  private envAt = -Infinity;
  private levelTold: LoadLevel = 0;
  private droppedEnvTold = 0;
  // Reused every tick: a fresh canvas per frame would also throw away the read-back hint.
  private previewCanvas = document.createElement('canvas');
  private snapshotCanvas = document.createElement('canvas');
  /** Where a queued popup's crop is drawn to be read (M141). */
  private queueCanvas = document.createElement('canvas');
  private stopped = false;
  readonly stats: CaptureStats = { ticks: 0, reads: 0, queued: 0, queueDropped: 0 };

  constructor(private readonly options: SessionOptions) {
    this.pace = initialPace(options.interval ?? READ_INTERVALS.balanced, performance.now());
    this.ticks = new TickScheduler({
      video: () => this.video,
      stream: () => this.stream,
      stopped: () => this.stopped,
      loop: () => this.loop,
      pace: () => this.pace,
      late: (now, lateMs) => this.setPace(paceLateness(this.pace, now, lateMs)),
      frame: (intervalMs) => {
        this.pace = paceFrame(this.pace, performance.now(), intervalMs);
      },
      tick: () => void this.tick(),
    });
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
        video: { frameRate: { ideal: FRAME_RATE.idle } },
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
    this.pace = initialPace(this.pace.range, performance.now());
    this.envAt = performance.now();
    this.ticks.watchFrames();
    this.ticks.schedule(this.pace.interval);
    this.options.onStatus('running');
  }

  /** Change the preset's range while running (M142): the interval starts again at its `min`. */
  setInterval(range: IntervalRange): void {
    const now = performance.now();
    this.pace = withRange(this.pace, range, now);
    if (!this.ticks.booked) return;
    this.ticks.schedule(tickDelay(this.loop, now, this.pace.interval));
  }

  /** The load level now (M142). */
  get level(): LoadLevel {
    return this.pace.level;
  }

  /** Fold a pace update; a level that moved is told at once (M142). */
  private setPace(next: PaceState): void {
    this.pace = next;
    if (next.level !== this.levelTold) {
      this.levelTold = next.level;
      this.tellEnv('level');
    }
  }

  /** The environment to the caller (M142). */
  private tellEnv(reason: EnvReport['reason']): void {
    const now = performance.now();
    this.envAt = now;
    if (!this.options.onEnv) return;
    const stats = paceStats(this.pace, now);
    const settings = this.stream?.getVideoTracks()[0]?.getSettings?.();
    const dropped = this.stats.queueDropped - this.droppedEnvTold;
    this.droppedEnvTold = this.stats.queueDropped;
    this.options.onEnv({
      t: Date.now(),
      reason,
      fps: {
        requested: this.ticks.requestedFps,
        delivered: stats.deliveredFps,
        setting: typeof settings?.frameRate === 'number' ? settings.frameRate : null,
      },
      stats,
      queueDropped: dropped,
      range: this.pace.range,
      interval: this.pace.interval,
      level: this.pace.level,
    });
  }

  /** Stop sharing and release everything. Safe to call twice. */
  stop(): void {
    this.stopped = true;
    this.ticks.stop();
    for (const entry of this.backlog.entries) release(entry.payload);
    this.backlog = emptyBacklog();
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
    this.ticks.followBurst();
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
    // A fade through black between sections (M153): not read, and the screen after it reads at once.
    const black = isBlack(signature);
    const now = performance.now();
    // The interval follows what moves (M142): a change since the last tick, not since the last read.
    const moved = changed(this.signatureBefore, signature);
    this.signatureBefore = signature;
    this.setPace(
      paceTick(this.pace, {
        now,
        changed: moved,
        burst: fastTicks(this.loop, now),
        unread:
          isChanged ||
          (this.loop.busy && this.readingChange) ||
          this.loop.dirty ||
          this.loop.dark ||
          this.backlog.entries.length > 0,
        screen: this.lastScreen,
      }),
    );
    if (now - this.envAt >= (this.options.envPeriodMs ?? ENV_PERIOD_MS)) this.tellEnv('periodic');
    const layout = this.frameLayout;
    const indices = layout ? popupRegionIndices(this.regions, layout) : [];
    const popupNow = popupPart(signature, indices);
    // Motion is told frame to frame (`animating`): a second look at the same frame is left out.
    if (this.ticks.newFrame()) {
      const [before, previous] = this.popupTicks;
      this.popupTicks = [previous, popupNow];
      this.movingSince = motionSince(this.movingSince, before, previous, popupNow, now);
    }
    // The popup's regions settled on something new: no hold keeps it waiting (M142).
    const urgent =
      this.movingSince === null &&
      changed(this.loop.lastRead ? popupPart(this.loop.lastRead, indices) : null, popupNow);
    if (moved) this.movedAt = now;
    const step = decide(this.loop, signature, isChanged, now, refreshFor(this.pace.level), urgent, {
      black,
      stillMs: now - this.movedAt,
      // The screen under a popup burst is news until the player is known to be in a shop (M159).
      settle: this.tracker.inShop !== true,
    });
    this.loop = step.state;
    this.ticks.rebook();
    const busy = step.decision === 'skip' && step.state.busy;
    this.reportTick(step.decision === 'read', busy, isChanged);
    // A black popup region shows no popup: nothing to queue.
    if (busy && !black) this.queueShot(video, popupNow, width, height);
    if (step.decision === 'skip') return;
    // The ticks under this read queue what differs from its frame (M147, `readStarted`).
    this.backlog = readStarted(this.backlog, popupNow);
    const started = performance.now();
    let frame: Frame | null = null;
    try {
      // A read of a change (or of the backlog) is of a screen not known yet; a re-read is not.
      this.readingChange = step.reason !== 'refresh';
      frame = await this.read(video, width, height, step.reason, step.mode, started);
    } catch (error) {
      this.readFailed(error);
    } finally {
      this.settle(frame, started, step.mode);
      // The popups that came meanwhile, before the loop is free again (M141).
      await this.drain();
    }
  }

  /**
   * A read threw. An OCR call that failed (the worker died, M154) leaves nothing to read with: the
   * session stops with `engine` rather than run on as if reading. Anything else is not the engine's
   * and goes on as an error of the page.
   */
  private readFailed(error: unknown): void {
    if (!(error instanceof EngineFailure)) throw error;
    if (!this.stopped) this.fail('engine');
  }

  /**
   * A read is done (`started` its start): count it and fold what it found into the loop — a popup
   * starts or extends the burst (M136), and the ticks follow (M139).
   */
  private settle(frame: Frame | null, started: number, mode: ReadMode): void {
    const now = performance.now();
    this.stats.reads += 1;
    if (isLoadSample(mode, frame?.partial === true))
      this.setPace(paceRead(this.pace, now, mode, now - started));
    // A popup read that found nothing says nothing of the screen; any other read names it, or none.
    if (frame && !frame.partial) this.lastScreen = frame.screen;
    // A moving screen of nothing is read again at the range's slow end (M142), later the longer it
    // goes on (M153); a map read short of its floor or pack is read again soon (M148).
    this.loop = finished(
      this.loop,
      frame ? outcomeOf(frame, performance.now(), this.pace.range.max) : undefined,
    );
    this.ticks.followBurst();
  }

  /**
   * A tick skipped for a busy read (M141): when the popup's regions differ from the last frame taken
   * care of (the busy read's, until something else is queued — M147), copy the popup's box off the
   * video — that crop alone, not the frame — and queue it for a popup read. Without
   * `createImageBitmap` nothing is queued.
   */
  private queueShot(video: HTMLVideoElement, shot: Uint8Array, width: number, height: number): void {
    const layout = this.frameLayout;
    if (!layout || typeof createImageBitmap !== 'function') return;
    // A popup region in motion (a battle) queues a tick or two and no more (M142, `admit`).
    const since = this.movingSince;
    const admitted = admit(
      this.backlog,
      this.loop.busy,
      shot,
      since === null ? null : performance.now() - since,
    );
    if (!admitted.queue) return;
    const box = pixelRect(width, height, popupBox(layout, this.options.context().startOpen));
    if (box.width === 0 || box.height === 0) return;
    const bitmap = createImageBitmap(video, box.left, box.top, box.width, box.height).catch(() => null);
    const pushed = push(
      this.backlog,
      shot,
      { bitmap, box, layout, width, height, t: Date.now(), at: performance.now() },
      admitted.moving,
    );
    this.backlog = pushed.backlog;
    // The popups clicked through after it are ticked on frame by frame (M142).
    this.loop = queuedPopup(this.loop, performance.now());
    this.ticks.followBurst();
    if (pushed.evicted) {
      this.stats.queueDropped += 1;
      this.setPace(paceDrop(this.pace, performance.now()));
      release(pushed.evicted);
    }
  }

  /**
   * Read the queued popups, oldest first (M141), each as a popup read of its crop, through the same
   * path as any read. The loop stays busy meanwhile, so the ticks go on queueing; it is free once
   * the queue is empty. A popup found extends the burst like any other.
   */
  private async drain(): Promise<void> {
    while (!this.stopped) {
      const next = take(this.backlog);
      if (!next.entry) return;
      this.backlog = next.backlog;
      const shot = next.entry.payload;
      // Busy again (`finished` only folds a busy loop): no tick starts a read under this one.
      this.loop = { ...this.loop, busy: true };
      this.readingChange = true;
      const started = performance.now();
      let frame: Frame | null = null;
      try {
        frame = await this.readQueued(shot, started);
      } catch (error) {
        this.readFailed(error);
      } finally {
        this.stats.queued += 1;
        this.settle(frame, started, 'popup');
      }
    }
  }

  /** One queued popup: its crop drawn once, its regions read where they sat in the picture. */
  private async readQueued(shot: QueuedShot, started: number): Promise<Frame | null> {
    const bitmap = await shot.bitmap;
    if (!bitmap || this.stopped) {
      bitmap?.close();
      return null;
    }
    const { box } = shot;
    const canvas = this.queueCanvas;
    if (canvas.width !== box.width) canvas.width = box.width;
    if (canvas.height !== box.height) canvas.height = box.height;
    const crop = canvas.getContext('2d', { willReadFrequently: true })!;
    crop.drawImage(bitmap, 0, 0);
    bitmap.close();
    return this.readAndReport({
      t: shot.t,
      started,
      reason: 'change',
      mode: 'popup',
      queued: { lagMs: started - shot.at },
      layout: shot.layout,
      width: shot.width,
      height: shot.height,
      // In the picture's coordinates, as the layout says; a region outside the box reads blank.
      pixelsOf: (region) => {
        const rect = pixelRect(shot.width, shot.height, region);
        const data =
          rect.width > 0 && rect.height > 0
            ? crop.getImageData(rect.left - box.left, rect.top - box.top, rect.width, rect.height).data
            : new Uint8ClampedArray(0);
        return { rect, data };
      },
      // A crop is no picture the diagnostics can re-read with the layout; the filmstrip has the ticks.
      picture: () => null,
    });
  }

  private read(
    video: HTMLVideoElement,
    width: number,
    height: number,
    reason: ReadReport['reason'],
    mode: ReadMode,
    started: number,
  ): Promise<Frame | null> {
    // One snapshot per read: the reading takes several OCR calls, and the screen must not change
    // under them. Only the regions the reading asks for come back off the canvas (M116) — a read
    // that stops at the popup's title touches one strip, not the 1920×1009 frame.
    const t = Date.now();
    const canvas = this.snapshotCanvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const snapshot = canvas.getContext('2d', { willReadFrequently: true })!;
    snapshot.drawImage(video, 0, 0, width, height);
    return this.readAndReport({
      t,
      started,
      reason,
      mode,
      layout: this.placeLayout(snapshot, width, height),
      width,
      height,
      pixelsOf: (region) => {
        const rect = pixelRect(width, height, region);
        const data =
          rect.width > 0 && rect.height > 0
            ? snapshot.getImageData(rect.left, rect.top, rect.width, rect.height).data
            : new Uint8ClampedArray(0);
        return { rect, data };
      },
      picture: () => new SnapshotFrame(canvas),
    });
  }

  /** Read a job's pixels, fold the frame into the tracker, and hand on the report and the events. */
  private async readAndReport(job: ReadJob): Promise<Frame | null> {
    const engine = this.engine!;
    const { width, height, pixelsOf } = job;
    const ctx = this.options.context();
    const reader: RegionReader = {
      ocr: async (region, pass) => {
        const { rect, data } = pixelsOf(region);
        return engine.recognize(toPnm(data, rect.width, rect.height, pass)).catch((error: unknown) => {
          throw new EngineFailure(String(error));
        });
      },
      slot: async (region) => {
        const { rect, data } = pixelsOf(region);
        return prepareSlot(data, width, height, region, rect);
      },
      tier: async (region) => {
        const { rect, data } = pixelsOf(region);
        return chipTiers(data, width, height, region, rect);
      },
    };
    const refsOf = async (ids: readonly number[]) =>
      (await Promise.all(ids.map((id) => this.refs.get(id, ctx.iconUrl)))).filter(
        (r): r is IconRef => r !== null,
      );
    const [held, materials] = await Promise.all([refsOf(ctx.held), refsOf(ctx.materials)]);
    const { frame, ocrCalls, trace } = await readFrame(reader, job.layout, {
      lang: ctx.lang,
      packs: ctx.packs,
      gifts: ctx.gifts,
      held,
      materials,
      // A sale is matched by the ids, not by the icons that loaded (M154).
      heldIds: ctx.held,
      materialIds: ctx.materials,
      tiers: ctx.tiers,
      startOpen: ctx.startOpen,
      popupOnly: job.mode === 'popup',
      // The confirm's slots alone, no OCR, while its icons slide in (M159).
      ...(job.mode === 'slots' && this.loop.slots
        ? { slotsOnly: this.loop.slots.filled, slotsShape: this.loop.slots.shape }
        : {}),
      // Rung (ii) of the load ladder (M142): an unneeded raw pass, on a strained machine only.
      lean: leanReads(this.pace.level),
      // A popup's icon, when its name is no sure match (M136): a handful of gifts, loaded once each.
      iconRefs: refsOf,
      // The fusion screen ring's rankings, kept while its slots show the same (M175).
      ringMemo: this.ringMemo,
    });
    if (this.stopped) return null;
    const out = trackFrame(this.tracker, frame);
    this.tracker = out.state;
    // Nothing waits from here on (M116): a Stop pressed now cannot land between the check above
    // and the events, and the events never wait for a picture.
    const picture = this.options.onRead && this.options.wantImage?.() ? job.picture() : null;
    const dropped = this.stats.queueDropped - this.droppedTold;
    this.droppedTold = this.stats.queueDropped;
    this.options.onRead?.(
      {
        t: job.t,
        reason: job.reason,
        mode: job.mode,
        ...(job.queued ? { queued: job.queued } : {}),
        ...(dropped > 0 ? { queueDropped: dropped } : {}),
        ms: performance.now() - job.started,
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
}

/** Free a queued popup's crop, once it is copied. */
function release(shot: QueuedShot): void {
  void shot.bitmap.then((bitmap) => bitmap?.close());
}
