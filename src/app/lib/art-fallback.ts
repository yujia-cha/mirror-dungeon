/**
 * What a tile shows when it has no artwork.
 *
 * The repository ships no game art, and the owner's own drawings arrive one at a time, so most
 * tiles are art-less for a long while. The grey `Gem`/`Image` glyph that used to stand in was
 * effectively invisible — `fg-3` at `opacity-40` over `surface-3` measures 1.65:1 in light and
 * 1.84:1 in dark, and a gift tile in its normal (not-yet-collected) state composited down to
 * 1.29:1. WCAG 1.4.11 asks 3:1 for a graphic that carries meaning, and `fg-3` cannot reach 4.5:1
 * against that ground at any opacity. So the placeholder is replaced rather than brightened: the
 * name's first character, which is the one thing that actually tells two tiles apart.
 */

/**
 * The first character to draw, by grapheme rather than code unit so an emoji or a surrogate pair
 * is not cut in half. Korean names give one syllable block, which is what these names mostly are.
 */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ?? '?';
}

/** Roughly half the tile: big enough to read at 20px, still inside the box at 44px. */
export function initialFontSize(size: number): number {
  return Math.max(9, Math.round(size * 0.5));
}

/**
 * How an inactive tile dims — and why it depends on whether there is artwork.
 *
 * `grayscale opacity-55` is the project's 「아직 안 얻음」 language, and on real artwork it reads
 * exactly right. On the name fallback it does not: the letter drops to 2.69:1 (light) / 3.04:1
 * (dark), so the one thing distinguishing two art-less tiles becomes unreadable. Greyscale alone
 * still says inactive — it removes the keyword wash — and leaves the letter at 8.3:1 / 5.2:1.
 */
export function dimClass(inactive: boolean, hasArt: boolean): string {
  if (!inactive) return '';
  return hasArt ? 'grayscale opacity-55' : 'grayscale';
}
