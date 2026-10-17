/**
 * Popups that came while a read was busy, waiting for a popup read of their own (M141).
 *
 * A read takes a snapshot when it starts and reads only that, and while it runs the loop skips
 * ticks (`decide`, `loop.ts`). So a popup shorter than a read was structurally missed: on the
 * owner's third session the observation 「프레스티지 카드」 stood 42.57–42.84 s, entirely under a
 * full read of a confirm dialog that ran 42.31–43.17 s. Now a tick skipped for a busy read whose
 * popup regions differ from the last snapshot queued — and from what the busy read is reading —
 * snapshots just the popup's box, and once the read is done the session reads the queue oldest
 * first, each as a popup read (`popupOnly`), before the loop is free again. The tracker sees the
 * frames in the order they were on screen: the busy read's snapshot, then the queue.
 *
 * Only the popup's regions count (`popupPart`): a queued read sees nothing else, so a change
 * elsewhere (an animated background, the map scrolling) would queue reads that can only find what
 * the busy read already saw — and at 30 frames a second in a burst they would never drain.
 *
 * At most `BACKLOG_MAX` wait; past it the oldest goes and `dropped` says so.
 *
 * Pure: the caller owns the clock and the pixels — a queued entry carries an opaque payload.
 */
import type { CaptureLayout } from '../../core/schema.ts';
import { changed, PATCH_H, PATCH_W } from './change.ts';
import type { Region } from './preprocess.ts';

/** Snapshots waiting at most; a 30 fps burst under one 860 ms read is 26 frames, few of them new. */
export const BACKLOG_MAX = 16;

export interface Queued<T> {
  /** The popup part of the tick's signature (`popupPart`). */
  signature: Uint8Array;
  payload: T;
}

export interface Backlog<T> {
  /** Oldest first. */
  entries: readonly Queued<T>[];
  /** The signature last pushed — still there once it is taken, so a popup standing still is queued once. */
  last: Uint8Array | null;
  /** Entries pushed out by newer ones past `BACKLOG_MAX`. */
  dropped: number;
}

export function emptyBacklog<T>(): Backlog<T> {
  return { entries: [], last: null, dropped: 0 };
}

/**
 * Whether a tick's frame goes in the queue: a read is busy, and the popup part of its signature
 * differs from the last one pushed and from the busy read's (`reading`, the popup part of
 * `loop.lastRead`). A popup clicked away to what the read is reading queues nothing.
 */
export function shouldQueue<T>(
  backlog: Backlog<T>,
  busy: boolean,
  reading: Uint8Array | null,
  signature: Uint8Array,
): boolean {
  return busy && changed(backlog.last, signature) && changed(reading, signature);
}

/** Queue a snapshot. Past `BACKLOG_MAX` the oldest goes: `evicted`, for the caller to free. */
export function push<T>(
  backlog: Backlog<T>,
  signature: Uint8Array,
  payload: T,
): { backlog: Backlog<T>; evicted: T | null } {
  const entries = [...backlog.entries, { signature, payload }];
  const evicted = entries.length > BACKLOG_MAX ? entries.shift()!.payload : null;
  return {
    backlog: { entries, last: signature, dropped: backlog.dropped + (evicted === null ? 0 : 1) },
    evicted,
  };
}

/** The oldest snapshot waiting, or null when none does. */
export function take<T>(backlog: Backlog<T>): { backlog: Backlog<T>; entry: Queued<T> | null } {
  const [entry, ...rest] = backlog.entries;
  if (!entry) return { backlog, entry: null };
  return { backlog: { ...backlog, entries: rest }, entry };
}

/**
 * Where the popup's regions sit among the watched regions (`watchedRegions`): the acquired title
 * and the popup's name. Indices into `regions`, in order.
 */
export function popupRegionIndices(regions: readonly Region[], layout: CaptureLayout): number[] {
  const popup = [
    ...layout.titles.filter((t) => t.screens.includes('acquired')).map((t) => t.region),
    layout.names.popup,
  ];
  const keys = new Set(popup.map((r) => r.join(',')));
  return regions.flatMap((r, i) => (keys.has(r.join(',')) ? [i] : []));
}

/** The patches of those regions out of a whole signature (`signatureOf` over the same regions). */
export function popupPart(signature: Uint8Array, indices: readonly number[]): Uint8Array {
  const patch = PATCH_W * PATCH_H;
  const out = new Uint8Array(indices.length * patch);
  indices.forEach((index, i) => out.set(signature.subarray(index * patch, (index + 1) * patch), i * patch));
  return out;
}

/**
 * The box a queued popup read needs, in the layout's fractions: the acquired title, the popup's
 * name and its icon — and, while the run start is open, the observation picker's title the popup
 * sits over (`overObservation`, M135: the missed 「프레스티지 카드」 was an observation).
 */
export function popupBox(layout: CaptureLayout, startOpen: boolean): Region {
  const regions: Region[] = [
    ...layout.titles
      .filter((t) => t.screens.includes('acquired') || (startOpen && t.screens.includes('observationSelect')))
      .map((t) => t.region),
    layout.names.popup,
    layout.popupIcon,
  ];
  const left = Math.min(...regions.map((r) => r[0]));
  const top = Math.min(...regions.map((r) => r[1]));
  const right = Math.max(...regions.map((r) => r[0] + r[2]));
  const bottom = Math.max(...regions.map((r) => r[1] + r[3]));
  return [left, top, right - left, bottom - top];
}
