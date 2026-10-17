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
 * The emphasis an enhanced gift's text carries over from the game (M130). The game wraps what an
 * enhancement changed in `<style="upgradeHighlight">…</style>` — 「[Vulnerable] **2** 얻음」. The
 * build turns that one tag into this marker before the rest of the markup is stripped, so the
 * shipped text carries no markup and the app can still draw the changed numbers in bold
 * (`splitHighlight`). Two asterisks: no gift text the game ships contains them.
 */
export const HIGHLIGHT_MARK = '**';

const UPGRADE_HIGHLIGHT = /<style="upgradeHighlight">([\s\S]*?)<\/style>/g;

/** Build side: the game's highlight tag → `**…**`. Every other tag is left for `stripRichText`. */
export function markUpgradeHighlight(text: string): string {
  return text.replace(UPGRADE_HIGHLIGHT, `${HIGHLIGHT_MARK}$1${HIGHLIGHT_MARK}`);
}

/**
 * App side: cut a text at its `**` marks into plain and emphasized runs, in order. An unpaired
 * mark is kept as text rather than swallowing the rest of the sentence.
 */
export function splitHighlight(text: string): { text: string; strong: boolean }[] {
  const parts = text.split(HIGHLIGHT_MARK);
  if (parts.length % 2 === 0) return [{ text, strong: false }];
  return parts.map((part, i) => ({ text: part, strong: i % 2 === 1 })).filter((part) => part.text.length > 0);
}

/**
 * Pick the Korean particle by the final consonant of the word: 화상을, 연기를. In each pair the
 * first form is the one a final consonant takes. A word that
 * does not end in Hangul (a number, or an English fallback name) gets the bracketed form, which
 * is what a Korean writer does when the reading is unknown.
 */
export function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split('/') as [string, string];
  const code = word.codePointAt(word.length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return `${word}${withBatchim}(${without})`;
  return `${word}${(code - 0xac00) % 28 === 0 ? without : withBatchim}`;
}

export type JosaPair = '을/를' | '이/가' | '은/는' | '과/와';

/**
 * A placeholder in a sentence from `docs/copy.md`: `{name}`, or `{name|을/를}` to have the Korean
 * particle chosen for whatever fills it. The generator and `fillTemplate` share this one grammar.
 */
export const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)(?:\|(을\/를|이\/가|은\/는|과\/와))?\}/g;

/** A value for a placeholder: the same in both languages, or one per language (a gift name). */
export type TemplateValue = string | number | { ko: string; en: string };

/**
 * Fill one sentence. A particle is attached in Korean only; English has none to choose. A missing
 * value throws — `msg()`'s types make that unreachable from core, so reaching it is a bug.
 */
export function fillTemplate(
  template: string,
  lang: 'ko' | 'en',
  params: Readonly<Record<string, TemplateValue>>,
): string {
  return template.replace(PLACEHOLDER, (_, name: string, pair: JosaPair | undefined) => {
    const value = params[name];
    if (value === undefined) throw new Error(`fillTemplate: no value for {${name}} in 「${template}」`);
    const text = typeof value === 'object' ? value[lang] : String(value);
    return pair && lang === 'ko' ? josa(text, pair) : text;
  });
}
