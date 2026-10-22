import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes } from '../../../core/index.ts';
import type { FloorPlan, RoutePlan } from '../../../core/types.ts';
import type { GiftStatus } from '../../lib/plan-input.ts';
import {
  clockOf,
  lastEntry,
  nextPack,
  recentLines,
  type RecentLine,
  remainingIn,
  shopView,
  startCandidates,
  startEvidence,
  startInitiallyOn,
  startPicks,
} from '../overlay-model.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);

/** What the route expects of each entry, per floor (stands in for `PlanState.expectedIn`). */
const expected: Record<number, number[]> = { 1: [9001, 9002], 3: [9100, 9101, 9102] };
const expectedIn = (floor: number) => expected[floor] ?? [];

const runWith = (visits: Record<number, number>, giftStatus: Record<number, GiftStatus> = {}) => ({
  visits,
  giftStatus,
});

describe('lastEntry', () => {
  it('is the entry on the highest floor, not the one recorded last', () => {
    // Arrange: keys in insertion order 3 then 1.
    const run = runWith({ 3: 1300, 1: 1100 });
    // Act / Assert
    expect(lastEntry(run)).toEqual({ floor: 3, packId: 1300 });
  });

  it('is null before the first entry', () => {
    expect(lastEntry(runWith({}))).toBeNull();
  });
});

describe('remainingIn (the overlay’s 「이 팩에서 챙길 기프트」)', () => {
  it('is null before any entry', () => {
    // Arrange / Act
    const left = remainingIn(runWith({}), expectedIn);
    // Assert
    expect(left).toBeNull();
  });

  it('lists only what is not yet marked when some of it is in hand', () => {
    // Arrange: floor 3 entered, one of three gifts collected.
    const run = runWith({ 1: 1100, 3: 1300 }, { 9101: 'got' });
    // Act
    const left = remainingIn(run, expectedIn);
    // Assert
    expect(left).toEqual({
      floor: 3,
      packId: 1300,
      expected: [9100, 9101, 9102],
      remaining: [9100, 9102],
      // M157: the collected one stays listed, in its place, to be shown marked.
      listed: [9100, 9101, 9102],
    });
  });

  it('is empty once everything expected is collected', () => {
    const run = runWith({ 3: 1300 }, { 9100: 'got', 9101: 'got', 9102: 'got' });
    expect(remainingIn(run, expectedIn)?.remaining).toEqual([]);
  });

  it('does not count a missed gift as left: only leaving the floor writes 「미획득」', () => {
    // Arrange: the floor was left with one gift unmarked, so the settle failed it.
    const run = runWith({ 3: 1300 }, { 9100: 'got', 9101: 'failed' });
    // Act
    const left = remainingIn(run, expectedIn);
    // Assert: the failed one is behind the player; only the unmarked one stays.
    expect(left?.remaining).toEqual([9102]);
    // …and the list keeps the collected one but not the missed one.
    expect(left?.listed).toEqual([9100, 9102]);
  });

  it('still names the last floor’s pack when the frontier has passed the last floor', () => {
    // Arrange: the run is over (frontier 16); floor 15 was entered and settled on leaving.
    const run = { ...runWith({ 15: 1500 }, { 9500: 'got', 9501: 'failed' }), currentFloor: 16 };
    // Act
    const left = remainingIn(run, (floor) => (floor === 15 ? [9500, 9501] : []));
    // Assert
    expect(left).toMatchObject({ floor: 15, packId: 1500, remaining: [] });
  });
});

