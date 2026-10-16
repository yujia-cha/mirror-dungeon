import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { captureLayoutSchema, type DiagnosticsBundle, type DiagRecord } from '../../src/core/schema.ts';
import { formatReport, labelsFrom, parseBundle, recognitionReport, routeReport } from './capture-feedback.ts';

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
