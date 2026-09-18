import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { buildIndexes, planRoute } from '../../core/index.ts';
import { appDefaultOptions } from '../store.ts';
import { autoFailedFor, bandMode, enterablePacks, exclusivesIndex, packsOfferedOn, stageModeFor } from '../lib/stage.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715];
const noObservation = { ...data, rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } } };
const plan = (wanted: number[], extra = {}) =>
  planRoute({ deck: DECK, wanted: wanted.map((giftId) => ({ giftId, required: true })), options: { ...appDefaultOptions(), ...extra } }, noObservation, indexes);

describe('stage', () => {
  it('maps floors to the run mode the app plays them in', () => {
    expect([1, 5, 6, 10, 11, 15].map((f) => bandMode(indexes, f))).toEqual(['hard', 'hard', 'parallel', 'parallel', 'extreme', 'extreme']);
  });

  it('offers a route pack on every floor of its window and marks the planned floor as recommended', () => {
    const route = plan([9267]); // 화왕지절 (1402): Hard 4-5
    expect(enterablePacks(route, 3)).toEqual([]);
    expect(enterablePacks(route, 4)).toEqual([{ packId: 1402, recommended: true, window: { from: 4, to: 5 } }]);
    expect(enterablePacks(route, 5)).toEqual([{ packId: 1402, recommended: false, window: { from: 4, to: 5 } }]);
    expect(enterablePacks(null, 4)).toEqual([]);
  });

  it('lists packs that share a floor with the recommended one first, and leaves played floors out', () => {
    const route = plan([9415, 9419], { currentFloor: 2 }); // 마주하지 않는 + 낙화, both Hard 2-3
    const onTwo = enterablePacks(route, 2);
    expect(onTwo.map((p) => p.packId).sort()).toEqual([1008, 1010]);
    expect(onTwo.filter((p) => p.recommended)).toHaveLength(1);
    expect(onTwo[0]!.recommended).toBe(true);
    const played = plan([9267], { currentFloor: 6, pinnedPacks: { 4: 1402 } });
    expect(enterablePacks(played, 4)).toEqual([]);
  });

  it('knows which packs the game can offer on a floor', () => {
    expect(packsOfferedOn(indexes, 4)).toContain(1402);
    expect(packsOfferedOn(indexes, 1)).not.toContain(1402);
    expect(packsOfferedOn(indexes, 11)).toContain(1511);
    expect(packsOfferedOn(indexes, 11)).not.toContain(1402);
  });

  it('counts a boss clear reward among an EXTREME pack\'s exclusives', () => {
    const exclusivesOf = exclusivesIndex(data, indexes);
    expect(exclusivesOf(1511)).toContain(9250); // 코드 퍼플 → 보급형 K사 앰플
    expect(exclusivesOf(1402)).toEqual([9267, 9282]);
    expect(exclusivesOf(99999)).toEqual([]);
    expect(exclusivesOf(1511)).toBe(exclusivesOf(1511)); // cached
  });

  it('fails the goal exclusives the player never marked, and nothing else', () => {
    const exclusivesOf = exclusivesIndex(data, indexes);
    expect(autoFailedFor(1402, new Set([9267, 9282, 9754]), {}, exclusivesOf)).toEqual([9267, 9282]);
    expect(autoFailedFor(1402, new Set([9267, 9282]), { 9267: 'got', 9282: 'failed' }, exclusivesOf)).toEqual([]);
    expect(autoFailedFor(1402, new Set([9754]), {}, exclusivesOf)).toEqual([]);
  });

  it('tells an entered, undecided, skipped and finished floor apart', () => {
    const run = { currentFloor: 4, visits: { 2: 1008 } };
    expect([1, 2, 3, 4, 5].map((f) => stageModeFor(run, f, 15))).toEqual(['skipped', 'entered', 'skipped', 'undecided', 'undecided']);
    // 'done' is the floor past the season's end, so the last floor keeps telling the truth about itself.
    expect(stageModeFor({ currentFloor: 16, visits: {} }, 16, 15)).toBe('done');
    expect(stageModeFor({ currentFloor: 16, visits: {} }, 15, 15)).toBe('skipped');
    expect(stageModeFor({ currentFloor: 16, visits: { 15: 1511 } }, 15, 15)).toBe('entered');
    expect(stageModeFor({ currentFloor: 16, visits: { 15: 1511 } }, 16, 15)).toBe('done');
    // A shorter season moves the done floor with it.
    expect(stageModeFor({ currentFloor: 6, visits: {} }, 6, 5)).toBe('done');
    expect(stageModeFor({ currentFloor: 6, visits: {} }, 5, 5)).toBe('skipped');
  });
});
