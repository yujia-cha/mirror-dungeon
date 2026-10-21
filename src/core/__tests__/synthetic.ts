import type { GameData, Gift, ThemePack } from '../schema.ts';

/**
 * Gifts and packs the season does not have, shaped from ones it has (M166).
 *
 * Some paths of the planner have no case in the live data — a fusion intermediate two results eat,
 * more window classes than a 32-bit mask holds — so the tests build one onto the real season.
 * Everything else about the gift or pack is the template's, so the schema and the indexes treat
 * it as any other.
 */

const name = (id: number, ko: string): Gift['name'] => ({ ko, en: `${ko} ${id}` });

/** A fusion-only gift with the given recipes. */
export function fusionGift(data: GameData, id: number, ko: string, recipes: number[][]): Gift {
  const template = data.gifts.find((gift) => gift.acquisition.kind === 'fusionOnly' && gift.fusion !== null)!;
  return {
    ...template,
    id,
    icon: id,
    name: name(id, ko),
    conditions: [],
    effects: [],
    upgradeOf: null,
    acquisition: { kind: 'fusionOnly', exclusiveTo: [], packs: [], clearRewardOf: null, startKeyword: null },
    fusion: { recipes: recipes.map((ingredients) => ({ ingredients })) },
  };
}

/** A pack-limited gift exclusive to `packIds`. */
export function packGift(data: GameData, id: number, ko: string, packIds: number[]): Gift {
  const template = data.gifts.find((gift) => gift.acquisition.kind === 'packLimited')!;
  return {
    ...template,
    id,
    icon: id,
    name: name(id, ko),
    conditions: [],
    effects: [],
    upgradeOf: null,
    fusion: null,
    hardOnly: false,
    acquisition: {
      kind: 'packLimited',
      exclusiveTo: packIds,
      packs: packIds,
      clearRewardOf: null,
      startKeyword: null,
    },
  };
}

/** A pack open on exactly `floors` (in each floor's own mode; Normal never), dropping `giftIds` only. */
export function themePack(
  data: GameData,
  id: number,
  ko: string,
  floors: number[],
  giftIds: number[],
): ThemePack {
  const template = data.packs.find((pack) => pack.selectable)!;
  const within = (mode: 'hard' | 'parallel' | 'extreme'): number[] =>
    floors.filter((floor) => data.rules.floors[mode].includes(floor));
  return {
    ...template,
    id,
    name: name(id, ko),
    devName: ko,
    selectable: true,
    availability: {
      normal: [],
      hard: within('hard'),
      parallel: within('parallel'),
      extreme: within('extreme'),
    },
    giftPool: giftIds,
    exclusiveGifts: giftIds,
  };
}

/** The season with these gifts and packs added. */
export function withSynthetic(data: GameData, gifts: Gift[], packs: ThemePack[] = []): GameData {
  return { ...data, gifts: [...data.gifts, ...gifts], packs: [...data.packs, ...packs] };
}
