/**
 * The session's types (M103–M154), split out of `session.ts` in M167: what a session is given
 * (`SessionOptions`, `CaptureContext`) and what it reports (reads, ticks, geometry, environment).
 */
import type { DiagTraceStep } from '../../core/schema.ts';
import type { Lang } from '../i18n.ts';
import type { IntervalRange, LoadLevel, PaceStats } from './pace.ts';
import type { ReadMode, ReadReason } from './loop.ts';
import type { NameCandidate } from './match-name.ts';
import type { FrameSource } from './snapshot.ts';
import type { CaptureEvent, Frame } from './tracker.ts';

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
  /** Every gift's tier, for the fusion slots' numerals (M152). */
  tiers?: ReadonlyMap<number, number | null>;
  /** The picture URL of a gift's game icon, or null. */
  iconUrl: (giftId: number) => string | null;
  /** The run start is open: look for its pickers (M135). */
  startOpen: boolean;
}

export interface CaptureStats {
  ticks: number;
  reads: number;
  /** Reads of popups queued while a read was busy (M141), and queued popups pushed out unread. */
  queued: number;
  queueDropped: number;
}

/** One read, as the owner's diagnostics keep it (M112). */
export interface ReadReport {
  /** Wall-clock time of the read's start, ms. */
  t: number;
  /** Why the loop read it (`decide`, M154). */
  reason: ReadReason;
  /** A full read, or a popup read of the popup burst (M136) — every queued read is one. */
  mode: ReadMode;
  /**
   * A read of a popup queued while a read was busy (M141): `t` is when it was snapshotted, `lagMs`
   * how long it waited for the read to start.
   */
  queued?: { lagMs: number };
  /** Queued popups pushed out unread since the read before this one (M141); omitted when none. */
  queueDropped?: number;
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

/**
 * The environment the reader runs in (M142), told every `ENV_PERIOD_MS` and when the load level
 * moves: what the share delivers against what was asked, how late the timer ticks fire, what reads
 * cost, how often the backlog overflowed, and where the controller stands.
 */
export interface EnvReport {
  /** Wall-clock time, ms. */
  t: number;
  reason: 'periodic' | 'level';
  fps: {
    /** The rate last asked of the share (`FRAME_RATE`). */
    requested: number;
    /** As delivered, from the frames' callbacks; null where the browser does not say. */
    delivered: number | null;
    /** What the track says it runs at (`getSettings`), or null. */
    setting: number | null;
  };
  stats: PaceStats;
  /** Queued popups pushed out unread since the report before. */
  queueDropped: number;
  range: IntervalRange;
  interval: number;
  level: LoadLevel;
}

/** How often the environment is told while nothing else moves it. */
export const ENV_PERIOD_MS = 10_000;

export interface SessionOptions {
  /** The preset's range (M142); the tick interval floats inside it. */
  interval?: IntervalRange;
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
  /** The environment (M142): every `ENV_PERIOD_MS`, and when the load level moves. */
  onEnv?: (env: EnvReport) => void;
  /** How often the environment is told (default `ENV_PERIOD_MS`; tests shorten it). */
  envPeriodMs?: number;
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
