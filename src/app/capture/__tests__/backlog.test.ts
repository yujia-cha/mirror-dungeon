import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureLayoutSchema } from '../../../core/schema.ts';
import {
  BACKLOG_MAX,
  emptyBacklog,
  popupBox,
  popupPart,
  popupRegionIndices,
  push,
  shouldQueue,
  take,
  type Backlog,
} from '../backlog.ts';
import { PATCH_H, PATCH_W, watchedRegions } from '../change.ts';

const PATCH = PATCH_W * PATCH_H;
const LAYOUT = captureLayoutSchema.parse(JSON.parse(readFileSync('public/data/capture-layout.json', 'utf8')));

/** A one-patch signature of one grey level; levels far apart count as changed. */
const sig = (level: number) => new Uint8Array(PATCH).fill(level);
const READING = sig(0);

/** Push `levels` in order as a busy tick would: only what `shouldQueue` lets in. */
function feed(levels: readonly number[], start: Backlog<number> = emptyBacklog()): Backlog<number> {
  let backlog = start;
  for (const level of levels)
    if (shouldQueue(backlog, true, READING, sig(level))) backlog = push(backlog, sig(level), level).backlog;
  return backlog;
}

describe('shouldQueue', () => {
  it('queues nothing when no read is busy', () => {
    // Arrange
    const backlog = emptyBacklog<number>();
    // Act
    const queued = shouldQueue(backlog, false, READING, sig(100));
    // Assert
    expect(queued).toBe(false);
  });

  it('queues a popup only once while it stands still', () => {
    // Act
    const backlog = feed([100, 100, 100]);
    // Assert
    expect(backlog.entries.map((e) => e.payload)).toEqual([100]);
  });

  it('queues nothing that looks like what the busy read is reading', () => {
    // Act: a popup, clicked away back to the screen under the read, then the next popup.
    const backlog = feed([100, 0, 200]);
    // Assert
    expect(backlog.entries.map((e) => e.payload)).toEqual([100, 200]);
  });

  it('queues a change just above the threshold and not one at it', () => {
    // Arrange: `changed` counts a mean difference above 6 per patch.
    const after = feed([100]);
    // Act + Assert
    expect(shouldQueue(after, true, READING, sig(106))).toBe(false);
    expect(shouldQueue(after, true, READING, sig(107))).toBe(true);
  });
});

describe('push and take', () => {
  it('keeps the newest BACKLOG_MAX, dropping the oldest and counting them', () => {
    // Arrange: two more distinct popups than the queue holds.
    const levels = Array.from({ length: BACKLOG_MAX + 2 }, (_, i) => 10 + i * 10);
    // Act
    const backlog = feed(levels);
    // Assert
    expect(backlog.entries).toHaveLength(BACKLOG_MAX);
    expect(backlog.entries[0]!.payload).toBe(30);
    expect(backlog.dropped).toBe(2);
  });

  it('hands the evicted payload back so the caller can free it', () => {
    // Arrange: a full queue.
    const full = feed(Array.from({ length: BACKLOG_MAX }, (_, i) => 10 + i * 10));
    // Act
    const { evicted } = push(full, sig(250), 250);
    // Assert
    expect(evicted).toBe(10);
  });

  it('takes the oldest first', () => {
    // Arrange
    let backlog = feed([100, 200, 50]);
    const order: number[] = [];
    // Act
    for (let next = take(backlog); next.entry; next = take(backlog)) {
      order.push(next.entry.payload);
      backlog = next.backlog;
    }
    // Assert
    expect(order).toEqual([100, 200, 50]);
    expect(backlog.entries).toEqual([]);
  });

  it('takes nothing from an empty queue', () => {
    // Arrange
    const backlog = emptyBacklog<number>();
    // Act
    const next = take(backlog);
    // Assert
    expect(next.entry).toBeNull();
    expect(next.backlog).toBe(backlog);
  });

  it('remembers the last popup once taken, so one still standing is not queued again', () => {
    // Arrange
    const drained = take(feed([100])).backlog;
    // Act + Assert
    expect(shouldQueue(drained, true, READING, sig(100))).toBe(false);
  });
});

describe('popup regions', () => {
  it('picks the acquired title and the popup name out of the watched regions', () => {
    // Arrange
    const regions = watchedRegions(LAYOUT);
    // Act
    const indices = popupRegionIndices(regions, LAYOUT);
    // Assert
    const acquired = LAYOUT.titles.find((t) => t.screens.includes('acquired'))!.region;
    expect(indices.map((i) => regions[i])).toEqual([acquired, LAYOUT.names.popup]);
  });

  it('cuts those patches out of a whole signature, in order', () => {
    // Arrange: three regions' patches, levels 1, 2, 3.
    const whole = new Uint8Array([...sig(1), ...sig(2), ...sig(3)]);
    // Act
    const part = popupPart(whole, [2, 0]);
    // Assert
    expect([...part]).toEqual([...sig(3), ...sig(1)]);
  });

  it('boxes the title, name and icon — and the observation title while the run start is open', () => {
    // Act
    const closed = popupBox(LAYOUT, false);
    const open = popupBox(LAYOUT, true);
    // Assert: every region read by a popup read lies inside its box.
    const inside = (box: readonly number[], r: readonly number[]) =>
      r[0]! >= box[0]! - 1e-9 &&
      r[1]! >= box[1]! - 1e-9 &&
      r[0]! + r[2]! <= box[0]! + box[2]! + 1e-9 &&
      r[1]! + r[3]! <= box[1]! + box[3]! + 1e-9;
    const acquired = LAYOUT.titles.find((t) => t.screens.includes('acquired'))!.region;
    const observation = LAYOUT.titles.find((t) => t.screens.includes('observationSelect'))!.region;
    for (const r of [acquired, LAYOUT.names.popup, LAYOUT.popupIcon]) expect(inside(closed, r)).toBe(true);
    expect(inside(closed, observation)).toBe(false);
    expect(inside(open, observation)).toBe(true);
    // Well short of the frame: the copy is a crop, not the picture.
    expect(closed[2]! * closed[3]!).toBeLessThan(0.25);
  });
});
