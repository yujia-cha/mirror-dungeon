import { beforeEach, describe, expect, it } from 'vitest';
import type { Gift } from '../../../core/schema.ts';
import { emptyRun, useApp } from '../../store.ts';
import { actionsFor, answerActions, execute, inverseOf, statusDiff, type RunOps } from '../apply.ts';

const MOON = {
  aCount: 2,
  aPool: [9105, 9110, 9116, 9121, 9126, 9131, 9136],
  bCount: 3,
  bPool: [9142, 9147, 9152],
};
const giftById = new Map<number, Gift>([
  [9083, { id: 9083, fusion: { recipes: [], mixed: MOON } } as unknown as Gift],
  // A 잔영 material: held in any number.
  [9800, { id: 9800, acquisition: { kind: 'material' } } as unknown as Gift],
  // A recipe result (M151): three gifts, or four with a 잔영.
  [
    70,
    {
      id: 70,
      acquisition: { kind: 'fusionOnly' },
      fusion: { recipes: [{ ingredients: [1, 2, 3] }, { ingredients: [1, 2, 4, 9800] }] },
    } as unknown as Gift,
  ],
]);
const ctx = (
  giftStatus: Record<number, 'got' | 'failed' | 'used'>,
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

  it('marks what a fusion ate as used up when it made a gift the route collects (M149)', () => {
    // Arrange: 50 is a goal (or a goal's ingredient); 60 is not.
    const event = (resultId: number) => ({ kind: 'fused' as const, resultId, consumed: [1, 2], unsure: [4] });
    const held = ctx({ 1: 'got', 2: 'got', 4: 'got' });
    const collected = new Set([50]);
    // Act
    const upper = actionsFor(event(50), { ...held, collected });
    const other = actionsFor(event(60), { ...held, collected });
    // Assert: into a wanted gift they went up, not lost; anything else eats them for good.
    expect(upper.actions).toEqual([
      {
        kind: 'status',
        changes: [
          { giftId: 1, from: 'got', to: 'used' },
          { giftId: 2, from: 'got', to: 'used' },
        ],
      },
    ]);
    expect(other.actions[0]).toMatchObject({ changes: [{ to: null }, { to: null }] });
    // The unclear one is still asked, never guessed.
    expect(upper.ask).toEqual({ kind: 'consumed', resultId: 50, ids: [4] });
  });

  it('leaves a 잔영 material marked — held in any number, one mark cannot say the last one went', () => {
    // Arrange: two 잔영 slots read as the same material.
    const event = { kind: 'fused' as const, resultId: 50, consumed: [1, 9800], unsure: [9800] };
    // Act
    const out = actionsFor(event, ctx({ 1: 'got', 9800: 'got' }));
    // Assert
    expect(out.actions).toEqual([{ kind: 'status', changes: [{ giftId: 1, from: 'got', to: null }] }]);
    expect(out.ask).toBeNull();
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

describe('sales and fusions, the exceptions (M151)', () => {
  const statuses = (out: { actions: unknown[] }) =>
    out.actions.flatMap((a) =>
      (a as { kind: string }).kind === 'status' ? (a as { changes: unknown[] }).changes : [],
    );

  it('leaves a sold 잔영 material marked — one mark cannot say the last one went', () => {
    expect(actionsFor({ kind: 'sold', giftId: 9800 }, ctx({ 9800: 'got' }))).toEqual({
      actions: [],
      ask: null,
    });
  });

  it('does nothing for a sale of a gift used up or missed — the run does not hold it', () => {
    expect(actionsFor({ kind: 'sold', giftId: 7 }, ctx({ 7: 'used' })).actions).toEqual([]);
    expect(actionsFor({ kind: 'sold', giftId: 7 }, ctx({ 7: 'failed' })).actions).toEqual([]);
  });

  it('takes a recipe result’s ingredients from its recipe, asking nothing the icons left muddled', () => {
    // Arrange: the icons were sure of 1 only and torn between 2 and 4; the slot count says three.
    const event = { kind: 'fused' as const, resultId: 70, consumed: [1], unsure: [2, 4], filled: 3 };
    // Act
    const out = actionsFor(event, ctx({ 1: 'got', 2: 'got', 3: 'got', 4: 'got' }));
    // Assert
    expect(statuses(out)).toEqual([
      { giftId: 1, from: 'got', to: null },
      { giftId: 2, from: 'got', to: null },
      { giftId: 3, from: 'got', to: null },
    ]);
    expect(out.ask).toBeNull();
  });

  it('settles a recipe result from what the run holds when nothing on the confirm was read', () => {
    // Arrange: only the three-gift recipe is held whole (4 is not).
    const event = { kind: 'fused' as const, resultId: 70, consumed: [], unsure: [] };
    // Act
    const out = actionsFor(event, ctx({ 1: 'got', 2: 'got', 3: 'got' }));
    // Assert
    expect(statuses(out).map((c) => (c as { giftId: number }).giftId)).toEqual([1, 2, 3]);
    expect(out.ask).toBeNull();
  });

  it('asks only about what its recipes disagree on', () => {
    // Arrange: both recipes held whole and nothing read: 1 and 2 surely went, 3 or 4 is asked.
    const out = actionsFor(
      { kind: 'fused', resultId: 70, consumed: [], unsure: [] },
      ctx({ 1: 'got', 2: 'got', 3: 'got', 4: 'got' }),
    );
    expect(statuses(out).map((c) => (c as { giftId: number }).giftId)).toEqual([1, 2]);
    expect(out.ask).toEqual({ kind: 'consumed', resultId: 70, ids: [3, 4] });
  });

  it('leaves alone a held gift the icons matched that no recipe of the result names', () => {
    // Arrange: 8 was a misread (an unrecorded ingredient's icon matched the nearest held gift).
    const out = actionsFor(
      { kind: 'fused', resultId: 70, consumed: [8, 1], unsure: [], filled: 3 },
      ctx({ 1: 'got', 2: 'got', 3: 'got', 8: 'got' }),
    );
    expect(statuses(out).map((c) => (c as { giftId: number }).giftId)).not.toContain(8);
  });

  it('carries a fusion into the question its muddled result raised', () => {
    const fusing = { consumed: [1], unsure: [] };
    expect(actionsFor({ kind: 'unsure', about: 'got', ids: [70, 71], fusing }, ctx({})).ask).toEqual({
      kind: 'gift',
      ids: [70, 71],
      fusing,
    });
  });
});

describe('the 잔영 are held always (M152)', () => {
  it('records no mark for a 잔영 a popup named, nor for one an answer picked', () => {
    expect(actionsFor({ kind: 'got', giftId: 9800 }, ctx({}))).toEqual({ actions: [], ask: null });
    expect(answerActions({ kind: 'gift', ids: [9800, 7] }, [9800], ctx({})).actions).toEqual([]);
  });
});

describe('answerActions (M151)', () => {
  it('records the gift a muddled fusion result was, and settles what that fusion ate', () => {
    // Arrange: the player says the popup was 70; its recipe settles 1, 2, 3.
    const ask = { kind: 'gift' as const, ids: [70, 71], fusing: { consumed: [], unsure: [], filled: 3 } };
    // Act
    const out = answerActions(ask, [70], ctx({ 1: 'got', 2: 'got', 3: 'got' }));
    // Assert
    expect(out.actions).toEqual([
      { kind: 'status', changes: [{ giftId: 70, from: null, to: 'got' }] },
      {
        kind: 'status',
        changes: [
          { giftId: 1, from: 'got', to: null },
          { giftId: 2, from: 'got', to: null },
          { giftId: 3, from: 'got', to: null },
        ],
      },
    ]);
    expect(out.ask).toBeNull();
  });

  it('marks only the ticked ingredients the run still holds — the player may have changed one since', () => {
    const ask = { kind: 'consumed' as const, resultId: 50, ids: [1, 2, 9800] };
    const out = answerActions(ask, [1, 2, 9800], ctx({ 1: 'got', 2: 'failed', 9800: 'got' }));
    expect(out.actions).toEqual([{ kind: 'status', changes: [{ giftId: 1, from: 'got', to: null }] }]);
  });

  it('enters the picked pack, and does nothing for a dismissed question', () => {
    const pack = answerActions({ kind: 'pack', floor: 2, ids: [1005, 1006] }, [1006], ctx({}));
    expect(pack.actions[0]).toMatchObject({ kind: 'enter', floor: 2, packId: 1006 });
    expect(answerActions({ kind: 'gift', ids: [5, 6] }, [], ctx({}))).toEqual({ actions: [], ask: null });
  });
});

describe('actionsFor at the run start (M135)', () => {
  const at = (
    giftStatus: Record<number, 'got' | 'failed'>,
    more: { observed?: number[]; startDone?: boolean; currentFloor?: number } = {},
  ) => ({ ...ctx(giftStatus), ...more });

  it('marks an observed gift collected and pins it, unless it is pinned already', () => {
    // Act
    const fresh = actionsFor({ kind: 'got', giftId: 9191, source: 'observation' }, at({}));
    const pinned = actionsFor(
      { kind: 'got', giftId: 9191, source: 'observation' },
      at({}, { observed: [9191] }),
    );
    const start = actionsFor({ kind: 'got', giftId: 9044, source: 'start' }, at({}));
    // Assert
    expect(fresh.actions).toEqual([
      { kind: 'status', changes: [{ giftId: 9191, from: null, to: 'got' }] },
      { kind: 'observe', giftId: 9191 },
    ]);
    expect(pinned.actions).toEqual([{ kind: 'status', changes: [{ giftId: 9191, from: null, to: 'got' }] }]);
    expect(start.actions).toEqual([{ kind: 'status', changes: [{ giftId: 9044, from: null, to: 'got' }] }]);
  });

  it('pins an observed gift the player already marked, changing no status', () => {
    // Act
    const out = actionsFor({ kind: 'got', giftId: 5, source: 'observation' }, at({ 5: 'got' }));
    // Assert
    expect(out.actions).toEqual([{ kind: 'observe', giftId: 5 }]);
  });

  it('closes the start on floor 1 once, and leaves a run past floor 1 alone', () => {
    expect(actionsFor({ kind: 'startDone' }, at({})).actions).toEqual([{ kind: 'startDone' }]);
    expect(actionsFor({ kind: 'startDone' }, at({}, { startDone: true }))).toEqual({
      actions: [],
      ask: null,
    });
    expect(actionsFor({ kind: 'startDone' }, at({}, { currentFloor: 2 }))).toEqual({
      actions: [],
      ask: null,
    });
  });

  it('asks about a muddled popup at the start as about any gift — no observation question (M136)', () => {
    const out = actionsFor({ kind: 'unsure', about: 'got', ids: [5, 6] }, at({}));
    expect(out).toEqual({ actions: [], ask: { kind: 'gift', ids: [5, 6] } });
  });

  it('takes a pin and the closed start back, putting back the pins the settlement took off (M140)', () => {
    expect(
      inverseOf([
        { kind: 'observe', giftId: 5 },
        { kind: 'startDone', unpinned: [6, 7] },
      ]),
    ).toEqual([
      { kind: 'startOpen' },
      { kind: 'observe', giftId: 6 },
      { kind: 'observe', giftId: 7 },
      { kind: 'unobserve', giftId: 5 },
    ]);
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
    observe: (giftId) => {
      useApp.getState().recordObserved(giftId, { max: 3, observable: (id) => id !== 404 });
      return useApp.getState().options.observedGifts.includes(giftId);
    },
    unobserve: (giftId) => useApp.getState().toggleObserved(giftId, { max: 3, observable: () => true }),
    settleStart: () => useApp.getState().settleStart(),
    reopenStart: () => useApp.getState().markStartDone(false),
  };
  const apply = (event: Parameters<typeof actionsFor>[0]) => {
    const { run, options } = useApp.getState();
    const { actions } = actionsFor(event, {
      ...run,
      giftById,
      observed: options.observedGifts,
      startDone: run.startDone === true,
    });
    return execute(actions, ops);
  };
  const pins = () => useApp.getState().options.observedGifts;
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
    useApp.setState((s) => ({
      run: emptyRun(),
      wanted: [9191, 9230, 404],
      fusionGoal: {},
      options: { ...s.options, observedGifts: [] },
    }));
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

  it('records an observed gift as collected and pinned, and undoes both (M135)', () => {
    // Act
    const applied = apply({ kind: 'got', giftId: 9191, source: 'observation' });
    const during = { status: snapshot().giftStatus[9191], pins: [...pins()] };
    execute(inverseOf(applied), ops);
    // Assert
    expect(during).toEqual({ status: 'got', pins: [9191] });
    expect(snapshot().giftStatus[9191]).toBeUndefined();
    expect(pins()).toEqual([]);
  });

  it('keeps no pin the store refused — a gift that is no goal, or none to observe — so undo leaves pins alone', () => {
    // Arrange: the player pinned 9230 by hand.
    useApp.getState().toggleObserved(9230, { max: 3, observable: () => true });
    // Act
    const notGoal = apply({ kind: 'got', giftId: 9999, source: 'observation' });
    const notObservable = apply({ kind: 'got', giftId: 404, source: 'observation' });
    execute(inverseOf([...notGoal, ...notObservable]), ops);
    // Assert
    expect(notGoal.map((a) => a.kind)).toEqual(['status']);
    expect(notObservable.map((a) => a.kind)).toEqual(['status']);
    expect(pins()).toEqual([9230]);
  });

  it('pins a gift in hand on floor 1 after the start closed — an observation already spent', () => {
    // Arrange: the start closed when the player left the observation picker.
    apply({ kind: 'startDone' });
    // Act: the observation's popup is read after it.
    apply({ kind: 'got', giftId: 9230, source: 'observation' });
    // Assert
    expect(useApp.getState().run.startDone).toBe(true);
    expect(pins()).toEqual([9230]);
  });

  it('settles the start on what the popups showed: a pin no popup showed comes off, and undo puts it back (M140)', () => {
    // Arrange: two pins; only 9191's popup was read.
    const limits = { max: 3, observable: () => true };
    useApp.getState().toggleObserved(9191, limits);
    useApp.getState().toggleObserved(9230, limits);
    apply({ kind: 'got', giftId: 9191, source: 'observation' });
    // Act: floor 1's pack picker closes the start.
    const applied = apply({ kind: 'startDone' });
    const settled = { pins: [...pins()], startGifts: useApp.getState().run.startGifts };
    execute(inverseOf(applied), ops);
    // Assert
    expect(applied).toEqual([{ kind: 'startDone', unpinned: [9230] }]);
    expect(settled).toEqual({ pins: [9191], startGifts: [9191] });
    expect(useApp.getState().run.startDone).toBeUndefined();
    expect(useApp.getState().run.startGifts).toEqual([]);
    expect([...pins()].sort((a, b) => a - b)).toEqual([9191, 9230]);
  });

  it('closes the start and reopens it on undo (markStartDone)', () => {
    const applied = apply({ kind: 'startDone' });
    const closed = useApp.getState().run.startDone;
    execute(inverseOf(applied), ops);
    expect(closed).toBe(true);
    expect(useApp.getState().run.startDone).toBeUndefined();
  });
});
