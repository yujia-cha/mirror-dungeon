import { describe, expect, it } from 'vitest';
import { diagnosticsBundleSchema } from '../../../../core/schema.ts';
import type { ReadReport } from '../../session.ts';
import { DiagRecorder, MAX_FRAMES, RING_SIZE, UNKNOWN_FRAME_GAP_MS } from '../recorder.ts';
import { memoryStore } from '../store.ts';

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
const jpeg = (n = 10) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });

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
    const { bundle, frames, name } = await r.exportBundle(META);
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
    await r.exportBundle(META);
    expect(r.stats()).toMatchObject({ records: 1, exportedRecords: 1 });
    expect(r.stats().lastExportAt).not.toBeNull();
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
    expect(r.stats()).toMatchObject({ records: 0, frames: 0, bytes: 0 });
  });
});
