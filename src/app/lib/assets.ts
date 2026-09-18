/**
 * Image locations. The repository ships no game artwork (it belongs to Project Moon), so every
 * picture is a placeholder unless `VITE_ASSET_BASE` points at a host that serves
 * `gifts/{icon}.png` and `packs/{sprite}.png`. A failed load falls back to the placeholder.
 */
export const ASSET_BASE: string | null = import.meta.env.VITE_ASSET_BASE?.replace(/\/$/, '') || null;

export function giftIconUrl(icon: number): string | null {
  return ASSET_BASE ? `${ASSET_BASE}/gifts/${icon}.png` : null;
}

export function packImageUrl(sprite: string): string | null {
  return ASSET_BASE ? `${ASSET_BASE}/packs/${encodeURIComponent(sprite)}.png` : null;
}
