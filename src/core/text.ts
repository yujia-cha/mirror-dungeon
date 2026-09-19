/**
 * Pure text helpers shared by the data pipeline, the planner and the UI.
 *
 * They live in core because all three need the same answer: the build strips markup out of the
 * text it ships, the app strips it again as a safety net, and both must agree on what counts as
 * markup. Nothing here touches React, the DOM or the network.
 */

/**
 * Unity rich-text tags the game embeds in its own strings.
 *
 * Matched by shape rather than by a list of tag names: all-lowercase ASCII is what Unity's tags
 * look like (`noparse`, `color=`, `style=`, `size=`, `link=`, `sprite`, `b`, `i`, `s`), and a
 * name the game wrote in angle brackets is not — 「아군에 <혈귀>가 있다면」, `<Mechanical Amalgam>`,
 * `<Bloodfiend>`. A blanket `<[^>]*>` deleted those too, leaving 「아군에 가 있다면」; a fixed list
 * of names would quietly miss the next tag the game starts using, and the validator and tests
 * that guard the shipped text import this very pattern, so they cannot drift from it.
 */
export const RICH_TEXT_TAG = /<\/?[a-z][a-z0-9-]*(?:[\s=][^>]*)?>/g;

/**
 * A bracketed buff name with whitespace padding inside the brackets — 「[공격 레벨 감소 ]」. The
 * build trims the names, so a hit means the game started padding a name in a new way.
 */
export const PADDED_BRACKET = /\[[^\]]*\s\]|\[\s[^\]]*\]/;

/**
 * A counter the game fills in at run time (`{0}` — 「전투를 6회 승리할 시 …」 and the player's
 * progress under it). We have no value for it, so the build drops the line that holds one.
 */
export const RUNTIME_PLACEHOLDER = /\{\d+\}/;

/** Drop the rich-text markup, keeping every other angle-bracketed word as the text it is. */
export function stripRichText(text: string): string {
  return text.replace(RICH_TEXT_TAG, '');
}

/**
 * Pick the Korean particle by the final consonant of the word: 화상을, 연기를. In each pair the
 * first form is the one a final consonant takes. A word that
 * does not end in Hangul (a number, or an English fallback name) gets the bracketed form, which
 * is what a Korean writer does when the reading is unknown.
 */
export function josa(word: string, pair: '을/를' | '이/가' | '은/는' | '과/와'): string {
  const [withBatchim, without] = pair.split('/') as [string, string];
  const code = word.codePointAt(word.length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return `${word}${withBatchim}(${without})`;
  return `${word}${(code - 0xac00) % 28 === 0 ? without : withBatchim}`;
}
