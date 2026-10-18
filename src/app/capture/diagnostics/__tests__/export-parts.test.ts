import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { diagPartSchema, type DiagFrameClass } from '../../../../core/schema.ts';
import {
  downloadParts,
  exportOrder,
  PART_GAP_MS,
  PART_MAX_BYTES,
  partName,
  planExport,
  planParts,
  type ExportFrame,
  type PartFrame,
} from '../export-parts.ts';

const MB = 1024 * 1024;
const NAME = 'md-diagnostics-20261018-1430.zip';

const frame = (id: string, t: number, bytes: number, cls?: DiagFrameClass): PartFrame => ({
  id,
  t,
  bytes,
  ...(cls ? { class: cls } : {}),
});

/** A frame with real bytes behind it, so the zip's size can be measured. */
const real = (id: string, t: number, bytes: number, cls: DiagFrameClass = 'routine'): ExportFrame => ({
  ...frame(id, t, bytes, cls),
  blob: new Blob([new Uint8Array(bytes).fill(id.length)], { type: 'image/jpeg' }),
});

const ids = (parts: PartFrame[][]) => parts.map((p) => p.map((f) => f.id));

describe('PART_MAX_BYTES', () => {
  it('is 25 MB, under the 30 MB a Claude Code session accepts', () => {
    expect(PART_MAX_BYTES).toBe(25 * MB);
  });
});

describe('exportOrder', () => {
  it('puts evidence first, then unknown, sample, routine and preview, each by time', () => {
    // Arrange: an old frame with no class reads as routine.
    const frames = [
      frame('p1', 1, 10, 'preview'),
      frame('r2', 2, 10, 'routine'),
      frame('old', 1, 10),
      frame('s3', 3, 10, 'sample'),
      frame('u4', 4, 10, 'unknown'),
      frame('e9', 9, 10, 'evidence'),
      frame('e5', 5, 10, 'evidence'),
    ];
    // Act
    const order = exportOrder(frames).map((f) => f.id);
    // Assert
    expect(order).toEqual(['e5', 'e9', 'u4', 's3', 'old', 'r2', 'p1']);
    expect(frames[0]!.id).toBe('p1'); // the input is left alone
  });
});

describe('planParts', () => {
  it('keeps a small export in one part, with the session', () => {
    // Arrange
    const frames = [frame('a', 1, 200_000), frame('b', 2, 300_000, 'preview')];
    // Act
    const plan = planParts(50_000, frames);
    // Assert
    expect(ids(plan.parts)).toEqual([['a', 'b']]);
    expect(plan.sessionOver).toBe(false);
  });

  it('splits an hour’s export into parts in priority order, never back-filling an earlier part', () => {
    // Arrange: 150 MB of full frames and 20 MB of previews.
    const frames = [
      ...Array.from({ length: 300 }, (_, i) =>
        frame(`f${i}`, i, 500 * 1024, (['routine', 'sample', 'unknown', 'evidence'] as const)[i % 4]),
      ),
      ...Array.from({ length: 600 }, (_, i) => frame(`p${i}`, i, 34 * 1024, 'preview')),
    ];
    // Act
    const plan = planParts(3 * MB, frames);
    // Assert: every part under the limit by its frames alone, and the order kept across parts.
    expect(plan.parts.length).toBe(7);
    for (const part of plan.parts)
      expect(part.reduce((sum, f) => sum + f.bytes, 0)).toBeLessThanOrEqual(PART_MAX_BYTES);
    expect(plan.parts.flat().map((f) => f.id)).toEqual(exportOrder(frames).map((f) => f.id));
    expect(plan.parts[0]!.every((f) => f.class === 'evidence')).toBe(true);
    expect(plan.parts.at(-1)!.every((f) => f.class === 'preview')).toBe(true);
  });

  it('is deterministic: the same frames in any order split the same way', () => {
    // Arrange
    const frames = Array.from({ length: 40 }, (_, i) => frame(`f${i}`, i % 7, 100_000 + i * 997));
    // Act
    const a = planParts(10_000, frames, 1 * MB);
    const b = planParts(10_000, [...frames].reverse(), 1 * MB);
    // Assert
    expect(ids(a.parts)).toEqual(ids(b.parts));
  });

  it('starts a new part at the boundary: what fits exactly stays, one byte more moves on', () => {
    // Arrange: find the largest frame that fits beside the session in one part.
    const fits = (bytes: number) => planParts(1000, [frame('a', 1, bytes)], 100_000).parts.length === 1;
    let low = 0;
    let high = 100_000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (fits(mid)) low = mid;
      else high = mid;
    }
    // Act
    const exact = planParts(1000, [frame('a', 1, low)], 100_000);
    const over = planParts(1000, [frame('a', 1, low + 1)], 100_000);
    // Assert: the headroom is headers only (a few hundred bytes), and one byte over moves the frame.
    expect(100_000 - 1000 - low).toBeLessThan(1000);
    expect(ids(exact.parts)).toEqual([['a']]);
    expect(ids(over.parts)).toEqual([[], ['a']]);
  });

  it('gives a frame larger than the limit a part of its own', () => {
    // Arrange
    const frames = [
      frame('small1', 1, 100_000, 'evidence'),
      frame('huge', 2, 3 * MB, 'evidence'),
      frame('small2', 3, 100_000, 'evidence'),
    ];
    // Act
    const plan = planParts(1000, frames, 1 * MB);
    // Assert
    expect(ids(plan.parts)).toEqual([['small1'], ['huge'], ['small2']]);
  });

  it('keeps session.json in part 1 even when it alone is over the limit, and says so', () => {
    // Act
    const plan = planParts(2 * MB, [frame('a', 1, 1000)], 1 * MB);
    // Assert
    expect(plan.sessionOver).toBe(true);
    expect(ids(plan.parts)).toEqual([[], ['a']]);
  });
});

