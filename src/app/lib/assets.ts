/**
 * Where a gift icon or a pack portrait comes from, in stages.
 *
 * 1. `VITE_ASSET_BASE` — an external host, when one is configured. Absolute, so it deliberately
 *    does NOT get `BASE_URL`: it is a different origin.
 * 2. `public/art/…` — the owner's own drawings, committed to this repository. These are served by
 *    the app itself, so they MUST carry `import.meta.env.BASE_URL`; a bare `/art/…` would 404 on
 *    GitHub Pages, which serves the site from `/<repo>/`.
 * 3. Gifts only: `public/icons/gifts/…` — the game's own gift icons (M92/M94, the one game image
 *    the repository ships; NOTICE says why). Same `BASE_URL` rule. A drawing of the owner's still
 *    wins over it.
 * 4. Nothing — the tile keeps its own ground. A gift adds a wash of its keyword colour; a pack
 *    and a 범용 gift add nothing. Which one it is comes from the name beside it, not from inside.
 *
 * Stages 2 and 3 are gated on a manifest rather than tried optimistically: the 558 slots fill in one
 * drawing at a time, so most of them are absent for a long while and an optimistic `<img>` would
 * mean hundreds of 404s per page. The `onError` fallback in the components still covers a file
 * that goes missing after the manifest was built.
 */
import type { ArtManifest, GiftIconManifest } from '../../core/schema.ts';

export const ASSET_BASE: string | null = import.meta.env.VITE_ASSET_BASE?.replace(/\/$/, '') || null;

let localArt: { gifts: ReadonlySet<number>; packs: ReadonlySet<string> } = {
  gifts: new Set(),
  packs: new Set(),
};

let gameIcons: ReadonlySet<number> = new Set();

/** Hand the app the gift icon manifest it loaded. Absent or unreadable means no game icons. */
export function setGiftIconManifest(manifest: GiftIconManifest | null): void {
  gameIcons = new Set(manifest?.icons ?? []);
}

/** Hand the app the manifest it loaded. Absent or unreadable simply means no local art. */
export function setArtManifest(manifest: ArtManifest | null): void {
  localArt = {
    gifts: new Set(manifest?.gifts ?? []),
    packs: new Set(manifest?.packs ?? []),
  };
}

function localBase(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * A gift's picture and how to scale it: the owner's art is pixel art (scaled `pixelated`), the
 * game's icons are painted (scaled smoothly) and transparent, so the tile's ground shows through.
 */
export interface GiftPicture {
  url: string;
  pixelArt: boolean;
}

/** `icon` from `gifts.json`, not `id` — they differ for 31 of the gifts. */
export function giftIconUrl(icon: number): GiftPicture | null {
  if (ASSET_BASE) return { url: `${ASSET_BASE}/gifts/${icon}.png`, pixelArt: true };
  if (localArt.gifts.has(icon)) return { url: `${localBase()}art/gifts/${icon}.png`, pixelArt: true };
  if (gameIcons.has(icon)) return { url: `${localBase()}icons/gifts/${icon}.webp`, pixelArt: false };
  return null;
}

/** `sprite` from `packs.json`; 116 packs share 112 sprites. */
export function packImageUrl(sprite: string): string | null {
  if (ASSET_BASE) return `${ASSET_BASE}/packs/${encodeURIComponent(sprite)}.png`;
  if (localArt.packs.has(sprite)) return `${localBase()}art/packs/${encodeURIComponent(sprite)}.png`;
  return null;
}
