/**
 * The T4 tracker: gifts worth noting in any run because any pack can drop them — tier 4 and up,
 * no deck condition, in the general drop pool. Grouped the way players talk about them: the seven
 * keyword capstones, the 조각 series and the 기억 series (the two pools of the one mixed fusion),
 * the attack-type set, and the keyword-less rest.
 */
import type { GameData, Gift, Keyword } from '../../core/schema.ts';
import type { GameIndexes } from '../../core/types.ts';
import type { GiftStatus } from './plan-input.ts';

export type TrackerGroupId = 'keyword' | 'shard' | 'memory' | 'attack' | 'plain';

export interface TrackerGroup {
  id: TrackerGroupId;
  gifts: Gift[];
}

const GROUP_ORDER: TrackerGroupId[] = ['keyword', 'shard', 'memory', 'attack', 'plain'];

/** Pack-independent, condition-free, tier 4 and up: the gifts any run can pick up. */
export function isTrackerGift(gift: Gift, indexes: GameIndexes): boolean {
  const tier = gift.tier === null ? 0 : gift.tier === 'EX' ? 6 : gift.tier;
  return tier >= 4 && gift.obtainable && gift.acquisition.kind === 'general' && gift.conditions.length === 0 && indexes.freelyAvailableGifts.has(gift.id);
}

export function trackerGifts(data: GameData, indexes: GameIndexes): TrackerGroup[] {
  const gifts = data.gifts.filter((gift) => isTrackerGift(gift, indexes));
  // The mixed fusion names the two series: its a-pool are the 조각, its b-pool the 기억.
  const mixed = data.gifts.find((gift) => gift.fusion?.mixed)?.fusion?.mixed;
  const shards = new Set(mixed?.aPool ?? []);
  const memories = new Set(mixed?.bPool ?? []);
  const statusKeywords = new Set(data.enums.keywords.filter((k) => k.status).map((k) => k.id));
  const keywordRank = new Map<Keyword, number>(data.enums.keywords.map((k, i) => [k.id, i]));
  const groupOf = (gift: Gift): TrackerGroupId => {
    if (shards.has(gift.id)) return 'shard';
    if (memories.has(gift.id)) return 'memory';
    if (statusKeywords.has(gift.keyword)) return 'keyword';
    if (gift.keyword !== 'None') return 'attack';
    return 'plain';
  };
  const groups = new Map<TrackerGroupId, Gift[]>();
  for (const gift of gifts) groups.set(groupOf(gift), [...(groups.get(groupOf(gift)) ?? []), gift]);
  return GROUP_ORDER.filter((id) => groups.has(id)).map((id) => ({
    id,
    gifts: groups.get(id)!.sort((a, b) => (keywordRank.get(a.keyword) ?? 99) - (keywordRank.get(b.keyword) ?? 99) || a.id - b.id),
  }));
}

export interface FusionConsumption {
  aCount: number;
  bCount: number;
  /** Pool members currently marked collected, which the fusion would have consumed. */
  aGot: number[];
  bGot: number[];
}

/** For a gift made by the mixed fusion: how many of each pool it eats, and which of those the player holds. */
export function fusionConsumption(gift: Gift, giftStatus: Record<number, GiftStatus>): FusionConsumption | null {
  const mixed = gift.fusion?.mixed;
  if (!mixed) return null;
  const got = (ids: number[]): number[] => ids.filter((id) => giftStatus[id] === 'got').sort((a, b) => a - b);
  return { aCount: mixed.aCount, bCount: mixed.bCount, aGot: got(mixed.aPool), bGot: got(mixed.bPool) };
}
