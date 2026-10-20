import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { planExport } from '../../src/app/capture/diagnostics/export-parts.ts';
import {
  captureLayoutSchema,
  DIAG_PART_MAX_TOTAL,
  diagnosticsBundleSchema,
  diagPartSchema,
  feedbackPayloadSchema,
  type DiagnosticsBundle,
  type DiagRecord,
} from '../../src/core/schema.ts';
import {
  BUNDLE_JSON_MAX_BYTES,
  captureGeometries,
  FRAME_MAX_BYTES,
  environmentLines,
  environmentReport,
  formatReport,
  labelsFrom,
  mergeParts,
  parseBundle,
  recognitionReport,
  routeReport,
  unpackBundle,
  zipEntryFilter,
} from './capture-feedback.ts';

const layout = captureLayoutSchema.parse(JSON.parse(readFileSync('public/data/capture-layout.json', 'utf8')));

const read = (t: number, over: Partial<Extract<DiagRecord, { kind: 'read' }>> = {}): DiagRecord => ({
  kind: 'read',
  t,
  reason: 'change',
  ms: 100,
  ocrCalls: 2,
  screen: 'acquired',
  floor: null,
  pack: null,
  gift: null,
  ingredients: null,
  trace: [
    {
      step: 'title',
      region: [0, 0, 1, 1],
      light: true,
      lines: ['E.G.O 기프트를 획득했습니다.'],
      accepted: true,
    },
  ],
  events: [],
  frameId: `f${t}`,
  ...over,
});

/** A small run: two reads applied (one undone), a question answered, a miss, two floors, a run. */
function bundle(): DiagnosticsBundle {
  const records: DiagRecord[] = [
    {
      kind: 'session',
      t: 1,
      status: 'running',
      error: null,
      interval: 'balanced',
      lang: 'ko',
      captureSize: null,
    },
    read(10, { events: [{ kind: 'got', giftId: 9006 }] }),
    { kind: 'applied', t: 11, logId: 1, readT: 10, event: { kind: 'got', giftId: 9006 }, actions: [] },
    read(20, { events: [{ kind: 'got', giftId: 9007 }] }),
    { kind: 'applied', t: 21, logId: 2, readT: 20, event: { kind: 'got', giftId: 9007 }, actions: [] },
    { kind: 'undo', t: 22, logId: 2 },
    read(30, {
      screen: 'exploring',
      events: [{ kind: 'unsure', about: 'enter', floor: 2, ids: [1101, 1102] }],
    }),
    { kind: 'answer', t: 31, ask: { kind: 'pack', floor: 2, ids: [1101, 1102] }, picked: [1101] },
    read(40, { screen: null, frameId: null }),
    {
      kind: 'manual',
      t: 41,
      capturing: true,
      visits: [],
      status: [{ giftId: 9008, from: null, to: 'got' }],
      currentFloor: null,
      frameIds: ['f30'],
    },
    {
      kind: 'manual',
      t: 42,
      capturing: false,
      visits: [],
      status: [{ giftId: 9009, from: null, to: 'got' }],
      currentFloor: null,
      frameIds: [],
    },
    {
      kind: 'floor',
      t: 50,
      floor: 1,
      recommended: 1002,
      window: { from: 1, to: 1 },
      alternatives: [],
      entered: 1002,
      expected: [
        { giftId: 9403, status: 'got' },
        { giftId: 9404, status: 'failed' },
      ],
      startGifts: [9006],
    },
    {
      kind: 'floor',
      t: 60,
      floor: 2,
      recommended: 1004,
      window: null,
      alternatives: [],
      entered: 1101,
      expected: [{ giftId: 9500, status: null }],
      startGifts: [],
    },
    {
      kind: 'run',
      t: 70,
      ended: 'reset',
      goals: [
        { giftId: 9403, status: 'got' },
        { giftId: 9404, status: 'failed' },
      ],
      fusionGoal: {},
      deck: [10101],
      unresolved: [{ giftId: 9404, reason: 'pack-conflict' }],
      warnings: [],
    },
  ];
  return {
    format: 1,
    bundleId: '1',
    startedAt: 1,
    exportedAt: 80,
    dataVersion: '7.test',
    season: 7,
    layoutReference: { width: 1920, height: 1009 },
    records,
    frames: [
      { id: 'f10', t: 10, bytes: 2 },
      { id: 'f30', t: 30, bytes: 2 },
    ],
  };
}

