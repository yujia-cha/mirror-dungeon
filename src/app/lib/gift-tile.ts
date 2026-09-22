/**
 * What a tile in the gift grid is, and the one question both the grid and the tab ask of it.
 *
 * It lives beside the grid rather than inside it because `GiftGrid.tsx` exports a component, and a
 * file that exports anything else loses fast refresh (the rule M48 turned back on).
 */
import type { Gift } from '../../core/schema.ts';
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
export function isMarked(tile: GiftTileData, wanted: readonly number[], blocked: ReadonlyMap<number, Block>): boolean {
  const { entry, parent } = tile;
  return wanted.includes(entry.gift.id) || (parent ? wanted.includes(parent.id) : false) || blocked.has(entry.gift.id);
}
