import { describe, expect, it, vi } from 'vitest';
import { diagnosticsBundleSchema } from '../../../../core/schema.ts';
import type { FrameSource, ReadReport } from '../../session.ts';
import { DiagRecorder, MAX_FRAMES, MAX_FRAME_BYTES, RING_SIZE, UNKNOWN_FRAME_GAP_MS } from '../recorder.ts';
import { memoryStore, type DiagStore } from '../store.ts';

const META = { dataVersion: '7.test', season: 7, layoutReference: { width: 1920, height: 1009 } };

function report(t: number, over: Partial<ReadReport> = {}): ReadReport {
  return {
    t,
    reason: 'change',
    ms: 120,
    ocrCalls: 1,
    frame: { screen: null, floor: null, pack: null, gift: null },
    trace: [],
    events: [],
    captureSize: { width: 1920, height: 1009 },
    ...over,
  };
}
const popup = (t: number, giftId: number) =>
  report(t, {
    frame: {
      screen: 'acquired',
      floor: null,
      pack: null,
      gift: { status: 'match', id: giftId, score: 1, margin: 1 },
    },
    events: [{ kind: 'got', giftId }],
  });
/** A read's picture: its JPEG once encoded, and whether it was encoded at all. */
const jpeg = (n = 10, blob: Blob = new Blob([new Uint8Array(n)], { type: 'image/jpeg' })) => {
  const frame = { encode: vi.fn(async () => blob), close: vi.fn() };
  return frame satisfies FrameSource;
};

async function recorder(opts: { images?: boolean } = {}) {
  let clock = 1_000_000;
  const store = memoryStore();
  const r = await DiagRecorder.open(store, () => clock);
  r.recording = true;
  r.images = opts.images ?? false;
  return { r, store, tick: (ms: number) => (clock += ms) };
}

