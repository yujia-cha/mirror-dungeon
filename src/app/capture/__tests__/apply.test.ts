import { beforeEach, describe, expect, it } from 'vitest';
import type { Gift } from '../../../core/schema.ts';
import { emptyRun, useApp } from '../../store.ts';
import { actionsFor, execute, inverseOf, statusDiff, type RunOps } from '../apply.ts';

const MOON = {
  aCount: 2,
  aPool: [9105, 9110, 9116, 9121, 9126, 9131, 9136],
  bCount: 3,
  bPool: [9142, 9147, 9152],
};
const giftById = new Map<number, Gift>([
  [9083, { id: 9083, fusion: { recipes: [], mixed: MOON } } as unknown as Gift],
]);
const ctx = (
  giftStatus: Record<number, 'got' | 'failed'>,
  run: { visits?: Record<number, number>; stageFloor?: number } = {},
) => ({ giftStatus, giftById, visits: run.visits ?? {}, stageFloor: run.stageFloor ?? 1 });

describe('actionsFor', () => {
  it('enters the pack on the floor the map named, noting what it would take back', () => {
    expect(actionsFor({ kind: 'enter', floor: 3, packId: 1008 }, ctx({}, { stageFloor: 2 }))).toEqual({
      actions: [
        { kind: 'enter', floor: 3, packId: 1008, replaced: null, movedFrom: null, stageFrom: 2, changes: [] },
      ],
      ask: null,
    });
  });

  it('does nothing for an entry the run already holds — each session sees the map again', () => {
    // Arrange: the player entered 1008 on floor 3 by hand; a new session reads the same map.
    const run = { visits: { 3: 1008 }, stageFloor: 3 };
    // Act
    const out = actionsFor({ kind: 'enter', floor: 3, packId: 1008 }, ctx({}, run));
    // Assert
    expect(out).toEqual({ actions: [], ask: null });
  });

  it('notes the pack an entry replaces on its floor, and the floor a pack moves from', () => {
    // Arrange
    const run = { visits: { 2: 1005, 3: 1008 }, stageFloor: 4 };
    // Act
    const replaced = actionsFor({ kind: 'enter', floor: 3, packId: 1009 }, ctx({}, run));
    const moved = actionsFor({ kind: 'enter', floor: 4, packId: 1005 }, ctx({}, run));
    // Assert
    expect(replaced.actions[0]).toMatchObject({ replaced: 1008, movedFrom: null, stageFrom: 4 });
    expect(moved.actions[0]).toMatchObject({ replaced: null, movedFrom: 2, stageFrom: 4 });
  });

  it('marks a gift collected, and does nothing for one already collected', () => {
    // Arrange: a missed gift turns into got too — the screen saw it in hand.
    const fresh = actionsFor({ kind: 'got', giftId: 7 }, ctx({ 8: 'failed' }));
    const failed = actionsFor({ kind: 'got', giftId: 8 }, ctx({ 8: 'failed' }));
    const already = actionsFor({ kind: 'got', giftId: 7 }, ctx({ 7: 'got' }));
    // Assert
    expect(fresh.actions).toEqual([{ kind: 'status', changes: [{ giftId: 7, from: null, to: 'got' }] }]);
    expect(failed.actions).toEqual([{ kind: 'status', changes: [{ giftId: 8, from: 'failed', to: 'got' }] }]);
    expect(already).toEqual({ actions: [], ask: null });
  });

  it('unmarks a sold gift only if it was marked collected', () => {
    expect(actionsFor({ kind: 'sold', giftId: 7 }, ctx({ 7: 'got' })).actions).toEqual([
      { kind: 'status', changes: [{ giftId: 7, from: 'got', to: null }] },
    ]);
    expect(actionsFor({ kind: 'sold', giftId: 7 }, ctx({})).actions).toEqual([]);
  });

  it('unmarks what a fusion ate among held gifts, and asks about the unclear ones', () => {
    // Arrange: 3 is not held (a material never recorded), 4 is unclear.
    const event = { kind: 'fused' as const, resultId: 50, consumed: [1, 2, 3], unsure: [4, 9] };
    // Act
    const out = actionsFor(event, ctx({ 1: 'got', 2: 'got', 4: 'got', 50: 'got' }));
    // Assert
    expect(out.actions).toEqual([
      {
        kind: 'status',
        changes: [
          { giftId: 1, from: 'got', to: null },
          { giftId: 2, from: 'got', to: null },
        ],
      },
    ]);
    expect(out.ask).toEqual({ kind: 'consumed', resultId: 50, ids: [4] });
  });

  it('settles 달의 기억 from its recipe when the confirm screen was not read', () => {
    // Arrange: two shards and all three memories held — nothing to tell apart.
    const held = { 9105: 'got', 9131: 'got', 9142: 'got', 9147: 'got', 9152: 'got', 9083: 'got' } as const;
    // Act
    const out = actionsFor({ kind: 'fused', resultId: 9083, consumed: [], unsure: [] }, ctx(held));
    // Assert
    expect(out.actions[0]).toMatchObject({ kind: 'status' });
    const changes = out.actions[0]!.kind === 'status' ? out.actions[0]!.changes.map((c) => c.giftId) : [];
    expect(changes).toEqual([9105, 9131, 9142, 9147, 9152]);
    expect(out.ask).toBeNull();
  });

  it('asks which shards went when 달의 기억 had more to choose from', () => {
    const held = { 9105: 'got', 9110: 'got', 9131: 'got', 9142: 'got', 9147: 'got', 9152: 'got' } as const;
    const out = actionsFor({ kind: 'fused', resultId: 9083, consumed: [], unsure: [] }, ctx(held));
    expect(out.ask).toEqual({ kind: 'consumed', resultId: 9083, ids: [9105, 9110, 9131] });
  });

  it('turns an unsure read into a question and changes nothing', () => {
    expect(actionsFor({ kind: 'unsure', about: 'got', ids: [5, 6] }, ctx({}))).toEqual({
      actions: [],
      ask: { kind: 'gift', ids: [5, 6] },
    });
    expect(actionsFor({ kind: 'unsure', about: 'enter', floor: 2, ids: [1, 2] }, ctx({})).ask).toEqual({
      kind: 'pack',
      floor: 2,
      ids: [1, 2],
    });
  });
});

