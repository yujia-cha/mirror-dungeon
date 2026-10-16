import { describe, expect, it } from 'vitest';
import type { Gift } from '../../../core/schema.ts';
import { actionsFor, inverseOf } from '../apply.ts';

const MOON = {
  aCount: 2,
  aPool: [9105, 9110, 9116, 9121, 9126, 9131, 9136],
  bCount: 3,
  bPool: [9142, 9147, 9152],
};
const giftById = new Map<number, Gift>([
  [9083, { id: 9083, fusion: { recipes: [], mixed: MOON } } as unknown as Gift],
]);
const ctx = (giftStatus: Record<number, 'got' | 'failed'>) => ({ giftStatus, giftById });

describe('actionsFor', () => {
  it('enters the pack on the floor the map named', () => {
    expect(actionsFor({ kind: 'enter', floor: 3, packId: 1008 }, ctx({}))).toEqual({
      actions: [{ kind: 'enter', floor: 3, packId: 1008 }],
      ask: null,
    });
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

describe('inverseOf', () => {
  it('takes an entry back by leaving, and swaps every status change, last first', () => {
    const inverse = inverseOf([
      { kind: 'enter', floor: 1, packId: 1002 },
      { kind: 'status', changes: [{ giftId: 7, from: null, to: 'got' }] },
    ]);
    expect(inverse).toEqual([
      { kind: 'status', changes: [{ giftId: 7, from: 'got', to: null }] },
      { kind: 'leave', packId: 1002 },
    ]);
  });
});
