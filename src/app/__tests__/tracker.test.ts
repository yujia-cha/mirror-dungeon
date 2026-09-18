import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { buildIndexes } from '../../core/index.ts';
import { fusionConsumption, isTrackerGift, trackerGifts } from '../lib/tracker.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);

describe('T4 tracker', () => {
  it('picks the pack-independent, condition-free tier-4+ gifts and groups them by series', () => {
    const groups = trackerGifts(data, indexes);
    expect(groups.map((g) => [g.id, g.gifts.length])).toEqual([
      ['keyword', 7],
      ['shard', 7],
      ['memory', 3],
      ['attack', 3],
      ['plain', 5],
    ]);
    const ids = groups.flatMap((g) => g.gifts.map((gift) => gift.id));
    expect(ids).toHaveLength(25);
    for (const id of [9045, 9050, 9055, 9060, 9065, 9070, 9075, 9105, 9142, 9200, 9204, 9081, 9082, 9083, 9085]) expect(ids).toContain(id);
    // Keyword capstone fusions are conditional, pack-limited gifts are pack-bound: neither belongs here.
    expect(ids).not.toContain(9088);
    expect(ids).not.toContain(9283);
    expect(groups.find((g) => g.id === 'keyword')!.gifts.map((g) => g.keyword)).toEqual(['Combustion', 'Laceration', 'Vibration', 'Burst', 'Sinking', 'Breath', 'Charge']);
    expect(groups.find((g) => g.id === 'plain')!.gifts.map((g) => g.id)).toEqual([9081, 9082, 9083, 9084, 9085]);
  });

  it('judges single gifts by the same rule', () => {
    expect(isTrackerGift(indexes.giftById.get(9083)!, indexes)).toBe(true);
    expect(isTrackerGift(indexes.giftById.get(9088)!, indexes)).toBe(false);
    expect(isTrackerGift(indexes.giftById.get(9754)!, indexes)).toBe(false);
  });

  it('reports what the mixed fusion consumed among the gifts the player holds', () => {
    const moon = indexes.giftById.get(9083)!;
    expect(fusionConsumption(moon, {})).toEqual({ aCount: 2, bCount: 3, aGot: [], bGot: [] });
    expect(fusionConsumption(moon, { 9105: 'got', 9110: 'failed', 9142: 'got', 9152: 'got', 9045: 'got' })).toEqual({ aCount: 2, bCount: 3, aGot: [9105], bGot: [9142, 9152] });
    expect(fusionConsumption(indexes.giftById.get(9045)!, { 9105: 'got' })).toBeNull();
  });
});
