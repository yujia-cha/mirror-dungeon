/**
 * Searching a Korean name by its 초성.
 *
 * Typing 「ㅈㅎ」 is how a Korean keyboard reaches 「진혼」 without committing to the vowels, and the
 * deck search already accepted far more than the gift search did. This is the one comparison both
 * use: a plain substring match, except when the query is nothing but lead consonants — then the
 * haystack is read as its own 초성 and matched there.
 *
 * Mixed input (「진ㅎ」) stays a substring match. Reading it as 초성 would drop the syllable the
 * player already typed in full, which widens the result set exactly when they narrowed it.
 */

/** The nineteen lead consonants, in 초성 order: index i is the lead of syllables i * 588 apart. */
const LEADS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
/** Syllables per lead: 21 vowels × 28 finals. */
const LEAD_SPAN = 588;

/** True when every character is a lead consonant — 「ㄳ」 and 「ㅏ」 are not, so they fall back. */
function isChosungOnly(needle: string): boolean {
  return [...needle].every((ch) => LEADS.includes(ch));
}

/**
 * The haystack as lead consonants. Anything that is not a Hangul syllable is left where it is, and
 * whitespace is dropped: 「ㄱㅇㅅㅊ」 is how a player asks for 「검은 상처」, spaces and all.
 */
function chosungOf(haystack: string): string {
  let out = '';
  for (const ch of haystack) {
    if (/\s/.test(ch)) continue;
    const code = ch.codePointAt(0)!;
    out +=
      code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST
        ? LEADS[Math.floor((code - SYLLABLE_FIRST) / LEAD_SPAN)]!
        : ch;
  }
  return out;
}

/**
 * Does `haystack` answer to `needle`? Both are compared as given, so a caller that lowercases for
 * its English half keeps doing that — 초성 have no case.
 */
export function matchesQuery(haystack: string, needle: string): boolean {
  if (needle === '') return true;
  if (haystack.includes(needle)) return true;
  return isChosungOnly(needle) && chosungOf(haystack).includes(needle);
}
