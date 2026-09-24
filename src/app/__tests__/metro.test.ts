import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { buildIndexes, defaultOptions, planRoute } from '../../core/index.ts';
import { assignLanes, segmentsFor, stackBlocks } from '../lib/metro.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const noObservation = {
  ...data,
  rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } },
};
const DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715];
const plan = (...gifts: number[]) =>
  planRoute(
    {
      deck: DECK,
      wanted: gifts.map((giftId) => ({ giftId, required: true })),
      options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1 },
    },
    noObservation,
    indexes,
  );

describe('metro segments', () => {
  it('keeps partly overlapping windows apart, with suggested floors and the shared station marked', () => {
    // 마주하지 않는 (Hard 2-3) and 기어오는 심연 (Hard 3-4): each window assumes the other moves.
    const metro = segmentsFor(plan(9415, 9427));
    expect(metro.segments.map((s) => [s.from, s.to, s.partial, s.lane])).toEqual([
      [2, 3, true, 0],
      [3, 4, true, 1],
    ]);
    expect(metro.segments[0]!.packs.map((p) => p.floor)).toEqual([2]);
    expect(metro.segments[1]!.packs.map((p) => p.floor)).toEqual([3]);
    expect([...metro.overlap]).toEqual([3]);
    expect(metro.lanes).toBe(2);
  });

  it('merges packs whose windows are identical into one segment with no suggested floor', () => {
    const metro = segmentsFor(plan(9415, 9419)); // both Hard 2-3
    expect(metro.segments).toHaveLength(1);
    const [segment] = metro.segments;
    expect(segment!.packs.map((p) => p.packId).sort()).toEqual([1008, 1010]);
    expect(segment!.partial).toBe(false);
    expect(metro.overlap.size).toBe(0);
  });

  it('shows the third pack as fixed when the planner has already contracted it', () => {
    const metro = segmentsFor(plan(9415, 9419, 9427));
    expect(metro.segments.map((s) => [s.from, s.to, s.fixed, s.packs.length])).toEqual([
      [2, 3, false, 2],
      [4, 4, true, 1],
    ]);
    expect(metro.segments.every((s) => !s.partial)).toBe(true);
  });

  it('gives a chain of overlapping windows three lanes and two shared stations', () => {
    const metro = segmentsFor(plan(9407, 9415, 9427)); // 1-2 / 2-3 / 3-4
    expect(metro.segments.map((s) => [s.from, s.to, s.partial])).toEqual([
      [1, 2, true],
      [2, 3, true],
      [3, 4, true],
    ]);
    expect([...metro.overlap].sort()).toEqual([2, 3]);
    expect(new Set(metro.segments.map((s) => s.lane)).size).toBe(2);
  });

  it('rides the 평행중첩 packs and five EXTREME packs on one segment per band', () => {
    // 교본·검과 작품·끊어지지 않는 are all Hard 5 + 6~10, so all three share one window and one
    // segment: the player may take any of them on any of floors 5-10.
    const metro = segmentsFor(plan(9283, 9222, 9217, 9250, 9251, 9252, 9253, 9254));
    expect(metro.segments.map((s) => [s.from, s.to, s.fixed, s.packs.length])).toEqual([
      [5, 10, false, 3],
      [11, 15, false, 5],
    ]);
    expect(metro.segments.every((s) => !s.partial)).toBe(true);
    expect(metro.freeRuns).toEqual([{ from: 1, to: 4, passed: false }]);
  });

  it('stacks a card only over the cards it overlaps, by their height', () => {
    // A tall two-row card (250) climbs over the first; the third overlaps the tall one and so
    // climbs above it, while the card past its end stays on the baseline.
    const blocks: [number, number, number][] = [
      [0, 100, 140],
      [90, 200, 250],
      [150, 220, 140],
      [230, 300, 140],
    ];
    expect(
      stackBlocks(
        blocks,
        (b) => [b[0], b[1]],
        (b) => b[2],
        8,
      ),
    ).toEqual([0, 148, 406, 0]);
  });

  it('assigns lanes first-fit over any extent', () => {
    expect(
      assignLanes(
        [
          [0, 100],
          [50, 120],
          [110, 200],
        ] as [number, number][],
        (e) => e,
        8,
      ),
    ).toEqual([0, 1, 0]); // the third starts after lane 0 plus the gap
  });
});
