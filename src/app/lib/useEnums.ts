/**
 * The generated `enums` reachable from any leaf.
 *
 * `GiftIcon` needs a keyword's display name for its accessible label, and it is drawn from
 * fourteen places — threading `enums` through all of them (and through `GiftTile`, `PackSheet`,
 * `MetroMap` …) to reach one `aria-label` is worse than a context. Game display names still come
 * from the data and are never written into the app, which is the rule this keeps.
 *
 * Deliberately falsy-tolerant: it returns `null` outside a provider so a component test can render
 * one icon without standing up the whole shell. Callers fall back to the raw id.
 */
import { createContext, useContext } from 'react';
import type { Enums, IdentityKeywordId, Keyword } from '../../core/schema.ts';
import { keywordName } from '../format.ts';
import type { Lang } from '../i18n.ts';

export const EnumsContext = createContext<Enums | null>(null);

export function useEnums(): Enums | null {
  return useContext(EnumsContext);
}

/** A keyword's name when the enums are in reach, otherwise its id. */
export function useKeywordName(id: Keyword | IdentityKeywordId, lang: Lang): string {
  const enums = useEnums();
  return enums ? keywordName(id, enums, lang) : id;
}
