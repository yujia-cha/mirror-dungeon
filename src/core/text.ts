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
 * The reading of a final character that is not Hangul, by its Korean name: the digits 영·일·이·삼·사·
 * 오·육·칠·팔·구 and the Latin letters 에이·비·…·지. Only 엘·엠·엔·알 and 영·일·삼·육·칠·팔 end in
 * a consonant — 「타입 L을」, 「Mk.4를」, 「AEDD를」 — which is also how an English word ends when it
 * ends in one of those letters (Burn을, Bell이, Dead를).
 */
const FINAL_WITH_BATCHIM = /[013678LMNRlmnr]$/;
const FINAL_WITHOUT_BATCHIM = /[2459A-Za-z]$/;

/**
 * What decides the particle: the word without the bracketed note or punctuation the game hangs on
 * its end — 「덕목 - 지(智)」 reads 지, 「본국검보[本國劍譜]」 보, 「한 잔 더!」 더, 「박수 짝짝!」 짝. A
 * bracketed group goes as a whole; the rest goes one trailing mark at a time.
 */
const TRAILING_NOTE = /\s*(?:\([^()]*\)|\[[^\]]*\]|[^\p{L}\p{N}\s])\s*$/u;

/**
 * Pick the Korean particle by the final consonant of the word: 화상을, 연기를. In each pair the
 * first form is the one a final consonant takes. The game hangs notes and marks on some names
 * (M166 — 13 in MD8), so the judgement is made on the name without them; a final digit or Latin
 * letter goes by its reading. A word whose ending is none of these (a lone ideograph, an empty
 * name) gets the bracketed form, which is what a Korean writer does when the reading is unknown.
 */
export function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split('/') as [string, string];
  const batchim = hasBatchim(word);
  if (batchim === null) return `${word}${withBatchim}(${without})`;
  return `${word}${batchim ? withBatchim : without}`;
}

/** Whether the word, read aloud, ends in a consonant; null when its ending cannot be read. */
export function hasBatchim(word: string): boolean | null {
  let core = word;
  for (;;) {
    const trimmed = core.replace(TRAILING_NOTE, '');
    if (trimmed === core) break;
    core = trimmed;
  }
  const code = core.codePointAt(core.length - 1);
  if (code === undefined) return null;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (FINAL_WITH_BATCHIM.test(core)) return true;
  if (FINAL_WITHOUT_BATCHIM.test(core)) return false;
  return null;
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
