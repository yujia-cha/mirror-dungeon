/**
 * What a tile in the gift grid is, and the one question both the grid and the tab ask of it.
 *
 * It lives beside the grid rather than inside it because `GiftGrid.tsx` exports a component, and a
 * file that exports anything else loses fast refresh (the rule M48 turned back on).
 *
 * The items tab and the 「모두 보기」 browser build their tiles from the same two steps below: which
 * gifts are on offer (`browsableParents`), and how an offer becomes tiles (`tilesFor`).
 */
import type { GameData, Gift } from '../../core/schema.ts';
import type { ConditionReport, DeckStats, GameIndexes } from '../../core/types.ts';
import { evaluateConditions } from '../../core/index.ts';
import type { GiftMatcher } from './gift-filters.ts';
import type { GiftEntry } from './gift-priority.ts';
import type { Block } from './entangle.ts';

export interface GiftTileData {
  entry: GiftEntry;
  /** The upgrade parent this tile hangs under, when it is a child. */
  parent?: Gift;
}

/**
 * Whether a tile has anything left to decide: it is a goal already, or a goal already carries it —
 * an upgrade child under a chosen parent, or a gift some goal's recipe consumes. This is what the
 * ✓ and the lock draw, and `GiftsStep` asks the same question of a whole section to know when that
 * section is done.
 */
export function isMarked(
  tile: GiftTileData,
  wanted: readonly number[],
  blocked: ReadonlyMap<number, Block>,
): boolean {
  const { entry, parent } = tile;
  return (
    wanted.includes(entry.gift.id) ||
    (parent ? wanted.includes(parent.id) : false) ||
    blocked.has(entry.gift.id)
  );
}

/** Every gift's condition reports against this deck, keyed by gift id (gifts without a condition are absent). */
export function conditionReportsByGift(
  data: GameData,
  stats: DeckStats,
  indexes: GameIndexes,
): Map<number, ConditionReport[]> {
  const reports = evaluateConditions(
    data.gifts.filter((gift) => gift.conditions.length > 0).map((gift) => gift.id),
    stats,
    indexes,
  );
  const map = new Map<number, ConditionReport[]>();
  for (const report of reports) map.set(report.giftId, [...(map.get(report.giftId) ?? []), report]);
  return map;
}

/**
 * The gifts on offer: the obtainable ones and anything already chosen, with 조합 계승 children
 * folded under their parent. A parent stands on its own attributes (keyword, condition, tier …);
 * only the name search reaches down — typing a child's name finds the parent it hangs under.
 * Keeping a parent because a child had the right keyword put gifts on screen that the filter said
 * to hide.
 */
export function browsableParents(
  data: GameData,
  indexes: GameIndexes,
  wanted: readonly number[],
  childrenOf: ReadonlyMap<number, Gift[]>,
  matches: GiftMatcher,
): Gift[] {
  const candidates = data.gifts.filter((gift) => gift.obtainable || wanted.includes(gift.id));
  return candidates.filter((gift) => {
    const isChild = gift.upgradeOf !== null && indexes.giftById.has(gift.upgradeOf);
    if (isChild) return false;
    if (!matches.attrs(gift)) return false;
    const kids = childrenOf.get(gift.id) ?? [];
    return matches.name(gift) || kids.some(matches.name);
  });
}

/**
 * Each entry as a tile, followed by its obtainable (or chosen) upgrade children under it — the
 * children that pass `keepChild` (the attribute filters), so a 「조건 없음」 list holds no gated child.
 */
export function tilesFor(
  entries: readonly GiftEntry[],
  childrenOf: ReadonlyMap<number, Gift[]>,
  wanted: readonly number[],
  conditionByGift: ReadonlyMap<number, ConditionReport[]>,
  keepChild: (gift: Gift) => boolean = () => true,
): GiftTileData[] {
  return entries.flatMap((entry) => {
    const kids = (childrenOf.get(entry.gift.id) ?? []).filter(
      (g) => (g.obtainable || wanted.includes(g.id)) && keepChild(g),
    );
    return [
      { entry },
      ...kids.map((g) => ({
        entry: { ...entry, gift: g, reports: conditionByGift.get(g.id) ?? [] },
        parent: entry.gift,
      })),
    ];
  });
}
