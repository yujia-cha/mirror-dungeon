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
 *
 * A picture drawn once is held for the life of the page (`holdImage`, M125), so the next `<img>`
 * for the same URL paints in its first frame instead of flashing the bare tile.
 */
import type {
  ArtManifest,
  GiftIconManifest,
  IconKeyword,
  Keyword,
  KeywordIconManifest,
  PackImageManifest,
} from '../../core/schema.ts';

export const ASSET_BASE: string | null = import.meta.env.VITE_ASSET_BASE?.replace(/\/$/, '') || null;

let localArt: { gifts: ReadonlySet<number>; packs: ReadonlySet<string> } = {
  gifts: new Set(),
  packs: new Set(),
};

let gameIcons: ReadonlySet<number> = new Set();

let keywordIcons: ReadonlySet<string> = new Set();
let gamePacks: ReadonlySet<string> = new Set();

/** Hand the app the pack image manifest it loaded (M100). Absent means no game pack art. */
export function setPackImageManifest(manifest: PackImageManifest | null): void {
  gamePacks = new Set(manifest?.packs ?? []);
}

/** Hand the app the keyword icon manifest it loaded (M99). Absent means the badge draws dots. */
export function setKeywordIconManifest(manifest: KeywordIconManifest | null): void {
  keywordIcons = new Set(manifest?.keywords ?? []);
}

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
export interface Picture {
  url: string;
  pixelArt: boolean;
}

/** `icon` from `gifts.json`, not `id` — they differ for 31 of the gifts. */
export function giftIconUrl(icon: number): Picture | null {
  if (ASSET_BASE) return { url: `${ASSET_BASE}/gifts/${icon}.png`, pixelArt: true };
  if (localArt.gifts.has(icon)) return { url: `${localBase()}art/gifts/${icon}.png`, pixelArt: true };
  if (gameIcons.has(icon)) return { url: `${localBase()}icons/gifts/${icon}.webp`, pixelArt: false };
  return null;
}

/**
 * The game's icon for a keyword, drawn as the gift tile's badge (M99) and the deck's identity
 * keywords (M131, which add 탄환·혈찬), or `null` — then the badge is the coloured dot it was before
 * and the deck draws the text chip. Not routed through `VITE_ASSET_BASE` or `public/art/`: the owner
 * draws gifts and packs, not keyword marks.
 */
export function keywordIconUrl(keyword: Keyword | IconKeyword): string | null {
  return keywordIcons.has(keyword) ? `${localBase()}icons/keywords/${keyword}.webp` : null;
}

/**
 * A pack card's picture and how to scale it, like `giftIconUrl`: the owner's drawing first (pixel
 * art), then the game's pack art (M100, painted, shrunk to 256px wide by `data:icons`), then
 * nothing. `sprite` from `packs.json`; packs share sprites (120 packs, 116 sprites in MD7).
 */
export function packImage(sprite: string): Picture | null {
  const key = encodeURIComponent(sprite);
  if (ASSET_BASE) return { url: `${ASSET_BASE}/packs/${key}.png`, pixelArt: true };
  if (localArt.packs.has(sprite)) return { url: `${localBase()}art/packs/${key}.png`, pixelArt: true };
  if (gamePacks.has(sprite)) return { url: `${localBase()}icons/packs/${key}.webp`, pixelArt: false };
  return null;
}

/**
 * Every picture this page has drawn, each held by one detached `Image` (M125).
 *
 * Why: tiles mount and unmount all the time — a floor change, a tab switch, a sheet, the 「다른 팩」
 * list. The browser's memory cache keeps an image only while something references it, so once the
 * last `<img>` for a URL is gone and a garbage collection runs, the next `<img>` asks again —
 * through the service worker or the HTTP cache, both asynchronous — and paints at least one frame
 * of the bare tile before the picture: the flicker. A live reference keeps the resource, and a new
 * `<img>` for it is complete at insertion, `loading="lazy"` or not, fresh or stale headers alike.
 * Measured in a real browser (`docs/review/M125.md`): moving floors 4 → 1 → 4 three times went
 * from 250+ blank first frames and 400+ refetches to none.
 *
 * Bounded by the manifests: only URLs from `giftIconUrl`, `keywordIconUrl` and `packImage` get
 * here, and each is held once — about 580 small files today (≈7 MB encoded, all of them only if
 * the player looks at every gift and pack). Nothing is fetched by holding: the call comes from the
 * `<img>`'s own `load`, when the browser already has the file, and a failed load is never held.
 */
const held = new Map<string, HTMLImageElement>();

/** Keep `url` (already loaded by an `<img>`) decoded and in the memory cache for this page. */
export function holdImage(url: string): void {
  if (held.has(url) || typeof Image === 'undefined') return;
  const copy = new Image();
  // Never painted, so it must not hold up a frame while the browser decodes it.
  copy.decoding = 'async';
  copy.src = url;
  held.set(url, copy);
}

/** For tests: how many pictures are held, and forget them all. */
export function heldImageCount(): number {
  return held.size;
}

export function releaseHeldImages(): void {
  held.clear();
}
