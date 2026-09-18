/**
 * 조합 계승: a gift with `upgradeOf` is the upgraded form of another and never stands alone in the
 * app — it is selected with its parent and shown under it. This is the parent → children map both
 * the items tab and the gift detail sheet use.
 */
import type { GameData, Gift } from '../../core/schema.ts';

export function upgradeChildren(data: GameData): Map<number, Gift[]> {
  const map = new Map<number, Gift[]>();
  for (const gift of data.gifts) {
    if (gift.upgradeOf === null) continue;
    map.set(gift.upgradeOf, [...(map.get(gift.upgradeOf) ?? []), gift]);
  }
  return map;
}