describe('nextPack', () => {
  const floorPlan = (over: Partial<FloorPlan>): FloorPlan => ({
    floor: 1,
    mode: 'hard',
    packId: null,
    reason: 'required',
    passed: false,
    pickups: [],
    observation: { needed: false, possible: true, starlight: 0 },
    alternatives: [],
    window: null,
    ...over,
  });
  const planOf = (floors: FloorPlan[]) => ({ floors }) as unknown as RoutePlan;
  const offeredOn3 = indexes.packsByFloor.hard.get(3) ?? [];

  it('lists every route pack the frontier floor can take, the one planned there first', () => {
    // Arrange: one pack planned on floor 3, another whose window also covers it.
    const [planned, spanning] = offeredOn3;
    const plan = planOf([
      floorPlan({ floor: 3, packId: planned!, window: { from: 3, to: 3 } }),
      floorPlan({ floor: 4, packId: spanning!, window: { from: 3, to: 4 } }),
    ]);
    // Act
    const next = nextPack(plan, { currentFloor: 3 }, 15, indexes);
    // Assert: both, the one planned here first as on the stage (M148 — not just the first).
    expect(next).toEqual({
      kind: 'pack',
      floor: 3,
      packs: [
        { packId: planned, planned: true, alternatives: 0 },
        { packId: spanning, planned: false, alternatives: 0 },
      ],
    });
  });

  it('leaves out a route pack whose window does not reach the frontier floor', () => {
    // Arrange: the boundary — a window that ends on floor 2 and one that starts on floor 4.
    const [planned, before, after] = offeredOn3;
    const plan = planOf([
      floorPlan({ floor: 2, packId: before!, window: { from: 1, to: 2 } }),
      floorPlan({ floor: 3, packId: planned!, window: { from: 3, to: 3 } }),
      floorPlan({ floor: 4, packId: after!, window: { from: 4, to: 5 } }),
    ]);
    // Act
    const next = nextPack(plan, { currentFloor: 3 }, 15, indexes);
    // Assert
    expect(next.kind === 'pack' ? next.packs.map((row) => row.packId) : []).toEqual([planned]);
  });

  it('says why when there is no plan, no pack on the floor, or the run is over', () => {
    const plan = planOf([floorPlan({ floor: 3, packId: offeredOn3[0]!, window: { from: 3, to: 3 } })]);
    expect(nextPack(null, { currentFloor: 2 }, 15, indexes)).toEqual({ kind: 'noPlan', floor: 2 });
    expect(nextPack(plan, { currentFloor: 2 }, 15, indexes)).toEqual({ kind: 'none', floor: 2 });
    // The boundary: the last floor still has a next pack; the floor after it is the end.
    expect(nextPack(plan, { currentFloor: 15 }, 15, indexes).kind).toBe('none');
    expect(nextPack(plan, { currentFloor: 16 }, 15, indexes)).toEqual({ kind: 'done' });
  });
});

describe('recentLines (M151)', () => {
  const line = (at: number, kind: RecentLine['kind'], text: string, about?: string[]): RecentLine => ({
    at,
    kind,
    text,
    key: `${kind}${at}${text}`,
    ...(about ? { about } : {}),
  });

  it('interleaves the lines newest first and keeps five', () => {
    // Arrange
    const lines = [
      line(1, 'action', 'a1'),
      line(3, 'action', 'a3'),
      line(5, 'action', 'a5'),
      line(7, 'action', 'a7'),
      { ...line(6, 'capture', 'read 2'), undone: true },
      line(2, 'capture', 'read 1'),
    ];
    // Act
    const shown = recentLines(lines);
    // Assert
    expect(shown.map((l) => l.text)).toEqual(['a7', 'read 2', 'a5', 'a3', 'read 1']);
    expect(shown[1]).toMatchObject({ kind: 'capture', undone: true });
  });

  it('drops a run fact the screen reader’s entry already said, and keeps one it did not', () => {
    // Arrange: the reader got 9001; the store marked it got in the same moment, and 9002 by hand.
    const lines = [
      line(1_000, 'capture', 'got 9001', ['g9001']),
      line(1_002, 'action', 'marked 9001', ['g9001']),
      line(1_003, 'action', 'marked 9002', ['g9002']),
      line(9_000, 'action', 'marked 9001 again', ['g9001']),
    ];
    // Act + Assert: the echo goes; a later change of the same gift is news.
    expect(recentLines(lines).map((l) => l.text)).toEqual(['marked 9001 again', 'marked 9002', 'got 9001']);
  });

  it('puts the screen reader’s entry above a change in the same millisecond', () => {
    const shown = recentLines([line(10, 'action', 'other', ['g1']), line(10, 'capture', 'read', ['g2'])]);
    expect(shown.map((l) => l.kind)).toEqual(['capture', 'action']);
  });

  it('is empty with nothing logged', () => {
    expect(recentLines([])).toEqual([]);
  });
});

