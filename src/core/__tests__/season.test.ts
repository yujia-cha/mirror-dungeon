/**
 * A season that opens fewer floors than Mirror Dungeon 7.
 *
 * Mirror Dungeon 8 is expected to open 1~5 before the rest, and no data for it exists yet, so the
 * floor range is exercised here with the live data reshaped to a five-floor season. What this
 * guards is that the run's shape comes from `rules.floors` and not from the numbers 6 and 11 —
 * before this, three places in the planner and the app knew 15 by heart.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { buildIndexes, defaultOptions, planRoute } from '../index.ts';
import { modeForFloor } from '../search.ts';
import type { GameData } from '../schema.ts';

const md7 = loadGameDataFromDisk();
const md7Indexes = buildIndexes(md7);

/** The same data as a season that has opened only its first five floors. */
const shortSeason: GameData = {
  ...md7,
  meta: { ...md7.meta, dungeon: { id: 8, name: { ko: '짧은 거울', en: 'Short Mirror' } }, provisional: true },
  rules: {
    ...md7.rules,
    dungeonId: 8,
    floors: { normal: [1, 2, 3, 4, 5], hard: [1, 2, 3, 4, 5], parallel: [], extreme: [] },
  },
};
const shortIndexes = buildIndexes(shortSeason);

const DECK = [10101, 10203, 10312, 10403, 10505, 10601];

describe('a season with fewer floors', () => {
  it('has no 평행중첩 or EXTREME band at all', () => {
    expect(md7Indexes.fixedModeByFloor.get(6)).toBe('parallel');
    expect(md7Indexes.fixedModeByFloor.get(11)).toBe('extreme');
    expect(shortIndexes.fixedModeByFloor.size).toBe(0);
  });

  it('reads floor 6 as Hard, not 평행중첩, because this season never reaches it', () => {
    const hardRun = { ...defaultOptions(), hardFromFloor: 1 };
    expect(modeForFloor(6, hardRun, md7Indexes)).toBe('parallel');
    expect(modeForFloor(6, hardRun, shortIndexes)).toBe('hard');
    expect(modeForFloor(5, hardRun, shortIndexes)).toBe('hard');
  });

  it('plans five floors even when the options ask for fifteen', () => {
    const plan = planRoute(
      {
        deck: DECK,
        wanted: [{ giftId: 9088, required: false }],
        options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1 },
      },
      shortSeason,
      shortIndexes,
    );
    expect(plan.floors.map((entry) => entry.floor)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.floors.every((entry) => entry.mode === 'hard')).toBe(true);
  });

  it('still plans all fifteen for the season that opens them', () => {
    const plan = planRoute(
      {
        deck: DECK,
        wanted: [{ giftId: 9088, required: false }],
        options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1 },
      },
      md7,
      md7Indexes,
    );
    expect(plan.floors.map((entry) => entry.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});