describe('statusDiff', () => {
  it('lists every gift whose status changed, by id', () => {
    expect(statusDiff({ 1: 'got', 2: 'failed', 3: 'got' }, { 1: 'got', 3: 'failed', 4: 'got' })).toEqual([
      { giftId: 2, from: 'failed', to: null },
      { giftId: 3, from: 'got', to: 'failed' },
      { giftId: 4, from: null, to: 'got' },
    ]);
  });
});

describe('inverseOf', () => {
  it('takes an entry back by leaving, and swaps every status change, last first', () => {
    const inverse = inverseOf([
      { kind: 'enter', floor: 1, packId: 1002, replaced: null, movedFrom: null, stageFrom: 1, changes: [] },
      { kind: 'status', changes: [{ giftId: 7, from: null, to: 'got' }] },
    ]);
    expect(inverse).toEqual([
      { kind: 'status', changes: [{ giftId: 7, from: 'got', to: null }] },
      { kind: 'leave', packId: 1002 },
      { kind: 'rewind', from: 1, to: 1, changes: [] },
    ]);
  });

  it('puts back the pack an entry replaced and the one it moved, then rewinds the walk', () => {
    // Arrange: the entry replaced 1008 on floor 3, moved 1009 off floor 5, and walked from floor 2.
    const changes = [{ giftId: 9, from: null, to: 'failed' as const }];
    // Act
    const inverse = inverseOf([
      { kind: 'enter', floor: 3, packId: 1009, replaced: 1008, movedFrom: 5, stageFrom: 2, changes },
    ]);
    // Assert
    expect(inverse).toEqual([
      { kind: 'leave', packId: 1009 },
      { kind: 'revisit', floor: 5, packId: 1009 },
      { kind: 'revisit', floor: 3, packId: 1008 },
      { kind: 'rewind', from: 3, to: 2, changes: [{ giftId: 9, from: 'failed', to: null }] },
    ]);
  });
});

