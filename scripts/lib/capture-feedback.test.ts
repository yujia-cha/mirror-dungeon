import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { captureLayoutSchema, type DiagnosticsBundle, type DiagRecord } from '../../src/core/schema.ts';
import {
  captureGeometries,
  formatReport,
  labelsFrom,
  parseBundle,
  recognitionReport,
  routeReport,
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
