import { localizeBuffTokens } from '../battle-keywords.ts';
import { markUpgradeHighlight, stripRichText } from '../../../src/core/text.ts';
import { buildSkillGiftIndex, formatSkillGiftIndex } from '../skill-gifts.ts';
import { giftGrantedBuffs, parseEffects, type EffectContext } from '../parse-effects.ts';
import { skillGiftIndexSchema, type Gift, type Localized } from '../../../src/core/schema.ts';
import type { Factions } from './factions.ts';
import type { GiftSet } from './gifts.ts';
import type { IdentitySet } from './identities.ts';
import type { Sources } from './load.ts';

/**
 * What each effect asks of the deck (M129), written onto every gift, and the `skill-gifts.json`
 * text: which gift effects each identity skill sets off — core's judgement, laid out by identity.
 * Core's rules are an input of this file as much as the data is, so its bytes join `dataVersion`
 * with the other outputs — a rule change that moves an entry announces a new version even when no
 * source file changed.
 *
 * Runs before `localizeGiftText`: the requirements are read from the raw Korean text, before the
 * buff ids are written out as names (an `identityBuff` stores ids).
 */
export function attachEffects(
  src: Sources,
  giftSet: GiftSet,
  identitySet: IdentitySet,
  factions: Factions,
): string {
  const { gifts } = giftSet;
  const { identities } = identitySet;
  const effectContext: EffectContext = {
    factionIdByName: factions.idByName,
    grantedBuffs: giftGrantedBuffs(gifts.map((g) => g.desc.ko)),
    identities: identities.map((i) => ({ id: i.id, title: i.title.ko, sinner: i.sinner.ko })),
  };
  for (const gift of gifts) {
    const parsed = parseEffects(gift.desc.ko, effectContext);
    gift.effects = src.curatedEffects.byId.get(gift.id) ?? parsed.effects;
  }
  const skillGifts = skillGiftIndexSchema.parse(buildSkillGiftIndex(identities, gifts));
  return formatSkillGiftIndex(skillGifts);
}

/**
 * `{0}` is a live counter the game substitutes at runtime (「전투를 6회 승리할 시 …」 then the
 * player's progress). We have no value for it, so the placeholder line is dropped rather than
 * shipped as a literal `{0}`. Any `{n}` counts — only `{0}` occurs today.
 */
function dropRuntimePlaceholders(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\{\d+\}$/.test(line.trim()))
    .join('\n');
}

/**
 * Buff ids in the text. The game writes a buff into its own text as a bracketed id —
 * 「[Combustion] 횟수를 부여」 — and paints the localized name over it at runtime. Our copy keeps
 * the ids, so a gift read half in English whatever language the reader chose. `BattleKeywords.json`
 * is the game's own table for them, so every id it names is rewritten here, in both languages.
 *
 * A buff it does not name (identity-specific ones like `BloodDinner`) keeps its bracketed id: a
 * guessed name would be worse than a visible id. The ids left are returned so the count is known.
 * The last pass over the gift text: what it leaves is what `gifts.json` carries.
 */
export function localizeGiftText(src: Sources, gifts: Gift[]): Set<string> {
  const { battleKeywordKo, battleKeywordEn } = src;
  const unnamedBuffIds = new Set<string>();

  for (const gift of gifts) {
    const text = (value: Localized): Localized => ({
      ko: dropRuntimePlaceholders(
        stripRichText(localizeBuffTokens(value.ko, battleKeywordKo, unnamedBuffIds)),
      ),
      en: dropRuntimePlaceholders(
        stripRichText(localizeBuffTokens(value.en, battleKeywordEn, unnamedBuffIds)),
      ),
    });
    gift.desc = text(gift.desc);
    for (const condition of gift.conditions) if (condition.text) condition.text = text(condition.text);
    // An enhancement step keeps the game's emphasis on what it changed, as `**…**` (M130).
    for (const upgrade of gift.upgrades ?? []) {
      upgrade.name = { ko: stripRichText(upgrade.name.ko), en: stripRichText(upgrade.name.en) };
      upgrade.desc = text({
        ko: markUpgradeHighlight(upgrade.desc.ko),
        en: markUpgradeHighlight(upgrade.desc.en),
      });
    }
  }
  return unnamedBuffIds;
}
