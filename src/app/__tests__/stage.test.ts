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
    // 화왕지절 (1402) is offered on Hard 4-5 AND across 평행중첩 6-10, so the window spans the band
    // boundary: nothing else is planned, so the player may take it on any floor from 4 to 10.
    const route = plan([9267]);
    expect(enterablePacks(route, 3, indexes)).toEqual([]);
    expect(enterablePacks(route, 4, indexes)).toEqual([
      { packId: 1402, recommended: true, window: { from: 4, to: 10 }, alternatives: [] },
    ]);
    expect(enterablePacks(route, 7, indexes)).toMatchObject([{ packId: 1402, recommended: false }]);
    expect(enterablePacks(null, 4, indexes)).toEqual([]);
  });

  it('names the other packs on the floor that would hand over the same gifts', () => {
    // 9267 인연 얽힘의 짝 comes from 화왕지절 (1402) and from 해방된 분노 (1302). 1302 is not offered
    // on floor 4, so only floor 5 has a choice to report.
    const route = plan([9267]);
    expect(enterablePacks(route, 4, indexes)[0]!.alternatives).toEqual([]);
    expect(enterablePacks(route, 5, indexes)[0]!.alternatives).toEqual([1302]);
    // A floor the plan leaves free has no pickups, so it has nothing to be an alternative to.
    expect(enterablePacks(route, 3, indexes)).toEqual([]);
  });

  it('leaves a pack that was given up out of the 「외 N」 count, as the plan itself does', () => {
    const route = plan([9267], { bannedPacks: [1302] });
    expect(route.floors.find((f) => f.packId === 1402)!.alternatives).not.toContain(1302);
    expect(enterablePacks(route, 5, indexes, new Set([1302]))[0]!.alternatives).toEqual([]);
  });

  it('lists packs that share a floor with the recommended one first, and leaves played floors out', () => {
    const route = plan([9415, 9419], { currentFloor: 2 }); // 마주하지 않는 + 낙화, both Hard 2-3
    const onTwo = enterablePacks(route, 2, indexes);
    expect(onTwo.map((p) => p.packId).sort()).toEqual([1008, 1010]);
    expect(onTwo.filter((p) => p.recommended)).toHaveLength(1);
    expect(onTwo[0]!.recommended).toBe(true);
    const played = plan([9267], { currentFloor: 6, pinnedPacks: { 4: 1402 } });
    expect(enterablePacks(played, 4, indexes)).toEqual([]);
  });

  it('offers every interchangeable route pack on the floor they all fit (the 1호선/2호선 report)', () => {
    // 뱀 허물 → 1호선 (1108, Hard 5 + 6~10), 메트로놈 → 2호선 (1109, Hard 4-5 + 6~10), 인연 얽힘 →
    // a 죄악 pack (Hard 5 + 6~10). All three fit floor 5, so all three are offered there and the
    // planner's own seat merely decides which one is 「추천」.
    const route = plan([9751, 9753, 9208]);
    const onFive = enterablePacks(route, 5, indexes);
    expect(onFive.map((p) => p.packId).sort()).toEqual([1108, 1109, 1302]);
    expect(onFive.filter((p) => p.recommended)).toHaveLength(1);
    expect(onFive[0]!.recommended).toBe(true);
    // 2호선 is offered on floor 4 as well, but 1호선 and the 죄악 pack are not.
    expect(enterablePacks(route, 4, indexes).map((p) => p.packId)).toEqual([1109]);
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
