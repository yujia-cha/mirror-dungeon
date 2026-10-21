/**
 * When the session ticks (M139, M141, M142, M154), split out of `session.ts` in M167: the one
 * booked timer tick, the same tick on the share's next frame in a popup burst, the share's frame
 * rate, and the passive frame watch. The session stays the owner of the loop and the pace; the
 * scheduler reads them through `host` and tells the session what it saw.
 */
import { BURST_TICK_MS, fastTicks, FRAME_RATE, tickDelay, type LoopState } from './loop.ts';
import { followFrames, type PaceState } from './pace.ts';

/** The frame watch is trusted to tell new frames apart only this long after its last callback. */
const FRAME_WATCH_STALE_MS = 500;

/** What the scheduler reads of the session, and what it tells it. */
export interface TickHost {
  video: () => HTMLVideoElement | null;
  stream: () => MediaStream | null;
  stopped: () => boolean;
  loop: () => LoopState;
  pace: () => PaceState;
  /** A timer tick fired at `now`, `lateMs` after it was due (M142). */
  late: (now: number, lateMs: number) => void;
  /** The share presented a frame `intervalMs` after the one before (M142). */
  frame: (intervalMs: number) => void;
  tick: () => void;
}

export class TickScheduler {
  /** The next tick (M139: one at a time, so a popup burst can bring it in). */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When that tick is due, `performance.now()` time. */
  private timerDue = 0;
  /** In a popup burst, the same tick on the share's next frame (M141) — whichever comes first. */
  private frameRequest: number | null = null;
  /** The share runs at `FRAME_RATE.burst` (M139). */
  private fastFrames = false;
  /** The share's frame rate last asked for. */
  requestedFps: number = FRAME_RATE.idle;
  /** The passive frame watch (M142): its request, and the frame before. */
  private frameWatch: number | null = null;
  private lastFrame: { at: number; count: number; seen: number } | null = null;
  /** The frame count the last tick saw (`lastFrame.count`), to tell a new frame from a second look. */
  private tickedFrame = -1;

  constructor(private readonly host: TickHost) {}

  /** A tick is booked (the session is running). */
  get booked(): boolean {
    return this.timer !== null;
  }

  /**
   * Count the share's frames as they are presented (M142), for the delivered rate: one callback per
   * frame, nothing else done in it. Where the browser has no `requestVideoFrameCallback` the rate
   * is the track's setting alone.
   */
  watchFrames(): void {
    const video = this.host.video();
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    const onFrame = (now: number, meta: VideoFrameCallbackMetadata): void => {
      this.frameWatch = null;
      if (this.host.stopped() || this.host.video() !== video) return;
      const count = meta.presentedFrames;
      if (this.lastFrame && count > this.lastFrame.count)
        this.host.frame((now - this.lastFrame.at) / (count - this.lastFrame.count));
      this.lastFrame = { at: now, count, seen: performance.now() };
      this.frameWatch = video.requestVideoFrameCallback(onFrame);
    };
    this.frameWatch = video.requestVideoFrameCallback(onFrame);
  }

  /**
   * The next tick, `delay` from now (M139). Each tick books the one after it before it runs, at the
   * preset's interval or, in a popup burst, `BURST_TICK_MS` — a fixed `setInterval` could not speed
   * up for the burst. A tick that comes while a read is still running marks the loop dirty and may
   * queue the popup it sees (`queueShot`, M141).
   *
   * In a burst the tick is also booked on the share's next frame (M141, `bookFrame`), so a popup
   * shown for a frame or two is ticked on; the timer stays as the backstop — a window that does not
   * repaint sends no frames, and the burst's re-read and its end must still come. Whichever fires
   * first cancels the other (`fire`).
   */
  schedule(delay: number): void {
    if (this.host.stopped()) return;
    this.cancelTick();
    this.timerDue = performance.now() + delay;
    this.timer = setTimeout(() => this.fire(true), delay);
    // While popups may come (the interval at the range's `min`, M142) or ticks are fast, the share's
    // next frame brings the tick too: no frame that arrives goes by unseen.
    if (fastTicks(this.host.loop(), performance.now()) || followFrames(this.host.pace())) this.bookFrame();
  }