describe('partName', () => {
  it('keeps the old name for one part and numbers several', () => {
    expect(partName(NAME, 1, 1)).toBe(NAME);
    expect(partName(NAME, 2, 3)).toBe('md-diagnostics-20261018-1430-part2of3.zip');
  });
});

describe('planExport', () => {
  const session = JSON.stringify({
    bundleId: '1000',
    records: Array.from({ length: 200 }, (_, i) => ({ i })),
  });

  it('builds standalone zips under the limit: part 1 with session.json, every part with part.json', async () => {
    // Arrange: 12 frames of 90 KB under a 400 KB limit.
    const frames = Array.from({ length: 12 }, (_, i) =>
      real(`f${i}`, i, 90_000, i % 3 === 0 ? 'evidence' : 'routine'),
    );
    const limit = 400_000;
    // Act
    const plan = await planExport({ bundleId: '1000', exportedAt: 2000, session, frames, name: NAME }, limit);
    const zips = await Promise.all(plan.names.map((_, i) => plan.zip(i)));
    // Assert
    expect(plan.names).toEqual(
      Array.from(
        { length: zips.length },
        (_, i) => `md-diagnostics-20261018-1430-part${i + 1}of${zips.length}.zip`,
      ),
    );
    expect(zips.length).toBeGreaterThan(2);
    const seen: string[] = [];
    for (const [i, zip] of zips.entries()) {
      expect(zip.length).toBeLessThanOrEqual(limit);
      const files = unzipSync(zip);
      expect('session.json' in files).toBe(i === 0);
      const part = diagPartSchema.parse(JSON.parse(strFromU8(files['part.json']!)));
      expect(part).toMatchObject({ bundleId: '1000', exportedAt: 2000, part: i + 1, total: zips.length });
      expect(Object.keys(files).filter((n) => n.startsWith('frames/'))).toEqual(part.frames);
      expect(files[part.frames[0]!]!.length).toBe(90_000);
      seen.push(...part.frames);
    }
    expect(seen.slice(0, 4)).toEqual(['frames/f0.jpg', 'frames/f3.jpg', 'frames/f6.jpg', 'frames/f9.jpg']);
    expect(new Set(seen).size).toBe(12);
  });

  it('keeps one file of today’s layout when everything fits, adding only part.json', async () => {
    // Arrange
    const frames = [real('a', 1, 1000)];
    // Act
    const plan = await planExport({ bundleId: '1000', exportedAt: 2000, session, frames, name: NAME });
    const files = unzipSync(await plan.zip(0));
    // Assert
    expect(plan.names).toEqual([NAME]);
    expect(Object.keys(files).sort()).toEqual(['frames/a.jpg', 'part.json', 'session.json']);
    expect(strFromU8(files['session.json']!)).toBe(session);
  });
});

describe('downloadParts', () => {
  it('hands every part over in turn with a gap between, and fails as soon as one does', async () => {
    // Arrange
    const plan = {
      names: ['p1.zip', 'p2.zip', 'p3.zip'],
      sessionOver: false,
      zip: vi.fn(async (i: number) => new Uint8Array([i])),
    };
    const order: string[] = [];
    const download = vi.fn((_data: Uint8Array, name: string) => void order.push(name));
    const wait = vi.fn(async (ms: number) => void order.push(`wait ${ms}`));
    // Act
    await downloadParts(plan, download, wait);
    // Assert
    expect(order).toEqual(['p1.zip', `wait ${PART_GAP_MS}`, 'p2.zip', `wait ${PART_GAP_MS}`, 'p3.zip']);
    plan.zip.mockRejectedValueOnce(new Error('quota'));
    await expect(downloadParts(plan, download, wait)).rejects.toThrow('quota');
  });
});
