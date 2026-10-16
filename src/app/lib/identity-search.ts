/**
 * The deck tab's identity search (M126): one matcher for the global search at the top of the tab
 * and for the per-sinner picker, so the two never disagree about what a word finds.
 *
 * A query is split on whitespace into terms. Each term is compared against every attribute of an
 * identity on its own — its name, its sinner, its 소속, its keywords (as their chips read, so
 * 「특수 충전」 is found by 「특수」 and by 「충전」), its attack types and its sins — in both
 * languages, through `matchesQuery`, so a term of lead consonants reads as 초성. `or` keeps the
 * search as it always was (any term); `and` asks every term to land somewhere — 「화상 파우스트」 is
 * Faust's identities that inflict 화상.
 *
 * Attributes are matched one by one rather than as one joined string: a term never contains a
 * space, but a 초성 term drops spaces and would otherwise read across two attributes.
 */
import { ATTACK_TYPES, SINS, type Enums, type Identity, type IdentityKeywordId } from '../../core/schema.ts';
import { factionName, identityKeywordLabel, keywordName } from '../format.ts';
import { t, type Lang } from '../i18n.ts';
import { matchesQuery } from './hangul.ts';
import { SIN_LABEL } from './labels.ts';

export type SearchMode = 'or' | 'and';

const LANGS: readonly Lang[] = ['ko', 'en'];

/** The query as lower-cased terms; empty when it is blank. */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Attack types in the game's order (참격 · 관통 · 타격), as `enums.keywords` names them. */
export function attackTypeLabels(identity: Identity, enums: Enums, lang: Lang): string[] {
  return ATTACK_TYPES.filter((type) => identity.attackTypes.includes(type)).map((type) =>
    keywordName(type, enums, lang),
  );
}

/** Sins in the game's order (분노 · 색욕 · 나태 · 탐식 · 우울 · 오만 · 질투). */
export function sinLabels(identity: Identity, lang: Lang): string[] {
  return SINS.filter((sin) => identity.sins.includes(sin)).map((sin) => t(SIN_LABEL[sin], lang));
}

/** Everything a term may match, lower-cased, both languages. */
export function searchableAttributes(identity: Identity, enums: Enums): string[] {
  const out: string[] = [];
  for (const lang of LANGS) {
    out.push(identity.title[lang], identity.sinner[lang]);
    for (const faction of identity.factions) out.push(factionName(faction, enums, lang));
    for (const [keyword, info] of Object.entries(identity.keywords)) {
      out.push(identityKeywordLabel(keyword as IdentityKeywordId, info, enums, lang).label);
    }
    out.push(...attackTypeLabels(identity, enums, lang), ...sinLabels(identity, lang));
  }
  return out.filter(Boolean).map((text) => text.toLowerCase());
}

export function matchesIdentity(
  identity: Identity,
  terms: string[],
  mode: SearchMode,
  enums: Enums,
): boolean {
  if (terms.length === 0) return true;
  const attributes = searchableAttributes(identity, enums);
  const hit = (term: string): boolean => attributes.some((text) => matchesQuery(text, term));
  return mode === 'and' ? terms.every(hit) : terms.some(hit);
}

/**
 * The identities a query finds, in the data's order (callers sort). `sinnerId` fixes the search to
 * one sinner — the picker in that sinner's slot.
 */
export function searchIdentities(
  identities: readonly Identity[],
  options: { query: string; mode: SearchMode; enums: Enums; sinnerId?: number },
): Identity[] {
  const terms = searchTerms(options.query);
  return identities.filter(
    (identity) =>
      (options.sinnerId === undefined || identity.sinnerId === options.sinnerId) &&
      matchesIdentity(identity, terms, options.mode, options.enums),
  );
}
