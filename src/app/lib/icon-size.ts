/**
 * The gift tile size setting (M98). Tiles in the grids, the selection tray, the tracker and the
 * stage are drawn at a base size — 32px in the lists, 44px on the stage — and the player's step
 * scales both. Inline icons (20px in sentences, sheets and the route map) keep their size: they sit
 * in a line of text, and growing them would only push the text apart.
 */
import { useApp, type GiftIconScale } from '../store.ts';

const FACTOR: Record<GiftIconScale, number> = { sm: 0.875, md: 1, lg: 1.375, xl: 1.75 };

/** A tile base size (32 or 44) at the given step, in whole pixels. */
export function scaledIconSize(base: number, scale: GiftIconScale): number {
  return Math.round(base * FACTOR[scale]);
}

/** A tile base size at the player's current step. */
export function useTileIconSize(base: number): number {
  const scale = useApp((state) => state.ui.giftIconScale);
  return scaledIconSize(base, scale);
}

/**
 * The column template for a grid of tiles of this size: never narrower than the 64px the names
 * were laid out for, and wide enough that a larger tile keeps a little room beside it.
 */
export function tileColumns(size: number): string {
  return `repeat(auto-fill,minmax(${Math.max(64, size + 24)}px,1fr))`;
}
