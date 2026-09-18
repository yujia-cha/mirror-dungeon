/**
 * The game writes a buff into its own text as a bracketed id — 「[Combustion] 횟수를 부여」 — and
 * paints the localized name over it at runtime. Our vendored copy of that text keeps the ids, so a
 * gift's description reads half in English however the reader set the language.
 *
 * `BattleKeywords.json` is the game's own id → name table, per language (`readBattleKeywordNames`).
 * Everything it names is rewritten; a buff it does not name (identity-specific ones like
 * `BloodDinner`) keeps its bracketed id rather than being guessed at.
 */

/**
 * `[Combustion]`, `[AttackUp]`, `[Switch_Vibration]` — an id, never a sentence. It has to start
 * with a letter: 「(최대 [3])」 is a number the text means literally, not a buff we failed to name.
 */
const TOKEN = /\[([A-Za-z][A-Za-z0-9_]*)\]/g;

/**
 * Rewrite every bracketed buff id the table names; leave the rest exactly as it was, collecting
 * the ids that were left behind in `unnamed` when one is given.
 */
export function localizeBuffTokens(text: string, names: Map<string, string>, unnamed?: Set<string>): string {
  return text.replace(TOKEN, (whole, id: string) => {
    const name = names.get(id);
    if (name === undefined || name === '') {
      unnamed?.add(id);
      return whole;
    }
    return `[${name}]`;
  });
}