describe('DiagRecorder', () => {
  it('records nothing while off', async () => {
    // Arrange
    const { r } = await recorder();
    r.recording = false;
    // Act
    r.onRead(popup(1, 9006), jpeg());
    r.onUndo(1);
    await r.flush();
    // Assert
    expect(r.stats().records).toBe(0);
  });

  it('keeps the frame of a read that made an event, and not of a quiet one', async () => {
    // Arrange
    const { r } = await recorder({ images: true });
    // Act
    r.onRead(report(1), jpeg());
    r.onRead(popup(2, 9006), jpeg(20));
    await r.flush();
    // Assert
    const { bundle, frames } = await r.exportBundle(META);
    expect(frames.map((f) => f.t)).toEqual([2]);
    const reads = bundle.records.filter((x) => x.kind === 'read');
    expect(reads.map((x) => (x.kind === 'read' ? x.frameId : null))).toEqual([null, frames[0]!.id]);
  });

  it('keeps frames only when images are on', async () => {
    const { r } = await recorder({ images: false });
    r.onRead(popup(2, 9006), jpeg());
    await r.flush();
    expect(r.stats().frames).toBe(0);
    expect(r.stats().records).toBe(1);
  });

  it('keeps an unrecognised screen with text at most once a minute', async () => {
    // Arrange: text on a title pass, no screen named.
    const { r } = await recorder({ images: true });
    const unknown = (t: number) =>
      report(t, {
        trace: [{ step: 'title', region: [0, 0, 1, 1], light: true, lines: ['무엇인가'], accepted: false }],
      });
    // Act
    r.onRead(unknown(0), jpeg());
    r.onRead(unknown(1000), jpeg());
    r.onRead(unknown(UNKNOWN_FRAME_GAP_MS), jpeg());
    await r.flush();
    // Assert
    expect(r.stats().frames).toBe(2);
  });

  it('keeps the last reads around a hand-made change while reading — a likely miss', async () => {
    // Arrange: more quiet reads than the ring holds.
    const { r } = await recorder({ images: true });
    for (let t = 1; t <= RING_SIZE + 3; t += 1) r.onRead(report(t), jpeg());
    // Act
    r.onManual({
      capturing: true,
      visits: [],
      status: [{ giftId: 9006, from: null, to: 'got' }],
      currentFloor: null,
    });
    await r.flush();
    // Assert: the ring's frames, newest last, named by the manual record.
    const { bundle } = await r.exportBundle(META);
    const manual = bundle.records.find((x) => x.kind === 'manual');
    expect(manual?.kind === 'manual' && manual.frameIds).toHaveLength(RING_SIZE);
    expect(bundle.frames.map((f) => f.t)).toEqual(Array.from({ length: RING_SIZE }, (_, i) => i + 4));
  });

  it('keeps no frames for a hand-made change made while not reading', async () => {
    const { r } = await recorder({ images: true });
    r.onRead(report(1), jpeg());
    r.onManual({ capturing: false, visits: [], status: [], currentFloor: { from: 1, to: 2 } });
    await r.flush();
    expect(r.stats().frames).toBe(0);
  });

  it('ties an applied event to the read that made it, and an answer to none', async () => {
    const { r } = await recorder();
    r.onRead(popup(5, 9006), null);
    r.onApplied(1, { kind: 'got' }, [], true);
    r.onApplied(2, { kind: 'answer' }, [], false);
    r.onUndo(1);
    const { bundle } = await r.exportBundle(META);
    const applied = bundle.records.filter((x) => x.kind === 'applied');
    expect(applied.map((x) => (x.kind === 'applied' ? x.readT : 'x'))).toEqual([5, null]);
    expect(bundle.records.at(-1)).toMatchObject({ kind: 'undo', logId: 1 });
  });

  it('exports a bundle the schema accepts, then clears exactly what it held', async () => {
    // Arrange
    const { r, tick } = await recorder({ images: true });
    r.onRead(popup(1, 9006), jpeg());
    r.onFloor({
      floor: 1,
      recommended: 1002,
      window: { from: 1, to: 1 },
      alternatives: [],
      entered: 1002,
      expected: [{ giftId: 9403, status: 'got' }],
      startGifts: [],
    });
    tick(10);
    // Act
    const { bundle, frames, name, mark } = await r.exportBundle(META);
    r.markExported(mark);
    r.onRead(popup(2, 9007), jpeg()); // recorded after the export
    const removed = await r.clearExported();
    // Assert
    expect(diagnosticsBundleSchema.safeParse(bundle).success).toBe(true);
    expect(name).toMatch(/^md-diagnostics-\d{8}-\d{4}\.zip$/);
    expect(frames).toHaveLength(1);
    expect(removed).toEqual({ records: 2, frames: 1 });
    expect(r.stats()).toMatchObject({ records: 1, frames: 1, exportedRecords: 0, lastExportAt: null });
  });

  it('says how much exported data is still on the device until it is cleared', async () => {
    const { r } = await recorder();
    r.onUndo(1);
    r.markExported((await r.exportBundle(META)).mark);
    expect(r.stats()).toMatchObject({ records: 1, exportedRecords: 1 });
    expect(r.stats().lastExportAt).not.toBeNull();
  });

  it('marks nothing exported until the zip was handed to the browser', async () => {
    // Arrange
    const { r } = await recorder();
    r.onUndo(1);
    // Act: the bundle is read, but zipping or the download failed.
    await r.exportBundle(META);
    // Assert: nothing on the device counts as exported, so nothing offers to clear it.
    expect(r.stats()).toMatchObject({ records: 1, exportedRecords: 0, lastExportAt: null });
    expect(await r.clearExported()).toEqual({ records: 0, frames: 0 });
  });

  it('clears everything in turn with the writes around it', async () => {
    // Arrange: a slow device — each write takes a while.
    const slow = memoryStore();
    const store: DiagStore = {
      ...slow,
      addRecord: async (seq, rec) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await slow.addRecord(seq, rec);
      },
    };
    const r = await DiagRecorder.open(store);
    r.recording = true;
    r.onUndo(1);
    // Act: clear, and something is recorded before the clearing is done.
    const cleared = r.clearAll();
    r.onUndo(2);
    await cleared;
    await r.flush();
    // Assert: the record made after the clear stays, and the count agrees with the device.
    const kept = await store.records();
    expect(kept.map((x) => x.rec)).toMatchObject([{ kind: 'undo', logId: 2 }]);
    expect(r.stats().records).toBe(1);
  });

  it('encodes only the pictures it keeps', async () => {
    // Arrange
    const { r } = await recorder({ images: true });
    const quiet = jpeg();
    const event = jpeg();
    // Act
    r.onRead(report(1), quiet);
    r.onRead(popup(2, 9006), event);
    await r.flush();
    // Assert
    expect(quiet.encode).not.toHaveBeenCalled();
    expect(event.encode).toHaveBeenCalledTimes(1);
  });

  it('frees the pictures that leave the ring', async () => {
    const { r } = await recorder({ images: true });
    const first = jpeg();
    r.onRead(report(1), first);
    for (let t = 2; t <= RING_SIZE + 1; t += 1) r.onRead(report(t), jpeg());
    expect(first.close).toHaveBeenCalled();
  });

  it('keeps a ring frame again after the cap trimmed it, instead of naming a frame that is gone', async () => {
    // Arrange: three pictures of a third of the byte cap each — the first is trimmed.
    const { r } = await recorder({ images: true });
    const big = () => jpeg(0, { size: Math.ceil(MAX_FRAME_BYTES / 2.5) } as Blob);
    for (let t = 1; t <= 3; t += 1) r.onRead(popup(t, 9000 + t), big());
    await r.flush();
    expect(r.stats().trimmedFrames).toBe(1);
    // Act: a hand-made change while reading keeps the ring's frames.
    r.onManual({ capturing: true, visits: [], status: [], currentFloor: { from: 1, to: 2 } });
    await r.flush();
    // Assert: the trimmed first frame was kept anew.
    const { frames } = await r.exportBundle(META);
    expect(frames.map((f) => f.t)).toContain(1);
  });

  it('drops the oldest frames past the cap and says so', async () => {
    const { r } = await recorder({ images: true });
    for (let t = 1; t <= MAX_FRAMES + 2; t += 1) r.onRead(popup(t, 9000 + t), jpeg(1));
    await r.flush();
    expect(r.stats()).toMatchObject({ frames: MAX_FRAMES, trimmedFrames: 2 });
  });

  it('survives a reload: what was stored is counted again', async () => {
    // Arrange
    const { r, store } = await recorder({ images: true });
    r.onRead(popup(1, 9006), jpeg(7));
    await r.flush();
    // Act
    const again = await DiagRecorder.open(store);
    // Assert
    expect(again.stats()).toMatchObject({ records: 1, frames: 1, bytes: 7 });
  });

  it('clears everything', async () => {
    const { r } = await recorder({ images: true });
    r.onRead(popup(1, 9006), jpeg());
    await r.clearAll();
    await r.flush();
    expect(r.stats()).toMatchObject({ records: 0, frames: 0, bytes: 0 });
  });
});
