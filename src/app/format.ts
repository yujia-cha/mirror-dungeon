/**
 * Display helpers that turn game ids into localized text. Kept out of ui.tsx so that file exports
 * components only, which is what React Fast Refresh needs.
 */
import type { Enums, Identity, IdentityKeywordId, Keyword, Localized } from '../core/schema.ts';
import { STATUS_KEYWORDS } from '../core/schema.ts';
import { pick, t, type Lang } from './i18n.ts';

/** Faction ids localized through enums, so the planner never carries display names. */
export function factionName(id: string, enums: Enums, lang: Lang): string {
  const entry = enums.factions.find((f) => f.id === id);
  return entry ? pick(entry.name, lang) : id;
}

export function keywordName(id: Keyword | IdentityKeywordId, enums: Enums, lang: Lang): string {
  const entry =
    enums.keywords.find((k) => k.id === id) ?? enums.identityOnlyKeywords.find((k) => k.id === id);
  return entry ? pick(entry.name, lang) : id;
}

/**
 * Replace the `[Token]` status references the game embeds in effect text with their Korean or
 * English names, and strip the rich-text markup that survived the data build.
 */
export function renderEffect(text: Localized, enums: Enums, lang: Lang): string {
  let out = pick(text, lang);
  for (const keyword of enums.keywords) {
    out = out.split(`[${keyword.id}]`).join(pick(keyword.name, lang) || keyword.id);
  }
  return out.replace(/<[^>]*>/g, '');
}

const STATUS_KEYWORD_SET = new Set<string>(STATUS_KEYWORDS);

/**
 * How one identity's keyword reads on its chip: 「충전」 for the base keyword, 「충전(특수)」 when
 * its skills also use the 특수 variant (생체 재료), 「특수 출혈」 when they use only the variant (못).
 * The count of skills is deliberately not shown — the deck-level chips carry the numbers.
 *
 * 탄환 is spent rather than inflicted, so only its tooltip differs: 「소모하는」, not 「부여하는」.
 */
export function identityKeywordLabel(
  keyword: IdentityKeywordId,
  info: Identity['keywords'][IdentityKeywordId],
  enums: Enums,
  lang: Lang,
): { label: string; title: string } {
  const name = keywordName(keyword, enums, lang);
  const spent = !STATUS_KEYWORD_SET.has(keyword);
  if (!info || info.specialSkills === 0) {
    return { label: name, title: t(spent ? 'deckKeywordUses' : 'deckKeywordSkills', lang, { keyword: name }) };
  }
  if (info.skills === 0) {
    return {
      label: t('deckKeywordSpecialOnly', lang, { keyword: name }),
      title: t(spent ? 'deckKeywordUsesSpecialOnly' : 'deckKeywordSpecialOnlyHint', lang, { keyword: name }),
    };
  }
  return {
    label: t('deckKeywordSpecial', lang, { keyword: name }),
    title: t(spent ? 'deckKeywordUsesSpecial' : 'deckKeywordSpecialHint', lang, { keyword: name }),
  };
}
