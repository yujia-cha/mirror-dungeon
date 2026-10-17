import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes } from '../../../core/index.ts';
import type { FloorPlan, RoutePlan } from '../../../core/types.ts';
import type { FeedbackLogEntry } from '../../lib/feedback-log.ts';
import type { GiftStatus } from '../../lib/plan-input.ts';
import { clockOf, lastEntry, nextPack, recentLines, remainingIn } from '../overlay-model.ts';

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

describe('remainingIn (the overlay’s 「이 팩에서 남은 기프트」)', () => {
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

  it('is the route pack planned on the frontier floor', () => {
    // Arrange: one pack planned on floor 3, another whose window also covers it.
    const [planned, spanning] = offeredOn3;
    const plan = planOf([
      floorPlan({ floor: 3, packId: planned!, window: { from: 3, to: 3 } }),
      floorPlan({ floor: 4, packId: spanning!, window: { from: 3, to: 4 } }),
    ]);
    // Act
    const next = nextPack(plan, { currentFloor: 3 }, 15, indexes);
    // Assert: the one planned here comes first, as on the stage.
    expect(next).toEqual({ kind: 'pack', floor: 3, packId: planned, alternatives: 0 });
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

describe('recentLines', () => {
  const action = (t: number, text: string): FeedbackLogEntry => ({ t, kind: 'action', text });
  const capture = (id: number, at: number, undone = false) => ({ id, at, undone, label: `read ${id}` });

  it('interleaves both logs newest first and keeps five', () => {
    // Arrange
    const feedback = [action(1, 'a1'), action(3, 'a3'), action(5, 'a5'), action(7, 'a7')];
    const reads = [capture(2, 6, true), capture(1, 2)];
    // Act
    const lines = recentLines(feedback, reads, (entry) => entry.label);
    // Assert
    expect(lines.map((line) => line.text)).toEqual(['a7', 'read 2', 'a5', 'a3', 'read 1']);
    expect(lines[1]).toMatchObject({ kind: 'capture', undone: true });
  });

  it('puts the screen reader’s entry above the store change it caused in the same millisecond', () => {
    const lines = recentLines([action(10, 'gift 9001 - → got')], [capture(1, 10)], (entry) => entry.label);
    expect(lines.map((line) => line.kind)).toEqual(['capture', 'action']);
  });

  it('carries an error’s message', () => {
    const error: FeedbackLogEntry = { t: 1, kind: 'error', source: 'window', message: 'boom' };
    expect(recentLines([error], [], () => '')).toEqual([{ at: 1, kind: 'error', text: 'boom', key: 'f1-0' }]);
  });

  it('is empty with nothing logged', () => {
    expect(recentLines([], [], () => '')).toEqual([]);
  });
});

describe('clockOf', () => {
  it('pads each part to two digits', () => {
    expect(clockOf(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('03:04:05');
  });
});