  /**
   * Whether this tick sees a frame the last tick did not (M142), from the frame watch's count. Where
   * the watch is missing or has gone quiet (`FRAME_WATCH_STALE_MS` — a hidden tab may stop the
   * callbacks while frames still come), every tick counts as a new frame, as before M142.
   */
  newFrame(): boolean {
    const frame = this.lastFrame;
    if (!frame || performance.now() - frame.seen > FRAME_WATCH_STALE_MS) return true;
    if (frame.count === this.tickedFrame) return false;
    this.tickedFrame = frame.count;
    return true;
  }

  /** The booked tick on the share's next frame, where the browser has the API (M141). */
  private bookFrame(): void {
    const video = this.host.video();
    if (this.frameRequest !== null || !video || typeof video.requestVideoFrameCallback !== 'function') return;
    this.frameRequest = video.requestVideoFrameCallback(() => {
      this.frameRequest = null;
      this.fire(false);
    });
  }

  /**
   * The booked tick is due: book the next, then tick. A timer tick tells how late it fired (M142) —
   * the page's thread was busy that long; a frame tick has no due time. The booking is from the
   * state before the tick; the tick books again once it has decided (`rebook`, M154).
   */
  private fire(timer: boolean): void {
    const now = performance.now();
    if (timer) this.host.late(now, now - this.timerDue);
    this.cancelTick();
    this.schedule(tickDelay(this.host.loop(), now, this.host.pace().interval));
    this.host.tick();
  }

  /**
   * After a tick decided (M154): book again from what it changed. A change that pulled the interval
   * in to the range's `min`, a black frame that made the ticks fast (`TRANSITION_TICKS_MS`), a
   * burst just begun — the booking `fire` made before the tick still had the old interval (a
   * second on economy's still map) and the old frame-following, so a popup shown under the read
   * this tick started could pass untouched. A timer due later than the new delay is brought in;
   * a tick that now follows the frames books the next frame too; the share's rate follows.
   */
  rebook(): void {
    if (this.host.stopped() || this.timer === null) return;
    const now = performance.now();
    const delay = tickDelay(this.host.loop(), now, this.host.pace().interval);
    if (this.timerDue - now > delay) this.schedule(delay);
    else if (fastTicks(this.host.loop(), now) || followFrames(this.host.pace())) this.bookFrame();
    this.followBurst();
  }

  /** Cancel the booked tick, both its timer and its frame. */
  private cancelTick(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.frameRequest !== null) this.host.video()?.cancelVideoFrameCallback?.(this.frameRequest);
    this.frameRequest = null;
  }

  /**
   * Follow the popup burst (M139): a burst just begun brings the next tick in to `BURST_TICK_MS`
   * — and to the share's next frame (M141) — and raises the share's frame rate; once it is over the
   * rate goes back down. A popup just queued under a busy read does the same (M142, `fastTicks`).
   */
  followBurst(): void {
    const now = performance.now();
    const burst = fastTicks(this.host.loop(), now);
    if (burst !== this.fastFrames) {
      this.fastFrames = burst;
      this.requestedFps = burst ? FRAME_RATE.burst : FRAME_RATE.idle;
      const track = this.host.stream()?.getVideoTracks()[0];
      // Not every track takes a new rate (a canvas stream in the e2e); reading goes on either way.
      void track?.applyConstraints?.({ frameRate: { ideal: this.requestedFps } }).catch(() => undefined);
    }
    if (!burst || this.timer === null) return;
    if (this.timerDue - now > BURST_TICK_MS) this.schedule(BURST_TICK_MS);
    else this.bookFrame();
  }

  /** Cancel the booked tick and the frame watch (the session is stopping). */
  stop(): void {
    this.cancelTick();
    if (this.frameWatch !== null) this.host.video()?.cancelVideoFrameCallback?.(this.frameWatch);
    this.frameWatch = null;
  }
}