describe('execute', () => {
  /**
   * The store's own run actions, with an `enterAt` that settles the floors it walks past the way
   * the plan's does: here every skipped floor misses gift 900 + floor.
   */
  const ops: RunOps = {
    run: () => useApp.getState().run,
    enterAt: (floor, packId) => {
      const s = useApp.getState();
      const failed: number[] = [];
      for (let f = s.run.stageFloor; f < floor; f += 1) failed.push(900 + f);
      s.visitPack(packId, floor, { got: s.run.currentFloor === 1 ? [77] : [], failed });
      if (floor !== s.run.stageFloor) useApp.getState().setStageFloor(floor);
    },
    leave: (packId) => useApp.getState().unvisitPack(packId, { reset: [] }),
    visit: (floor, packId) => useApp.getState().visitPack(packId, floor),
    setStageFloor: (floor) => useApp.getState().setStageFloor(floor),
    setGiftStatus: (giftId, status) => useApp.getState().setGiftStatus(giftId, status),
  };
  const enter = (floor: number, packId: number) => {
    const s = useApp.getState();
    const { actions } = actionsFor({ kind: 'enter', floor, packId }, { ...s.run, giftById });
    return execute(actions, ops);
  };
  const snapshot = () => {
    const { currentFloor, stageFloor, visits, giftStatus, startGifts } = useApp.getState().run;
    return { currentFloor, stageFloor, visits, giftStatus, startGifts };
  };

  beforeEach(() => {
    useApp.setState({ run: emptyRun() });
  });

  it('undoes an entry the reader made past the stage completely: entry, walk and stage', () => {
    // Arrange: floor 1 entered by hand and left; the stage stands on floor 2.
    useApp.getState().visitPack(1001, 1, { got: [77] });
    useApp.getState().setStageFloor(2);
    useApp.getState().setGiftStatus(5, 'got');
    const before = snapshot();
    // Act: the reader sees floor 4 (floors 2 and 3 walked past), then the player undoes it.
    const applied = enter(4, 1004);
    const during = snapshot();
    execute(inverseOf(applied), ops);
    // Assert
    expect(during).toMatchObject({ currentFloor: 5, stageFloor: 4, visits: { 1: 1001, 4: 1004 } });
    expect(during.giftStatus).toMatchObject({ 902: 'failed', 903: 'failed' });
    expect(snapshot()).toEqual(before);
  });

  it('undoes an entry that replaced the pack on its floor by putting that pack back', () => {
    // Arrange: 1003 entered on floor 3 by hand; the reader then reads 1009 there.
    useApp.getState().visitPack(1001, 1, { got: [77] });
    useApp.getState().visitPack(1002, 2);
    useApp.getState().visitPack(1003, 3);
    useApp.getState().setStageFloor(3);
    const before = snapshot();
    // Act
    const applied = enter(3, 1009);
    execute(inverseOf(applied), ops);
    // Assert
    expect(snapshot()).toEqual(before);
  });

  it('takes back the run start an entry on floor 1 made', () => {
    // Arrange
    const before = snapshot();
    // Act
    const applied = enter(1, 1001);
    const during = snapshot();
    execute(inverseOf(applied), ops);
    // Assert
    expect(during.startGifts).toEqual([77]);
    expect(snapshot()).toEqual(before);
  });

  it('only takes the entry out once the player has moved on from it', () => {
    // Arrange: the reader entered floor 2 from floor 1's stage; the player then entered floor 3.
    useApp.getState().visitPack(1001, 1, { got: [77] });
    const applied = enter(2, 1002);
    useApp.getState().visitPack(1003, 3);
    useApp.getState().setStageFloor(4);
    // Act
    execute(inverseOf(applied), ops);
    // Assert: floor 2 is a skip now; the stage and the run start stay where the player left them.
    expect(snapshot()).toMatchObject({
      currentFloor: 4,
      stageFloor: 4,
      visits: { 1: 1001, 3: 1003 },
      startGifts: [77],
    });
    expect(snapshot().giftStatus[77]).toBe('got');
  });
});
