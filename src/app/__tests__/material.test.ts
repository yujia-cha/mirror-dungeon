/**
 * M152: the 잔영 are held always — never a goal, never marked. The store refuses one as a goal
 * and sheds goals and marks it finds on a load; the goal lists never offer one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { buildIndexes } from '../../core/index.ts';
import { appDefaultOptions, emptyRun, useApp } from '../store.ts';
import { lastFloorOf } from '../lib/stage.ts';
import { ingredientTree } from '../lib/entangle.ts';
import { upgradeLevelsOf } from '../lib/upgrade.ts';
import { isGoalCandidate, isMaterial } from '../lib/material.ts';
import { browsableParents } from '../lib/gift-tile.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const RESIDUE = data.gifts.find(isMaterial)!.id;
const GIFT = data.gifts.find((g) => g.obtainable && !isMaterial(g) && g.fusion === null)!.id;

const adopt = () =>
  useApp.getState().adoptSeason({
    season: data.meta.dungeon.id,
    lastFloor: lastFloorOf(data),
    giftIds: new Set(data.gifts.map((gift) => gift.id)),
    packIds: new Set(data.packs.map((pack) => pack.id)),
    recipes: ingredientTree(indexes, data.rules.fusion.maxShopSlots),
    upgradeLevels: upgradeLevelsOf(data.gifts),
    materials: new Set(data.gifts.filter(isMaterial).map((gift) => gift.id)),
  });

beforeEach(() => {
  useApp.setState({
    wanted: [],
    fusionGoal: {},
    options: appDefaultOptions(),
    run: emptyRun(),
    runSnapshot: null,
  });
});

describe('the 잔영 are never a goal (M152)', () => {
  it('sheds a 잔영 goal and a 잔영 mark on a load, without counting it as a gift the season lost', () => {
    // Arrange: a saved goal list and run that still carry a 잔영.
    useApp.setState({
      season: data.meta.dungeon.id,
      wanted: [GIFT, RESIDUE],
      run: { ...emptyRun(), giftStatus: { [RESIDUE]: 'got', [GIFT]: 'got' } },
    });
    // Act
    const dropped = adopt();
    // Assert
    expect(useApp.getState().wanted).toEqual([GIFT]);
    expect(useApp.getState().run.giftStatus).toEqual({ [GIFT]: 'got' });
    expect(dropped.gifts).toBe(0);
  });

  it('refuses a 잔영 as a goal once the season is known', () => {
    adopt();
    useApp.getState().toggleWanted(RESIDUE);
    useApp.getState().toggleWanted(GIFT);
    expect(useApp.getState().wanted).toEqual([GIFT]);
  });

  it('offers no 잔영 in the goal lists', () => {
    expect(isGoalCandidate(indexes.giftById.get(RESIDUE)!, [])).toBe(false);
    const all = { name: () => true, attrs: () => true };
    const offered = browsableParents(data, indexes, [], new Map(), all).map((g) => g.id);
    expect(offered).toContain(GIFT);
    expect(offered.filter((id) => isMaterial(indexes.giftById.get(id)!))).toEqual([]);
  });
});