describe('parseBundle', () => {
  it('reads session.json and pairs the frames the manifest names', () => {
    // Arrange
    const files = zipSync({
      'session.json': strToU8(JSON.stringify(bundle())),
      'frames/f10.jpg': new Uint8Array([0xff, 0xd8]),
    });
    // Act
    const { bundle: parsed, frames } = parseBundle(unzipSync(files));
    // Assert: f30 is in the manifest but not in the zip — not an error, just absent.
    expect(parsed.records).toHaveLength(bundle().records.length);
    expect([...frames.keys()]).toEqual(['f10']);
  });

  it('refuses a zip without session.json', () => {
    expect(() => parseBundle({})).toThrow('session.json');
  });
});

describe("unpackBundle (M154: a zip is someone else's file)", () => {
  /** Every file under `dir`, as paths relative to it. */
  const tree = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath, d.name).slice(dir.length + 1))
      .sort();

  it('writes session.json and plain frames, and nothing a crafted entry names', () => {
    // Arrange: a box with the sessions folder inside, so a write outside it would show.
    const box = mkdtempSync(join(tmpdir(), 'md-unpack-'));
    const root = join(box, 'sessions');
    const files = unzipSync(
      zipSync({
        'session.json': strToU8(JSON.stringify(bundle())),
        'frames/f10.jpg': new Uint8Array([0xff, 0xd8]),
        '../escaped.txt': strToU8('x'),
        'frames/../../escaped2.jpg': strToU8('x'),
        'frames/a/b.jpg': strToU8('x'),
        'frames/..jpg': strToU8('x'),
        'notes.txt': strToU8('x'),
      }),
    );
    try {
      // Act
      const { dir, skipped } = unpackBundle(root, files);
      // Assert
      expect(dir).toBe(join(root, '1'));
      expect(skipped).toBe(5);
      expect(tree(box)).toEqual(['sessions/1/frames/f10.jpg', 'sessions/1/session.json']);
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });

  it.each(['/tmp/evil', '../evil', '..', 'a/b', ''])(
    'refuses the bundle id %j, writing nothing',
    (bundleId) => {
      // Arrange
      const box = mkdtempSync(join(tmpdir(), 'md-unpack-'));
      const root = join(box, 'sessions');
      const files = { 'session.json': strToU8(JSON.stringify({ ...bundle(), bundleId })) };
      try {
        // Act / Assert
        expect(() => unpackBundle(root, files)).toThrow(/bundle id/);
        expect(existsSync(root)).toBe(false);
        expect(tree(box)).toEqual([]);
      } finally {
        rmSync(box, { recursive: true, force: true });
      }
    },
  );

  it('refuses parts whose part.json names an unsafe bundle id', () => {
    // Arrange
    const part = { bundleId: '../../x', exportedAt: 80, part: 1, total: 1, frames: [] };
    const files = { 'part.json': strToU8(JSON.stringify(part)), 'session.json': strToU8('{}') };
    // Act / Assert
    expect(() => mergeParts([{ name: 'crafted.zip', files }])).toThrow(/crafted\.zip: bundle id/);
  });
});