describe('clockOf', () => {
  it('pads each part to two digits', () => {
    expect(clockOf(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('03:04:05');
  });
});

describe('startCandidates (M138, M140)', () => {
  const plan = {
    start: {
      startGifts: [9044],
      observed: [
        { giftId: 9086, pinned: true, freedPack: null },
        { giftId: 9044, pinned: false, freedPack: null },
        { giftId: 9088, pinned: false, freedPack: null },
      ],
    },
  } as unknown as RoutePlan;
  const floor1 = (giftStatus: Record<number, GiftStatus> = {}) => ({ currentFloor: 1, giftStatus });

  it('lists the start gifts, then the observations, then what floor 1 collected beyond them, once each', () => {
    expect(startCandidates(plan, floor1({ 9086: 'got', 9500: 'got', 9600: 'failed' }))).toEqual([
      { giftId: 9044, kind: 'start' },
      { giftId: 9086, kind: 'pinned' },
      { giftId: 9088, kind: 'recommended' },
      { giftId: 9500, kind: 'got' },
    ]);
  });

  it('is null once the start is closed, past floor 1, without a plan, or with nothing to list', () => {
    expect(startCandidates(plan, { ...floor1(), startDone: true })).toBeNull();
    expect(startCandidates(plan, { currentFloor: 2, giftStatus: {} })).toBeNull();
    expect(startCandidates(null, floor1())).toBeNull();
    const empty = { start: { startGifts: [], observed: [] } } as unknown as RoutePlan;
    expect(startCandidates(empty, floor1())).toBeNull();
    expect(startCandidates(empty, floor1({ 9500: 'got' }))).toEqual([{ giftId: 9500, kind: 'got' }]);
  });
});

describe('startEvidence and startInitiallyOn (M140)', () => {
  const candidates = [
    { giftId: 1, kind: 'start' as const },
    { giftId: 2, kind: 'pinned' as const },
  ];

  it('is what floor 1 marked collected, and nothing past it', () => {
    expect(startEvidence({ currentFloor: 1, giftStatus: { 1: 'got', 2: 'failed' } })).toEqual([1]);
    expect(startEvidence({ currentFloor: 2, giftStatus: { 1: 'got' } })).toEqual([]);
  });

  it('starts on the evidence with the reader running, and on everything without it', () => {
    expect([...startInitiallyOn(candidates, [2], true)]).toEqual([2]);
    expect([...startInitiallyOn(candidates, [], true)]).toEqual([]);
    expect([...startInitiallyOn(candidates, [2], false)]).toEqual([1, 2]);
  });
});

describe('startPicks (M138)', () => {
  const candidates = [
    { giftId: 1, kind: 'start' as const },
    { giftId: 2, kind: 'pinned' as const },
    { giftId: 3, kind: 'recommended' as const },
    { giftId: 4, kind: 'got' as const },
  ];

  it('collects what is on, drops what is off, and pins only the planned observations among what is on', () => {
    expect(startPicks(candidates, new Set([1, 3, 4]))).toEqual({
      got: [1, 3, 4],
      dropped: [2],
      observed: [3],
    });
  });

  it('records nothing when everything is off', () => {
    expect(startPicks(candidates, new Set())).toEqual({ got: [], dropped: [1, 2, 3, 4], observed: [] });
  });
});

describe('shopView (M148)', () => {
  const groups = [
    { id: 'keyword', gifts: [{ id: 1 }, { id: 2 }] },
    { id: 'shard', gifts: [{ id: 3 }] },
    { id: 'plain', gifts: [{ id: 4 }] },
  ];
  const exclusives: Record<number, number[]> = { 1002: [9001, 9002], 1005: [9100] };
  const exclusivesOf = (packId: number) => exclusives[packId] ?? [];

  it('lists the last entered pack’s exclusives and the tracker without shards — no goals (M151)', () => {
    // Arrange
    const run = { visits: { 1: 1005, 2: 1002 } };
    // Act
    const view = shopView(run, exclusivesOf, groups);
    // Assert
    expect(view).toEqual({ packId: 1002, exclusive: [9001, 9002], t4: [1, 2, 4] });
  });

  it('asks the exclusives as entered on that floor, so the last floor shows no clear reward (M173)', () => {
    // Arrange: an index that drops 9002 when asked about floor 15.
    const byFloor = (packId: number, floor?: number) =>
      (exclusives[packId] ?? []).filter((id) => !(floor === 15 && id === 9002));
    // Act
    const view = shopView({ visits: { 14: 1005, 15: 1002 } }, byFloor, groups);
    // Assert
    expect(view).toMatchObject({ packId: 1002, exclusive: [9001] });
  });

  it('has no pack and no exclusives before the first entry', () => {
    const view = shopView({ visits: {} }, exclusivesOf, groups);
    expect(view).toMatchObject({ packId: null, exclusive: [] });
  });

  it('puts the route’s goals first in both lists, keeping the rest in order (M169)', () => {
    // Arrange: 9002 (an exclusive) and 4 (a tier-4 gift) are goals.
    const run = { visits: { 1: 1005, 2: 1002 } };
    // Act
    const view = shopView(run, exclusivesOf, groups, new Set([9002, 4]));
    // Assert
    expect(view).toEqual({ packId: 1002, exclusive: [9002, 9001], t4: [4, 1, 2] });
  });
});
