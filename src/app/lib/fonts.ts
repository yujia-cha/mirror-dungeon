/**
 * Fetch the Pretendard slices a block of text needs before the browser asks for them itself.
 *
 * Pretendard ships as 92 `unicode-range` slices (`src/assets/fonts/pretendard.css`), and the
 * browser requests a slice only when it shapes a character from it. The gift grids give every
 * tile `content-visibility: auto`, so a tile far below the fold is not laid out — its name is not
 * shaped and its slice is not requested — until the scroll brings it near. Scrolling a long grid
 * therefore fetched a new slice every second or so, and each arrival re-laid out every run of text
 * in the family; on a slow connection the tile itself showed its name in the fallback face first
 * and swapped (`font-display: swap`). That was the periodic flicker of M133.
 *
 * Asking `document.fonts.load` for the grid's own text when the grid changes fetches those slices
 * at once — the same bytes scrolling to the end would have fetched, only up front — and the scroll
 * itself then requests nothing. Same origin only; nothing is precached.
 */

/** The family `pretendard.css` declares; `--font-sans` names it first. */
export const TEXT_FONT_FAMILY = 'Pretendard Variable';

/**
 * The distinct characters of `text` not in `asked`, without whitespace — what `FontFaceSet.load`
 * matches the slices' ranges against.
 */
export function newGlyphs(text: string, asked: ReadonlySet<string> = new Set()): string {
  const seen = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && !asked.has(ch)) seen.add(ch);
  return [...seen].join('');
}

/** Characters already asked for on this page: a grid re-rendering with the same names asks for nothing. */
const asked = new Set<string>();

/**
 * Load the slices of the text font that cover `text`. Fire and forget: a slice that fails to load
 * leaves the fallback face, exactly as without this call.
 */
export function preloadGlyphs(
  text: string,
  fonts: Pick<FontFaceSet, 'load'> | undefined = globalThis.document?.fonts,
  seen: Set<string> = asked,
): void {
  if (typeof fonts?.load !== 'function') return;
  const glyphs = newGlyphs(text, seen);
  if (!glyphs) return;
  for (const ch of glyphs) seen.add(ch);
  fonts.load(`1em "${TEXT_FONT_FAMILY}"`, glyphs).catch(() => undefined);
}