describe('mergeParts', () => {
  /** The bundle exported in parts by the app's own export (M146): two 50 KB frames a part. */
  async function exportedParts(over: Partial<DiagnosticsBundle> = {}) {
    const b: DiagnosticsBundle = {
      ...bundle(),
      ...over,
      frames: Array.from({ length: 6 }, (_, i) => ({
        id: `g${i}`,
        t: i,
        bytes: 50_000,
        class: 'evidence' as const,
      })),
    };
    const plan = await planExport(
      {
        bundleId: b.bundleId,
        exportedAt: b.exportedAt,
        session: JSON.stringify(b),
        frames: b.frames.map((f) => ({ ...f, blob: new Blob([new Uint8Array(f.bytes)]) })),
        name: 'md-diagnostics-20261018-1430.zip',
      },
      120_000,
    );
    const zips = await Promise.all(
      plan.names.map(async (name, i) => ({ name, files: unzipSync(await plan.zip(i)) })),
    );
    return { b, zips };
  }

  it('merges every part into one bundle with all its frames', async () => {
    // Arrange
    const { b, zips } = await exportedParts();
    // Act: given in any order.
    const { files, parts } = mergeParts([...zips].reverse());
    const { bundle: parsed, frames } = parseBundle(files);
    // Assert
    expect(zips.length).toBe(3);
    expect(parts).toEqual({ bundleId: '1', exportedAt: 80, total: 3, present: [1, 2, 3], missing: [] });
    expect(parsed.records).toHaveLength(b.records.length);
    expect([...frames.keys()].sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5']);
    expect('part.json' in files).toBe(false);
  });

  it('reports a missing part and keeps what the others hold', async () => {
    // Arrange
    const { zips } = await exportedParts();
    // Act: part 1 given twice counts once.
    const { files, parts } = mergeParts([zips[0]!, zips[2]!, zips[0]!]);
    const { frames } = parseBundle(files);
    // Assert
    expect(parts.present).toEqual([1, 3]);
    expect(parts.missing).toEqual([2]);
    expect(frames.size).toBe(4);
  });

  it('says part 1 is missing, and with it the session', async () => {
    // Arrange
    const { zips } = await exportedParts();
    // Act
    const { files, parts } = mergeParts(zips.slice(1));
    // Assert
    expect(parts.missing).toEqual([1]);
    expect(files['session.json']).toBeUndefined();
  });

  it('reads an old bundle without part.json as one whole part', () => {
    // Arrange: a zip as exported before M146.
    const files = unzipSync(
      zipSync({
        'session.json': strToU8(JSON.stringify(bundle())),
        'frames/f10.jpg': new Uint8Array([0xff, 0xd8]),
      }),
    );
    // Act
    const merged = mergeParts([{ name: 'md-diagnostics-20261016-1430.zip', files }]);
    // Assert
    expect(merged.parts).toEqual({ bundleId: '1', exportedAt: 80, total: 1, present: [1], missing: [] });
    expect([...parseBundle(merged.files).frames.keys()]).toEqual(['f10']);
  });

  it('refuses parts of two different exports, naming them', async () => {
    // Arrange: the same recording exported twice.
    const first = await exportedParts();
    const again = await exportedParts({ exportedAt: 90 });
    // Act / Assert
    expect(() => mergeParts([first.zips[0]!, again.zips[1]!])).toThrow(/2 different exports.*part2of3/);
  });

  it('puts the missing parts at the top of the report', async () => {
    // Arrange
    const { zips } = await exportedParts();
    const { files, parts } = mergeParts([zips[0]!, zips[1]!]);
    const { bundle: b, frames } = parseBundle(files);
    // Act
    const text = formatReport(
      b,
      recognitionReport(b),
      routeReport(b, () => 'general'),
      { certain: 0, unconfirmed: 0 },
      { gift: String, pack: String },
      { report: parts, framesMissing: b.frames.length - frames.size },
    );
    // Assert
    expect(text).toContain('나눠 받은 파일 2/3개 · ⚠ 빠진 파일: part3 — 이미지 2장 없음');
  });
});

describe('recognitionReport', () => {
  it('counts reads and applied events, and lists misreads and misses', () => {
    // Act
    const r = recognitionReport(bundle());
    // Assert
    expect(r).toMatchObject({ reads: 4, ocrCalls: 8, meanReadMs: 100, applied: 2, framesKept: 2 });
    expect(r.readsByScreen).toEqual({ acquired: 2, exploring: 1, '(none)': 1 });
    expect(r.misreads.map((m) => m.event)).toEqual([{ kind: 'got', giftId: 9007 }]);
    expect(r.misreads[0]!.read?.t).toBe(20);
    expect(r.questions).toEqual({ answered: 1, dismissed: 0 });
    // Only the change made while reading is a miss.
    expect(r.misses.map((m) => m.gifts)).toEqual([[9008]]);
  });
});

describe('labelsFrom', () => {
  it('labels answered frames as certain and let-stand events as unconfirmed; never an undone one', () => {
    // Act
    const { certain, unconfirmed } = labelsFrom(bundle(), layout);
    // Assert
    expect(certain).toEqual([
      { file: 'frames/f30.jpg', kind: 'screen', lang: 'ko', expect: 'exploring' },
      { file: 'frames/f30.jpg', kind: 'pack', lang: 'ko', expect: 1101, region: layout.names.mapHeader },
      { file: 'frames/f30.jpg', kind: 'floor', lang: 'ko', expect: 2 },
    ]);
    expect(unconfirmed).toEqual([
      { file: 'frames/f10.jpg', kind: 'screen', lang: 'ko', expect: 'acquired' },
      { file: 'frames/f10.jpg', kind: 'gift', lang: 'ko', expect: 9006, region: layout.names.popup },
    ]);
  });
});

describe('routeReport', () => {
  it('compares the route with the run', () => {
    // Act
    const r = routeReport(bundle(), (id) => (id === 9404 ? 'packLimited' : 'general'));
    // Assert
    expect(r).toMatchObject({ floors: 2, recommended: 2, followed: 1 });
    expect(r.offRoute).toEqual([{ floor: 2, recommended: 1004, entered: 1101 }]);
    expect(r.expected).toEqual({ got: 1, failed: 1, unmarked: 1 });
    // Missed on route only counts floors where the route was followed.
    expect(r.missedOnRoute).toEqual([{ floor: 1, packId: 1002, giftId: 9404, kind: 'packLimited' }]);
    expect(r.runs).toEqual([
      { ended: 'reset', goals: 2, got: 1, failed: 1, unresolved: { 'pack-conflict': 1 } },
    ]);
  });
});

describe('captureGeometries', () => {
  const session = (t: number, size: { width: number; height: number } | null, top?: number): DiagRecord => ({
    kind: 'session',
    t,
    status: 'running',
    error: null,
    interval: 'balanced',
    lang: 'ko',
    captureSize: size,
    ...(top === undefined ? {} : { inset: { top } }),
  });

  it('lists each size once, in order, with its title bar', () => {
    // Arrange
    const b: DiagnosticsBundle = {
      ...bundle(),
      records: [
        session(1, null),
        session(2, { width: 1928, height: 1043 }, 30),
        session(3, { width: 1928, height: 1043 }, 30),
        session(4, { width: 1920, height: 1080 }, 0),
      ],
    };

    // Act
    const sizes = captureGeometries(b);

    // Assert
    expect(sizes).toEqual(['1928×1043 (제목 표시줄 30px)', '1920×1080']);
  });

  it('gives none for a bundle that never recorded a size', () => {
    // Arrange
    const b: DiagnosticsBundle = { ...bundle(), records: [session(1, null)] };

    // Act
    const sizes = captureGeometries(b);

    // Assert
    expect(sizes).toEqual([]);
  });
});

describe('formatReport', () => {
  it('names gifts and packs and says where the frames are', () => {
    const b = bundle();
    const text = formatReport(
      b,
      recognitionReport(b),
      routeReport(b, () => 'general'),
      { certain: 3, unconfirmed: 2 },
      {
        gift: (id) => `G${id}`,
        pack: (id) => `P${id}`,
      },
    );
    expect(text).toContain('되돌림(오인식) 1건');
    expect(text).toContain('got G9007 — OCR: E.G.O 기프트를 획득했습니다. — frames/f20.jpg');
    expect(text).toContain('획득 G9008 — 직전 이미지 1장');
    expect(text).toContain('2층: 추천 P1004 → P1101');
    expect(text).toContain('1층 P1002: G9404');
    expect(text).toContain('추천 팩을 따른 층 1/2 (50%)');
  });
});

describe('filmstrips (M134)', () => {
  /** The small bundle with a filmstrip around the read at 10 and the miss at 41, and classes. */
  function filmed(): DiagnosticsBundle {
    const b = bundle();
    b.records = b.records.map((r) =>
      r.kind === 'read' && r.t === 10 ? { ...r, busyTicks: 3, busyChanges: 2 } : r,
    );
    b.records.push({ kind: 'strip', t: 45, reads: [10], manual: [41], frameIds: ['p8-1', 'p10-2', 'p44-3'] });
    b.frames = [
      { id: 'p8-1', t: 8, bytes: 1, class: 'preview' },
      { id: 'f10', t: 10, bytes: 2, class: 'sample' },
      { id: 'p10-2', t: 10, bytes: 1, class: 'preview' },
      { id: 'f30', t: 30, bytes: 2, class: 'evidence' },
      { id: 'p44-3', t: 44, bytes: 1, class: 'preview' },
    ];
    return b;
  }

  it('lists each strip with the reads and changes it was kept around and its preview files', () => {
    // Act
    const r = recognitionReport(filmed());
    // Assert
    expect(r).toMatchObject({ framesKept: 2, previewsKept: 3, framesByClass: { sample: 1, evidence: 1 } });
    expect(r.strips).toHaveLength(1);
    expect(r.strips[0]!.reads.map((x) => x.t)).toEqual([10]);
    expect(r.strips[0]!.manual.map((x) => x.t)).toEqual([41]);
    expect(r.strips[0]!.frames).toEqual([
      { file: 'frames/p8-1.jpg', dt: -2 },
      { file: 'frames/p10-2.jpg', dt: 0 },
      { file: 'frames/p44-3.jpg', dt: 34 },
    ]);
    expect(r.waiting).toEqual({ busyTicks: 3, busyChanges: 2, readsChangedUnder: 1 });
  });

  it('says nothing of waiting ticks for a bundle from before M134', () => {
    expect(recognitionReport(bundle()).waiting).toBeNull();
  });

  it('counts the reads of the popup burst and says so in the report (M136)', () => {
    // Arrange: two popup reads — one found its popup, one found none.
    const b = bundle();
    b.records.push(read(50, { mode: 'popup', ms: 150 }), read(51, { mode: 'popup', ms: 50, screen: null }));
    // Act
    const r = recognitionReport(b);
    const text = formatReport(
      b,
      r,
      routeReport(b, () => 'general'),
      { certain: 0, unconfirmed: 0 },
      {
        gift: (id) => `G${id}`,
        pack: (id) => `P${id}`,
      },
    );
    // Assert
    expect(r.popupReads).toEqual({ reads: 2, meanMs: 100, popups: 1 });
    expect(text).toContain('팝업 연속 판독 2회 · 평균 100ms · 그중 팝업 1회');
    expect(recognitionReport(bundle()).popupReads).toBeNull();
  });

  it("counts the re-reads of a fusion confirm's slots and says so in the report (M159)", () => {
    // Arrange
    const b = bundle();
    b.records.push(read(60, { mode: 'slots', ms: 30 }), read(61, { mode: 'slots', ms: 50 }));
    // Act
    const r = recognitionReport(b);
    const text = formatReport(
      b,
      r,
      routeReport(b, () => 'general'),
      { certain: 0, unconfirmed: 0 },
      {
        gift: (id) => `G${id}`,
        pack: (id) => `P${id}`,
      },
    );
    // Assert
    expect(r.slotReads).toEqual({ reads: 2, meanMs: 40 });
    expect(text).toContain('합성 칸 재판독 2회 · 평균 40ms');
    expect(recognitionReport(bundle()).slotReads).toBeNull();
  });

  it('counts the reads of popups queued under a busy read and says so in the report (M141)', () => {
    // Arrange: two queued reads — one found its popup after 300 ms, one found none after 100 ms —
    // and a later read telling of one queued popup pushed out unread.
    const b = bundle();
    b.records.push(
      read(60, { mode: 'popup', queued: true, lagMs: 300 }),
      read(61, { mode: 'popup', queued: true, lagMs: 100, screen: null }),
      read(62, { queueDropped: 1 }),
    );
    // Act
    const r = recognitionReport(b);
    const text = formatReport(
      b,
      r,
      routeReport(b, () => 'general'),
      { certain: 0, unconfirmed: 0 },
      {
        gift: (id) => `G${id}`,
        pack: (id) => `P${id}`,
      },
    );
    // Assert
    expect(r.queuedReads).toEqual({ reads: 2, popups: 1, meanLagMs: 200, dropped: 1 });
    expect(text).toContain('대기열 판독 2회 · 그중 팝업 1회 · 평균 지연 200ms · 넘침 1');
    expect(recognitionReport(bundle()).queuedReads).toBeNull();
  });

  it('counts the reads the recorder summed as the reads they were, and says so (M153)', () => {
    // Arrange: the same five reads — three popup reads of nothing in the burst (one queued, telling
    // of a popup pushed out), two reads of nothing past the cap — kept one by one (before M153) and
    // summed (M153).
    const scan = (t: number, over: Partial<Extract<DiagRecord, { kind: 'read' }>> = {}) =>
      read(t, {
        mode: 'popup',
        screen: null,
        ms: 4,
        ocrCalls: 1,
        frameId: null,
        busyTicks: 0,
        busyChanges: 0,
        ...over,
      });
    const nothing = (t: number) =>
      read(t, { screen: null, ms: 300, ocrCalls: 9, frameId: null, busyTicks: 2, busyChanges: 1 });
    const kept = bundle();
    kept.records.push(
      scan(70),
      scan(71),
      scan(72, { queued: true, lagMs: 30, queueDropped: 1, busyTicks: 1, busyChanges: 1 }),
      nothing(80),
      nothing(81),
    );
    const summed = bundle();
    const base = { lagMaxMs: 0, popups: 0, queuedPopups: 0 };
    summed.records.push(
      {
        kind: 'readSummary',
        t: 72,
        from: 70,
        cause: 'scan',
        mode: 'popup',
        reads: 3,
        ms: 12,
        ocrCalls: 3,
        queued: 1,
        lagMs: 30,
        ...base,
        lagMaxMs: 30,
        queueDropped: 1,
        busyTicks: 1,
        busyChanges: 1,
        changedUnder: 1,
        screens: { '(none)': 3 },
      },
      {
        kind: 'readSummary',
        t: 81,
        from: 80,
        cause: 'capped',
        mode: 'full',
        reads: 2,
        ms: 600,
        ocrCalls: 18,
        queued: 0,
        lagMs: 0,
        ...base,
        queueDropped: 0,
        busyTicks: 4,
        busyChanges: 2,
        changedUnder: 2,
        screens: { '(none)': 2 },
      },
    );
    const names = { gift: (id: number) => `G${id}`, pack: (id: number) => `P${id}` };
    const text = (b: DiagnosticsBundle) =>
      formatReport(
        b,
        recognitionReport(b),
        routeReport(b, () => 'general'),
        { certain: 0, unconfirmed: 0 },
        names,
      );
    // Act
    const one = recognitionReport(kept);
    const two = recognitionReport(summed);
    // Assert: the schema takes the summaries; every count comes out the same.
    expect(diagnosticsBundleSchema.safeParse(summed).success).toBe(true);
    const counts = (r: typeof one) => ({
      reads: r.reads,
      readsByScreen: r.readsByScreen,
      ocrCalls: r.ocrCalls,
      meanReadMs: r.meanReadMs,
      waiting: r.waiting,
      popupReads: r.popupReads,
      queuedReads: r.queuedReads,
    });
    expect(counts(two)).toEqual(counts(one));
    expect(one.summed).toBeNull();
    expect(two.summed).toEqual({ scans: 3, capped: 2 });
    for (const line of [
      '팝업 연속 판독 3회 · 평균 4ms · 그중 팝업 0회',
      '대기열 판독 1회 · 그중 팝업 0회 · 평균 지연 30ms · 넘침 1',
    ])
      for (const b of [kept, summed]) expect(text(b)).toContain(line);
    expect(text(summed)).toContain(
      '묶어 적은 판독: 팝업 없는 팝업 판독 3회 · ⚠ 판독 기록 상한 뒤 아무것도 찾지 못한 판독 2회(개수만)',
    );
    expect(text(kept)).not.toContain('묶어 적은 판독');
  });

  it('lists the run starts and the rollback in the report, and parses them in a bundle (M143)', () => {
    // Arrange: a new run on a run with progress, then a rollback.
    const b = bundle();
    const summary = { currentFloor: 3, visits: 2, got: 4, failed: 1, startDone: true };
    b.records.push(
      { kind: 'runMark', t: 70, mark: 'new', hadProgress: true, run: summary },
      { kind: 'runMark', t: 80, mark: 'rollback', hadProgress: false, run: { ...summary, currentFloor: 1 } },
    );
    // Act
    const zip = zipSync({ 'session.json': strToU8(JSON.stringify(b)) });
    const parsed = parseBundle(unzipSync(zip)).bundle;
    const text = formatReport(
      parsed,
      recognitionReport(parsed),
      routeReport(parsed, () => 'general'),
      { certain: 0, unconfirmed: 0 },
      { gift: (id) => `G${id}`, pack: (id) => `P${id}` },
    );
    // Assert
    expect(text).toContain('### 런 시작·되돌리기');
    expect(text).toMatch(/새 런으로 시작: 진행 있던 런 \(3층 · 입장 2 · 획득 4 · 미획득 1 · 시작 확정\)/);
    expect(text).toContain('시작 전으로 되돌림: 빈 런');
    expect(
      formatReport(
        bundle(),
        recognitionReport(bundle()),
        routeReport(bundle(), () => 'general'),
        { certain: 0, unconfirmed: 0 },
        { gift: (id) => `G${id}`, pack: (id) => `P${id}` },
      ),
    ).not.toContain('### 런 시작');
  });

  it('puts the strip files in the report and points the miss at its strip', () => {
    // Arrange
    const b = filmed();
    // Act
    const text = formatReport(
      b,
      recognitionReport(b),
      routeReport(b, () => 'general'),
      { certain: 0, unconfirmed: 0 },
      {
        gift: (id) => `G${id}`,
        pack: (id) => `P${id}`,
      },
    );
    // Assert
    expect(text).toContain('이미지 2장 (sample 1, evidence 1) · 미리 보기 3장');
    expect(text).toContain('### 필름');
    expect(text).toContain('frames/p8-1.jpg (−0.00s), frames/p10-2.jpg (+0.00s), frames/p44-3.jpg (+0.03s)');
    expect(text).toMatch(/획득 G9008 — 직전 이미지 1장 — 필름 3장/);
  });

  it('never labels a preview', () => {
    // Arrange: a read that (wrongly) names a preview as its frame.
    const b = filmed();
    b.records = b.records.map((r) => (r.kind === 'read' && r.t === 10 ? { ...r, frameId: 'p10-2' } : r));
    // Act
    const { unconfirmed } = labelsFrom(b, layout);
    // Assert
    expect(unconfirmed.map((l) => l.file)).not.toContain('frames/p10-2.jpg');
  });
});

describe('the environment (M142)', () => {
  const env = (t: number, over: Partial<Extract<DiagRecord, { kind: 'env' }>> = {}): DiagRecord => ({
    kind: 'env',
    t,
    reason: 'periodic',
    fps: { requested: 8, delivered: 7.5, setting: 8 },
    lateness: { p50: 3, p90: 20 },
    readFull: { p50: 500, p90: 900, n: 4 },
    readPopup: { p50: 34, p90: 40, n: 2 },
    queueDropped: 0,
    range: { min: 100, max: 250 },
    interval: 250,
    level: 0,
    ...over,
  });

  it('sums the env records up: rates, percentiles, overflow, intervals and time at each level', () => {
    // Arrange: 10 s calm, then 20 s at level 1, then the last record.
    const b = bundle();
    b.records.push(
      env(0),
      env(10_000, {
        reason: 'level',
        level: 1,
        fps: { requested: 30, delivered: 4, setting: 30 },
        lateness: { p50: 9, p90: 120 },
        queueDropped: 2,
        interval: 100,
      }),
      env(30_000, { readFull: { p50: 700, p90: 2100 } }),
    );
    // Act
    const r = environmentReport(b)!;
    // Assert
    expect(r).toMatchObject({
      records: 3,
      levelChanges: 1,
      fps: { requested: [8, 30], deliveredMedian: 7.5, deliveredMin: 4, setting: 8 },
      lateness: { p50: 3, p90: 120 },
      readFull: { p50: 500, p90: 2100 },
      readPopup: { p50: 34, p90: 40 },
      queueDropped: 2,
      ranges: ['100–250ms'],
      interval: { min: 100, max: 250 },
      maxLevel: 1,
      levelMs: [10_000, 20_000, 0],
    });
  });

  it('writes a 「환경」 section for a bundle that has them, and none for one before M142', () => {
    // Arrange
    const b = bundle();
    b.records.push(env(0), env(10_000, { level: 2, reason: 'level' }));
    const names = { gift: (id: number) => `G${id}`, pack: (id: number) => `P${id}` };
    const label = { certain: 0, unconfirmed: 0 };
    // Act
    const text = formatReport(
      b,
      recognitionReport(b),
      routeReport(b, () => 'general'),
      label,
      names,
    );
    const old = formatReport(
      bundle(),
      recognitionReport(bundle()),
      routeReport(bundle(), () => 'general'),
      label,
      names,
    );
    // Assert
    expect(text).toContain('## 환경');
    expect(text).toContain('- 프레임률: 요청 8 · 전달 중앙값 7.5 (최저 7.5) · 트랙 설정 8');
    expect(text).toContain('- 틱 지연: p50 3ms · p90 20ms');
    expect(text).toContain('- 부하 단계: 최고 2 · 단계별 시간 0 100% · 1 0% · 2 0%');
    expect(old).not.toContain('## 환경');
    expect(environmentReport(bundle())).toBeNull();
    expect(environmentLines(null)).toEqual([]);
  });
});

describe('zipEntryFilter (M160, B4: decided before an entry is inflated)', () => {
  const entry = (name: string, originalSize: number) => ({ name, originalSize });

  it('admits the bundle files under their limits', () => {
    expect(zipEntryFilter(entry('session.json', BUNDLE_JSON_MAX_BYTES))).toBe(true);
    expect(zipEntryFilter(entry('part.json', 10))).toBe(true);
    expect(zipEntryFilter(entry('frames/1700000000000-1.jpg', FRAME_MAX_BYTES))).toBe(true);
    expect(zipEntryFilter(entry('frames/p1700000000000-2.jpg', 0))).toBe(true);
  });

  it('refuses a frame or a JSON file that claims more than its limit', () => {
    expect(zipEntryFilter(entry('frames/1700000000000-1.jpg', FRAME_MAX_BYTES + 1))).toBe(false);
    expect(zipEntryFilter(entry('session.json', BUNDLE_JSON_MAX_BYTES + 1))).toBe(false);
    expect(zipEntryFilter(entry('part.json', 2 ** 40))).toBe(false);
  });

  it('refuses every name a bundle never holds, whatever its size', () => {
    for (const name of [
      '../escaped.txt',
      'frames/../../escaped2.jpg',
      'frames/a/b.jpg',
      'frames/..jpg',
      'frames/x.png',
      'notes.txt',
      '/etc/passwd',
      'sessions.json',
    ])
      expect(zipEntryFilter(entry(name, 1)), name).toBe(false);
  });

  it('keeps what unzipSync inflates to the admitted entries only', () => {
    const zip = zipSync({
      'session.json': strToU8('{}'),
      'frames/f1.jpg': new Uint8Array([0xff, 0xd8]),
      'frames/huge.jpg': new Uint8Array(FRAME_MAX_BYTES + 1),
      'README.md': strToU8('x'),
    });
    expect(Object.keys(unzipSync(zip, { filter: zipEntryFilter })).sort()).toEqual([
      'frames/f1.jpg',
      'session.json',
    ]);
  });
});

describe('diagPartSchema bounds (M160, B4)', () => {
  const part = (over: Partial<{ part: number; total: number }>) => ({
    bundleId: '1',
    exportedAt: 80,
    part: 1,
    total: 1,
    frames: [],
    ...over,
  });

  it('accepts a part inside its total, up to the most parts an export may have', () => {
    expect(diagPartSchema.safeParse(part({ part: 3, total: 3 })).success).toBe(true);
    expect(diagPartSchema.safeParse(part({ part: 1, total: DIAG_PART_MAX_TOTAL })).success).toBe(true);
  });

  it('refuses a total past the limit and a part past its total', () => {
    expect(diagPartSchema.safeParse(part({ part: 1, total: DIAG_PART_MAX_TOTAL + 1 })).success).toBe(false);
    expect(diagPartSchema.safeParse(part({ part: 1, total: 1e9 })).success).toBe(false);
    expect(diagPartSchema.safeParse(part({ part: 4, total: 3 })).success).toBe(false);
    expect(diagPartSchema.safeParse(part({ part: 0, total: 1 })).success).toBe(false);
  });

  it('so mergeParts cannot be made to allocate a billion parts', () => {
    const files = {
      'part.json': strToU8(JSON.stringify(part({ part: 1, total: 1e9 }))),
      'session.json': strToU8('{}'),
    };
    expect(() => mergeParts([{ name: 'crafted.zip', files }])).toThrow();
  });
});

describe('feedbackPayloadSchema.t (M160, B5)', () => {
  const shape = (t: unknown) => ({
    v: 1,
    t,
    kind: 'bug',
    title: '',
    message: 'x',
    env: {
      dataVersion: 'v',
      season: 8,
      seasonName: 's',
      lang: 'ko',
      theme: 'dark',
      viewport: '1x1',
      browser: 'b',
      touch: false,
      page: 'p',
    },
    screenshot: false,
  });

  it('accepts an epoch-ms time a Date can hold', () => {
    expect(feedbackPayloadSchema.safeParse(shape(0)).success).toBe(true);
    expect(feedbackPayloadSchema.safeParse(shape(1_760_000_000_000)).success).toBe(true);
    expect(feedbackPayloadSchema.safeParse(shape(8.64e15)).success).toBe(true);
  });

  it('refuses what toISOString would throw on, and a fraction', () => {
    expect(feedbackPayloadSchema.safeParse(shape(8.64e15 + 1)).success).toBe(false);
    expect(feedbackPayloadSchema.safeParse(shape(-1)).success).toBe(false);
    expect(feedbackPayloadSchema.safeParse(shape(Number.POSITIVE_INFINITY)).success).toBe(false);
    expect(feedbackPayloadSchema.safeParse(shape(1.5)).success).toBe(false);
  });
});
