/**
 * `routeSourceOf`: where the plan gets one gift, read off the plan alone. The synthetic cases pin
 * the precedence (the user's observation beats the start gift beats a pack visit) and the reading
 * of a floor with no pack; the last case runs the real planner.
 */
import { describe, expect, it } from 'vitest';
import type { RoutePlan } from '../../../core/types.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes, defaultOptions, planRoute } from '../../../core/index.ts';
import { routeSourceOf, routeSourceText } from '../route-source.ts';

/** Only the fields `routeSourceOf` reads. */
const planOf = (
  parts: {
    observed?: number[];
    startGift?: number | null;
    floors?: [floor: number, packId: number | null, pickups: number[]][];
    fusions?: [result: number, earliestFloor: number, unreachable: boolean][];
    generalDrops?: number[];
  } = {},
): RoutePlan =>
  ({
    start: {
      observed: (parts.observed ?? []).map((giftId) => ({ giftId, pinned: true, freedPack: null })),
      startGift: parts.startGift ?? null,
    },
    floors: (parts.floors ?? []).map(([floor, packId, pickups]) => ({
      floor,
      packId,
      pickups: pickups.map((giftId) => ({ giftId, kind: 'exclusive', neededFor: null })),
    })),
    fusions: (parts.fusions ?? []).map(([result, earliestFloor, unreachable]) => ({
      result,
      ingredients: [],
      earliestFloor,
      unreachable,
      exceedsShopSlots: false,
    })),
    generalDrops: parts.generalDrops ?? [],
  }) as unknown as RoutePlan;

const packName = (id: number): string => `팩${id}`;

describe('routeSourceOf', () => {
  it('has nothing to say without a plan or for a gift the plan does not mention', () => {
    expect(routeSourceOf(null, 9001)).toBeNull();
    expect(routeSourceOf(planOf({ floors: [[2, 1102, [9706]]] }), 9001)).toBeNull();
  });

  it('reads the first floor with a pack that lists the gift, skipping floors with no pack', () => {
    const plan = planOf({
      floors: [
        [1, null, [9706]],
        [2, 1102, [9706]],
        [3, 1103, [9706]],
      ],
    });
    expect(routeSourceOf(plan, 9706)).toEqual({ kind: 'pack', floor: 2, packId: 1102 });
  });

  it('lets the observation and the starting gift beat a pack visit, in that order', () => {
    const plan = planOf({
      observed: [9431],
      startGift: 9431,
      floors: [[1, 1016, [9431]]],
    });
    expect(routeSourceOf(plan, 9431)).toEqual({ kind: 'observed' });
    expect(routeSourceOf(planOf({ startGift: 9431, floors: [[1, 1016, [9431]]] }), 9431)).toEqual({
      kind: 'start',
    });
  });

  it('reports a fusion result with its floor, and a general drop last of all', () => {
    const plan = planOf({
      fusions: [
        [9249, 2, false],
        [9280, 0, true],
      ],
      generalDrops: [9003],
    });
    expect(routeSourceOf(plan, 9249)).toEqual({ kind: 'fusion', floor: 2, unreachable: false });
    expect(routeSourceOf(plan, 9280)).toEqual({ kind: 'fusion', floor: 0, unreachable: true });
    expect(routeSourceOf(plan, 9003)).toEqual({ kind: 'general' });
  });

  it('agrees with the planner on a real fusion route', () => {
    const data = loadGameDataFromDisk();
    const indexes = buildIndexes(data);
    const deck = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
    // Observation off, or the planner observes 9431 instead of visiting 1016 for it.
    const noObservation = {
      ...data,
      rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } },
    };
    const plan = planRoute(
      {
        deck,
        wanted: [{ giftId: 9249, required: false }],
        options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1, deployed: deck.slice(0, 7) },
      },
      noObservation,
      indexes,
    );
    expect(routeSourceOf(plan, 9431)).toEqual({ kind: 'pack', floor: 1, packId: 1016 });
    expect(routeSourceOf(plan, 9706)).toEqual({ kind: 'pack', floor: 2, packId: 1102 });
    expect(routeSourceOf(plan, 9249)).toEqual({ kind: 'fusion', floor: 2, unreachable: false });
    // With observation on, the planner observes the floor-1 ingredient instead.
    const observed = planRoute(
      {
        deck,
        wanted: [{ giftId: 9249, required: false }],
        options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1, deployed: deck.slice(0, 7) },
      },
      data,
      indexes,
    );
    expect(routeSourceOf(observed, 9431)).toEqual({ kind: 'observed' });
  });
});

describe('routeSourceText', () => {
  it('writes each source in the reader’s language, with the floor unit the app uses', () => {
    const ko = { packName, lang: 'ko' as const };
    expect(routeSourceText({ kind: 'pack', floor: 5, packId: 1016 }, ko)).toBe('5층 팩1016');
    expect(routeSourceText({ kind: 'observed' }, ko)).toBe('관측');
    expect(routeSourceText({ kind: 'start' }, ko)).toBe('시작 기프트');
    expect(routeSourceText({ kind: 'general' }, ko)).toBe('범용 (팩 없음)');
    expect(routeSourceText({ kind: 'fusion', floor: 3, unreachable: false }, ko)).toBe('3층 이후 조합');
    expect(routeSourceText({ kind: 'fusion', floor: 3, unreachable: true }, ko)).toBe('조합 불가');
    const en = { packName, lang: 'en' as const };
    expect(routeSourceText({ kind: 'pack', floor: 5, packId: 1016 }, en)).toBe('floor 5, 팩1016');
    expect(routeSourceText({ kind: 'fusion', floor: 3, unreachable: false }, en)).toBe('fused after floor 3');
    // No 확정 wording: the source is a fact about the route, not a verdict on the gift.
    for (const source of [{ kind: 'general' } as const, { kind: 'observed' } as const])
      expect(routeSourceText(source, ko)).not.toMatch(/확정/);
  });
});
