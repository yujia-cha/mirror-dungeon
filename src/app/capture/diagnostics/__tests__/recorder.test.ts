import { describe, expect, it, vi } from 'vitest';
import { diagnosticsBundleSchema, type DiagRecord } from '../../../../core/schema.ts';
import type { EnvReport, FrameSource, ReadReport, TickReport } from '../../session.ts';
import {
  DiagRecorder,
  MAX_FRAMES,
  MAX_FRAME_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_PREVIEWS,
  MAX_READ_RECORDS,
  RING_SIZE,
  SAMPLES_PER_SCREEN,
  STRIP_AFTER_MS,
  STRIP_BEFORE_MS,
  SUMMARY_PERIOD_MS,
  UNKNOWN_FRAME_GAP_MS,
} from '../recorder.ts';
import { memoryStore, type DiagStore } from '../store.ts';

const META = { dataVersion: '7.test', season: 7, layoutReference: { width: 1920, height: 1009 } };

function report(t: number, over: Partial<ReadReport> = {}): ReadReport {
  return {
    t,
    reason: 'change',
    mode: 'full',
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
  it('records the run-start markers and the rollback, and the bundle parses (M143)', async () => {
    // Arrange
    const { r } = await recorder();
    const run = { currentFloor: 2, visits: 1, got: 3, failed: 0, startDone: true };
    // Act
    r.onRunMark({ mark: 'new', hadProgress: true, run });
    r.onRunMark({ mark: 'continue', hadProgress: false, run: { ...run, currentFloor: 1 } });
    r.onRunMark({ mark: 'rollback', hadProgress: true, run });
    await r.flush();
    // Assert
    const { bundle } = await r.exportBundle(META);
    expect(diagnosticsBundleSchema.parse(bundle).records.map((x) => x.kind === 'runMark' && x.mark)).toEqual([
      'new',
      'continue',
      'rollback',
    ]);
    expect(bundle.format).toBe(1);
  });

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

  it('marks a queued popup read with its wait, and a later read with the popups dropped (M141)', async () => {
    // Arrange
    const { r } = await recorder();
    // Act: a queued read 312.6 ms after its snapshot, then a read telling of two dropped.
    r.onRead({ ...popup(5, 9006), mode: 'popup', queued: { lagMs: 312.6 } }, null);
    r.onRead(report(6, { queueDropped: 2 }), null);
    const { bundle } = await r.exportBundle(META);
    // Assert: the schema takes both; a plain read says nothing of the queue.
    expect(diagnosticsBundleSchema.safeParse(bundle).success).toBe(true);
    const reads = bundle.records.filter((rec) => rec.kind === 'read');
    expect(reads[0]).toMatchObject({ t: 5, mode: 'popup', queued: true, lagMs: 313 });
    expect(reads[0]).not.toHaveProperty('queueDropped');
    expect(reads[1]).toMatchObject({ t: 6, queueDropped: 2 });
    expect(reads[1]).not.toHaveProperty('queued');
  });

  describe('reads summed, not kept one by one (M153)', () => {
    /** A popup read that found no popup: the title alone. */
    const scan = (t: number, over: Partial<ReadReport> = {}) =>
      report(t, {
        mode: 'popup',
        ms: 3.4,
        frame: { screen: null, floor: null, pack: null, gift: null, partial: true },
        ...over,
      });

    it('sums popup reads that found nothing, and keeps the popup that was found', async () => {
      // Arrange
      const { r } = await recorder();
      // Act: two scans in the burst, a popup found in the queue, two queued scans (one telling of a
      // popup pushed out), and a busy tick that saw the screen change.
      r.onRead(scan(1000), null);
      r.onRead(scan(1100), null);
      r.onRead({ ...popup(1200, 9006), mode: 'popup', queued: { lagMs: 40 } }, null);
      r.onTick({ t: 1250, read: false, busy: true, changed: true }, null);
      r.onRead(scan(1300, { queued: { lagMs: 120.4 }, queueDropped: 1 }), null);
      r.onRead(scan(1400, { queued: { lagMs: 80 } }), null);
      const { bundle } = await r.exportBundle(META);
      // Assert: one read record (the popup) and one summary of the four scans.
      expect(diagnosticsBundleSchema.safeParse(bundle).success).toBe(true);
      expect(bundle.records.filter((x) => x.kind === 'read')).toHaveLength(1);
      expect(bundle.records.filter((x) => x.kind === 'readSummary')).toEqual([
        {
          kind: 'readSummary',
          t: 1400,
          from: 1000,
          cause: 'scan',
          mode: 'popup',
          reads: 4,
          ms: 12,
          ocrCalls: 4,
          queued: 2,
          lagMs: 200,
          lagMaxMs: 120,
          popups: 0,
          queuedPopups: 0,
          queueDropped: 1,
          busyTicks: 1,
          busyChanges: 1,
          changedUnder: 1,
          screens: { '(none)': 4 },
        },
      ]);
    });

    it('writes a summary once it is SUMMARY_PERIOD_MS old, when the session stops, or on export', async () => {
      // Arrange
      const { r } = await recorder();
      // Act: scans across 10 s, an env record, then more scans and the session stopping.
      r.onRead(scan(0), null);
      r.onRead(scan(SUMMARY_PERIOD_MS - 1), null);
      r.onRead(scan(SUMMARY_PERIOD_MS), null);
      r.onRead(scan(SUMMARY_PERIOD_MS + 10), null);
      r.onSession({ status: 'idle', error: null, interval: 'balanced', lang: 'ko', captureSize: null });
      await r.flush();
      const { bundle } = await r.exportBundle(META);
      // Assert: the first summary closed at the read 10 s on, the second when the session stopped.
      const sums = bundle.records.filter((x) => x.kind === 'readSummary');
      expect(sums.map((x) => x.kind === 'readSummary' && [x.from, x.t, x.reads])).toEqual([
        [0, SUMMARY_PERIOD_MS - 1, 2],
        [SUMMARY_PERIOD_MS, SUMMARY_PERIOD_MS + 10, 2],
      ]);
      expect(bundle.records.map((x) => x.kind)).toEqual(['readSummary', 'readSummary', 'session']);
    });

    it('counts reads of nothing past their cap, and goes on recording events and everything else', async () => {
      // Arrange: the cap of reads that say nothing is reached.
      const { r } = await recorder();
      for (let i = 0; i < MAX_READ_RECORDS; i++) r.onRead(report(i), null);
      expect(r.stats()).toMatchObject({ full: true, stopped: false });
      // Act: more of them, a popup with its event, what was applied, a floor.
      r.onRead(report(MAX_READ_RECORDS), null);
      r.onRead(
        report(MAX_READ_RECORDS + 1, { frame: { screen: 'exploring', floor: 2, pack: null, gift: null } }),
        null,
      );
      r.onRead(popup(MAX_READ_RECORDS + 2, 9007), null);
      r.onApplied(1, { kind: 'got' }, [], true);
      r.onFloor({
        floor: 1,
        recommended: null,
        window: null,
        alternatives: [],
        entered: null,
        expected: [],
        startGifts: [],
      });
      const { bundle } = await r.exportBundle(META);
      // Assert
      const kinds = bundle.records.slice(MAX_READ_RECORDS).map((x) => x.kind);
      expect(kinds).toEqual(['read', 'applied', 'floor', 'readSummary']);
      const capped = bundle.records.find((x) => x.kind === 'readSummary');
      expect(capped).toMatchObject({
        cause: 'capped',
        mode: 'full',
        reads: 2,
        screens: { '(none)': 1, exploring: 1 },
      });
      expect(r.stats()).toMatchObject({ full: true, stopped: false });
    });

    it('counts the reads of nothing already kept after a reload, and not the others', async () => {
      // Arrange: a device holding one short of the cap of reads of nothing, and a popup read.
      const store = memoryStore();
      const nothing = { kind: 'read', reason: 'change', ms: 1, ocrCalls: 1, screen: null, floor: null };
      const rest = { pack: null, gift: null, ingredients: null, trace: [], frameId: null };
      for (let i = 1; i < MAX_READ_RECORDS; i++)
        await store.addRecord(i, { ...nothing, ...rest, t: i, events: [] } as DiagRecord);
      await store.addRecord(MAX_READ_RECORDS, {
        ...nothing,
        ...rest,
        t: MAX_READ_RECORDS,
        events: [{ kind: 'got', giftId: 9008 }],
      } as DiagRecord);
      // Act
      const reloaded = await DiagRecorder.open(store);
      const full = { before: reloaded.stats().full };
      reloaded.recording = true;
      reloaded.onRead(report(MAX_READ_RECORDS + 1), null);
      // Assert: the popup read did not count; the next read of nothing reaches the cap.
      expect(full.before).toBe(false);
      expect(reloaded.stats().full).toBe(true);
    });
  });

  it('records the environment as text, with or without pictures, and the schema takes it (M142)', async () => {
    // Arrange
    const { r } = await recorder();
    const env: EnvReport = {
      t: 7,
      reason: 'level',
      fps: { requested: 8, delivered: 7.5, setting: null },
      stats: {
        lateness: { p50: 4, p90: 61 },
        fullRead: { p50: 600, p90: 1700, n: 5 },
        popupRead: null,
        deliveredFps: 7.5,
      },
      queueDropped: 1,
      range: { min: 100, max: 250 },
      interval: 150,
      level: 1,
    };
    // Act
    r.onEnv(env);
    const { bundle } = await r.exportBundle(META);
    // Assert
    expect(diagnosticsBundleSchema.safeParse(bundle).success).toBe(true);
    expect(bundle.records.find((rec) => rec.kind === 'env')).toEqual({
      kind: 'env',
      t: 7,
      reason: 'level',
      fps: { requested: 8, delivered: 7.5, setting: null },
      lateness: { p50: 4, p90: 61 },
      readFull: { p50: 600, p90: 1700, n: 5 },
      readPopup: null,
      queueDropped: 1,
      range: { min: 100, max: 250 },
      interval: 150,
      level: 1,
    });
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

describe('DiagRecorder frame classes (M134)', () => {
  /** A picture of `bytes` bytes, without allocating them. */
  const sized = (bytes: number) => jpeg(0, { size: bytes } as Blob);
  const unknownAt = (t: number) =>
    report(t, {
      trace: [{ step: 'title', region: [0, 0, 1, 1], light: true, lines: ['무엇인가'], accepted: false }],
    });
  const classes = async (r: DiagRecorder) =>
    Object.fromEntries((await r.exportBundle(META)).bundle.frames.map((f) => [f.t, f.class]));

  it('keeps the first few event frames of each screen kind as samples, the rest as routine', async () => {
    // Arrange
    const { r } = await recorder({ images: true });
    const mapHeader = (t: number) =>
      report(t, {
        frame: { screen: 'exploring', floor: 2, pack: null, gift: null },
        events: [{ kind: 'enter', floor: 2, packId: 1002 }],
      });
    // Act
    for (let t = 1; t <= SAMPLES_PER_SCREEN + 2; t += 1) r.onRead(popup(t, 9000 + t), jpeg());
    r.onRead(mapHeader(100), jpeg());
    await r.flush();
    // Assert
    expect(await classes(r)).toEqual({
      1: 'sample',
      2: 'sample',
      3: 'sample',
      4: 'routine',
      5: 'routine',
      100: 'sample',
    });
  });

  it('drops the oldest routine frames first past the cap, sparing samples, unknown screens and evidence', async () => {
    // Arrange: one unknown screen, the samples, an undone event, then routine events.
    const { r } = await recorder({ images: true });
    r.onRead(unknownAt(1), jpeg(1));
    for (let t = 2; t < 2 + SAMPLES_PER_SCREEN; t += 1) r.onRead(popup(t, 9000 + t), jpeg(1));
    r.onRead(popup(10, 9010), jpeg(1));
    r.onApplied(1, { kind: 'got' }, [], true);
    r.onUndo(1);
    const kept = 2 + SAMPLES_PER_SCREEN;
    // Act: three routine frames more than the cap holds.
    for (let t = 100; t < 100 + MAX_FRAMES - kept + 3; t += 1) r.onRead(popup(t, 9000), jpeg(1));
    await r.flush();
    // Assert
    const byT = await classes(r);
    expect(r.stats()).toMatchObject({ frames: MAX_FRAMES, trimmedFrames: 3 });
    expect([byT[1], byT[2], byT[10]]).toEqual(['unknown', 'sample', 'evidence']);
    expect([byT[100], byT[101], byT[102], byT[103]]).toEqual([undefined, undefined, undefined, 'routine']);
  });

  it('drops samples before unknown screens, and unknown screens before evidence', async () => {
    // Arrange: each picture is a little over a quarter of the byte cap, so three fit.
    const { r } = await recorder({ images: true });
    const big = () => sized(Math.ceil(MAX_FRAME_BYTES / 3.5));
    r.onRead(popup(1, 9001), big());
    r.onApplied(1, { kind: 'got' }, [], true);
    r.onUndo(1); // evidence
    r.onRead(unknownAt(2), big());
    r.onRead(unknownAt(2 + UNKNOWN_FRAME_GAP_MS), big());
    // Act: a newer sample goes before the older unknown screens; then the oldest unknown screen.
    r.onRead(popup(3 + UNKNOWN_FRAME_GAP_MS, 9002), big());
    r.onRead(unknownAt(2 + 2 * UNKNOWN_FRAME_GAP_MS), big());
    await r.flush();
    // Assert
    expect(await classes(r)).toEqual({
      1: 'evidence',
      [2 + UNKNOWN_FRAME_GAP_MS]: 'unknown',
      [2 + 2 * UNKNOWN_FRAME_GAP_MS]: 'unknown',
    });
    expect(r.stats().trimmedFrames).toBe(2);
  });

  it('raises the frame of an undone event to evidence, on the device too', async () => {
    // Arrange
    const { r, store } = await recorder({ images: true });
    for (let t = 1; t <= SAMPLES_PER_SCREEN + 1; t += 1) r.onRead(popup(t, 9000 + t), jpeg());
    r.onApplied(7, { kind: 'got' }, [], true);
    // Act
    r.onUndo(7);
    await r.flush();
    // Assert
    const last = (await store.frames()).at(-1)!;
    expect(last).toMatchObject({ t: SAMPLES_PER_SCREEN + 1, class: 'evidence' });
  });

  it('raises the frame of a read that asked a question to evidence', async () => {
    // Arrange
    const { r } = await recorder({ images: true });
    const unsure = report(1, {
      frame: { screen: 'acquired', floor: null, pack: null, gift: null },
      events: [{ kind: 'unsure', about: 'got', ids: [9001, 9002] }],
    });
    r.onRead(unsure, jpeg());
    // Act
    r.onAsk();
    await r.flush();
    // Assert
    expect(await classes(r)).toEqual({ 1: 'evidence' });
  });

  it('raises the ring around a hand-made change to evidence, frames kept before included', async () => {
    // Arrange
    const { r } = await recorder({ images: true });
    r.onRead(popup(1, 9001), jpeg());
    r.onRead(report(2), jpeg());
    // Act
    r.onManual({
      capturing: true,
      visits: [],
      status: [{ giftId: 9006, from: null, to: 'got' }],
      currentFloor: null,
    });
    await r.flush();
    // Assert
    expect(await classes(r)).toEqual({ 1: 'evidence', 2: 'evidence' });
  });

  it('reads frames stored before M134, which have no class, as routine', async () => {
    // Arrange: a device with an old frame on it.
    const store = memoryStore();
    await store.addFrame({ id: '1-1', t: 1, bytes: 5, blob: new Blob([new Uint8Array(5)]) });
    // Act
    const r = await DiagRecorder.open(store);
    // Assert
    expect(r.stats()).toMatchObject({ frames: 1, bytes: 5 });
    expect((await r.exportBundle(META)).bundle.frames).toEqual([
      { id: '1-1', t: 1, bytes: 5, class: 'routine' },
    ]);
  });

  it('accepts a format-1 bundle from before M134', () => {
    // Arrange: no frame classes, no strips, reads without tick counts.
    const old = {
      format: 1,
      bundleId: '1',
      startedAt: 1,
      exportedAt: 2,
      ...META,
      records: [
        {
          kind: 'read',
          t: 1,
          reason: 'change',
          ms: 50,
          ocrCalls: 1,
          screen: 'acquired',
          floor: null,
          pack: null,
          gift: null,
          ingredients: null,
          trace: [],
          events: [{ kind: 'got', giftId: 9006 }],
          frameId: '1-1',
        },
      ],
      frames: [{ id: '1-1', t: 1, bytes: 5 }],
    };
    // Act
    const parsed = diagnosticsBundleSchema.safeParse(old);
    // Assert
    expect(parsed.success).toBe(true);
  });
});

describe('DiagRecorder filmstrip (M134)', () => {
  const TICK = 250;
  const tickAt = (t: number, over: Partial<TickReport> = {}): TickReport => ({
    t,
    read: false,
    busy: false,
    changed: false,
    ...over,
  });

  /** A recorder keeping pictures, its clock, and ticks every 250 ms on that clock. */
  async function filming() {
    let now = 1_000_000;
    const r = await DiagRecorder.open(memoryStore(), () => now);
    r.setFlags(true, true);
    const previews: ReturnType<typeof jpeg>[] = [];
    /** Ticks from one interval after now until `ms` later; the clock follows. */
    const run = (ms: number, size = 3) => {
      const end = now + ms;
      for (let t = now + TICK; t <= end; t += TICK) {
        now = t;
        const preview = jpeg(size);
        previews.push(preview);
        r.onTick(tickAt(t), preview);
      }
    };
    return { r, now: () => now, run, previews };
  }
  const strips = async (r: DiagRecorder) =>
    (await r.exportBundle(META)).bundle.records.filter((x) => x.kind === 'strip');

  it('keeps the previews from a few seconds before an event to a few seconds after', async () => {
    // Arrange: five seconds of ticks, then a popup is read.
    const { r, now, run, previews } = await filming();
    run(5000);
    const readT = now();
    // Act: the last tick is past the window, and ends the strip.
    r.onRead(popup(readT, 9006), jpeg());
    run(STRIP_AFTER_MS + TICK);
    await r.flush();
    // Assert
    const { bundle } = await r.exportBundle(META);
    const strip = bundle.records.find((x) => x.kind === 'strip');
    const kept = bundle.frames.filter((f) => f.class === 'preview');
    expect(strip).toMatchObject({ kind: 'strip', reads: [readT], manual: [] });
    expect(strip?.kind === 'strip' && strip.frameIds).toEqual(kept.map((f) => f.id));
    expect(kept.map((f) => f.t)).toEqual(
      Array.from(
        { length: (STRIP_BEFORE_MS + STRIP_AFTER_MS) / TICK + 1 },
        (_, i) => readT - STRIP_BEFORE_MS + i * TICK,
      ),
    );
    expect(previews[0]!.encode).not.toHaveBeenCalled();
  });

  it('stretches one strip over events that follow each other', async () => {
    // Arrange
    const { r, now, run } = await filming();
    run(1000);
    const first = now();
    r.onRead(popup(first, 9001), jpeg());
    run(2000);
    const second = now();
    // Act
    r.onRead(popup(second, 9002), jpeg());
    run(STRIP_AFTER_MS + TICK);
    await r.flush();
    // Assert
    expect(await strips(r)).toMatchObject([{ reads: [first, second] }]);
  });

  it('films a hand-made change made while reading, and not one made while not', async () => {
    // Arrange
    const { r, now, run } = await filming();
    run(1000);
    // Act
    r.onManual({ capturing: false, visits: [], status: [], currentFloor: { from: 1, to: 2 } });
    const t = now();
    r.onManual({
      capturing: true,
      visits: [],
      status: [{ giftId: 9006, from: null, to: 'got' }],
      currentFloor: null,
    });
    run(STRIP_AFTER_MS + TICK);
    await r.flush();
    // Assert
    expect(await strips(r)).toMatchObject([{ reads: [], manual: [t] }]);
  });

  it('ends an open strip with what it has when the bundle is exported', async () => {
    // Arrange
    const { r, now, run } = await filming();
    run(1000);
    r.onRead(popup(now(), 9001), jpeg());
    run(500);
    // Act
    const found = await strips(r);
    // Assert
    expect(found).toHaveLength(1);
    expect(found[0]?.kind === 'strip' && found[0].frameIds).toHaveLength((1000 + 500) / TICK);
  });

  it('ends an open strip when the session stops', async () => {
    const { r, now, run } = await filming();
    run(1000);
    r.onRead(popup(now(), 9001), jpeg());
    r.onSession({ status: 'idle', error: null, interval: 'balanced', lang: 'ko', captureSize: null });
    run(500);
    const found = await strips(r);
    expect(found[0]?.kind === 'strip' && found[0].frameIds).toHaveLength(1000 / TICK);
  });

  it('holds previews to their own cap, oldest first, without touching full frames', async () => {
    // Arrange: an open strip whose previews are a little over a sixth of the preview byte cap.
    const { r, now, run } = await filming();
    r.onRead(popup(now(), 9001), jpeg());
    // Act
    run(7 * TICK, Math.ceil(MAX_PREVIEW_BYTES / 5.5));
    await r.flush();
    // Assert: five fit; the two oldest went, and no full frame was counted as trimmed.
    const { frames } = (await r.exportBundle(META)).bundle;
    expect(frames.filter((f) => f.class === 'preview').map((f) => f.t)).toEqual(
      [4, 3, 2, 1, 0].map((back) => now() - back * TICK),
    );
    expect(frames.filter((f) => f.class !== 'preview')).toHaveLength(1);
    expect(r.stats().trimmedFrames).toBe(0);
    expect(MAX_PREVIEWS).toBeGreaterThan(5);
  });

  it('frees the previews that leave the window, and takes none while pictures are off', async () => {
    // Arrange
    const { r, run, previews } = await filming();
    // Act
    run(STRIP_BEFORE_MS + 2 * TICK);
    // Assert
    expect(previews[0]!.close).toHaveBeenCalled();
    expect(previews.at(-1)!.close).not.toHaveBeenCalled();
    r.setFlags(true, false);
    expect(previews.at(-1)!.close).toHaveBeenCalled();
    const off = jpeg();
    r.onTick(tickAt(1), off);
    expect(off.close).toHaveBeenCalled();
    expect(off.encode).not.toHaveBeenCalled();
  });

  it('says how many ticks each read kept waiting, and how many saw the screen change', async () => {
    // Arrange
    const { r } = await recorder();
    r.onTick(tickAt(1, { read: true }), null);
    r.onTick(tickAt(2, { busy: true, changed: false }), null);
    r.onTick(tickAt(3, { busy: true, changed: true }), null);
    r.onTick(tickAt(4, { busy: true, changed: true }), null);
    // Act
    r.onRead(report(1), null);
    r.onRead(report(5), null);
    // Assert
    const reads = (await r.exportBundle(META)).bundle.records.filter((x) => x.kind === 'read');
    expect(reads).toMatchObject([
      { busyTicks: 3, busyChanges: 2 },
      { busyTicks: 0, busyChanges: 0 },
    ]);
  });
});
