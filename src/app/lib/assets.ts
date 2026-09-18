/**
 * Where a gift icon or a pack portrait comes from, in three stages.
 *
 * 1. `VITE_ASSET_BASE` — an external host, when one is configured. Absolute, so it deliberately
 *    does NOT get `BASE_URL`: it is a different origin.
 * 2. `public/art/…` — the owner's own drawings, committed to this repository. These are served by
 *    the app itself, so they MUST carry `import.meta.env.BASE_URL`; a bare `/art/…` would 404 on
 *    GitHub Pages, which serves the site from `/<repo>/`.
 * 3. Nothing — the caller draws the name fallback (`art-fallback.ts`).
 *
 * **Game artwork is still never committed** (it belongs to Project Moon). What lives under
 * `public/art/` is original work by this repository's owner, which is why it can ship here at all.
 *
 * Stage 2 is gated on a manifest rather than tried optimistically: the 558 slots fill in one
 * drawing at a time, so most of them are absent for a long while and an optimistic `<img>` would
 * mean hundreds of 404s per page. The `onError` fallback in the components still covers a file
 * that goes missing after the manifest was built.
 */
import type { ArtManifest } from '../../core/schema.ts';

export const ASSET_BASE: string | null = import.meta.env.VITE_ASSET_BASE?.replace(/\/$/, '') || null;

let localArt: { gifts: ReadonlySet<number>; packs: ReadonlySet<string> } = { gifts: new Set(), packs: new Set() };

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

/** `icon` from `gifts.json`, not `id` — they differ for 31 of the 446 gifts. */
export function giftIconUrl(icon: number): string | null {
  if (ASSET_BASE) return `${ASSET_BASE}/gifts/${icon}.png`;
  if (localArt.gifts.has(icon)) return `${localBase()}art/gifts/${icon}.png`;
  return null;
}

/** `sprite` from `packs.json`; 116 packs share 112 sprites. */
export function packImageUrl(sprite: string): string | null {
  if (ASSET_BASE) return `${ASSET_BASE}/packs/${encodeURIComponent(sprite)}.png`;
  if (localArt.packs.has(sprite)) return `${localBase()}art/packs/${encodeURIComponent(sprite)}.png`;
  return null;
}
