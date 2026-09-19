/**
 * Display helpers that turn game ids into localized text. Kept out of ui.tsx so that file exports
 * components only, which is what React Fast Refresh needs.
 */
import type { Enums, Identity, IdentityKeywordId, Keyword, Localized } from '../core/schema.ts';
import { STATUS_KEYWORDS } from '../core/schema.ts';
import { josa, stripRichText } from '../core/text.ts';
import { pick, t, type Lang } from './i18n.ts';

/**
 * Attach the Korean particle a name needs, and leave English alone. The i18n strings hold the
 * sentence without the particle, because only the call site knows the word that precedes it.
 */
export function withJosa(word: string, pair: '을/를' | '이/가' | '은/는' | '과/와', lang: Lang): string {
  return lang === 'ko' ? josa(word, pair) : word;
}

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
 *
 * The strip goes through `stripRichText`, which knows the Unity tag names, rather than removing
 * everything in angle brackets: the game also writes creature names that way — 「아군에 <혈귀>가
 * 있다면」 — and a blanket strip left 「아군에 가 있다면」 on the screen.
 */
export function renderEffect(text: Localized, enums: Enums, lang: Lang): string {
  let out = pick(text, lang);
  for (const keyword of enums.keywords) {
    out = out.split(`[${keyword.id}]`).join(pick(keyword.name, lang) || keyword.id);
  }
  return stripRichText(out);
}

const STATUS_KEYWORD_SET = new Set<string>(STATUS_KEYWORDS);

/**
 * How one identity's keyword reads on its chip: 「충전」 for the base keyword, 「충전(특수)」 when
 * its skills also use the 특수 variant (생체 재료), 「특수 출혈」 when they use only the variant (못).
 * The count of skills is deliberately not shown — the deck-level chips carry the numbers.
 *
 * 탄환 is the exception, and always reads plainly. It is spent rather than inflicted (hence
 * 「소모하는」, not 「부여하는」), and no gift, pack or starting pool carries it, so no condition ever
 * asks for 「또는 특수 탄환」. Marking 호표탄 or 포자탄 as 특수 therefore split the chip on a
 * distinction that changes nothing a player can plan around — and split it unevenly, because the
 * variant flag is unknown for the ammo buffs the game has not localized (`BulletLament`,
 * `AccelBullet`), which fall back to the base keyword.
 */
export function identityKeywordLabel(
  keyword: IdentityKeywordId,
  info: Identity['keywords'][IdentityKeywordId],
  enums: Enums,
  lang: Lang,
): { label: string; title: string } {
  const name = keywordName(keyword, enums, lang);
  if (!STATUS_KEYWORD_SET.has(keyword)) {
    return { label: name, title: t('deckKeywordUses', lang, { keyword: name }) };
  }
  if (!info || info.specialSkills === 0) {
    return { label: name, title: t('deckKeywordSkills', lang, { keyword: name }) };
  }
  if (info.skills === 0) {
    return {
      label: t('deckKeywordSpecialOnly', lang, { keyword: name }),
      title: t('deckKeywordSpecialOnlyHint', lang, { keyword: name }),
    };
  }
  return {
    label: t('deckKeywordSpecial', lang, { keyword: name }),
    title: t('deckKeywordSpecialHint', lang, { keyword: name }),
  };
}
