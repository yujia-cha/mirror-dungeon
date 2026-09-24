/**
 * Why the planner could not fetch a gift, in the reader's language.
 *
 * Core writes the sentence, but for a fusion whose ingredients are missing it can only name the
 * ingredients by id — the planner never carries display names. So that one reason is rebuilt here
 * from the ids, and both readers of an `Unresolved` use this: the route panel and the plain-text
 * copy, which used to print 「재료 9408, 9409을(를) 구할 수 없어…」 beside a panel showing names.
 */
import type { Unresolved } from '../../core/types.ts';
import { withJosa } from '../format.ts';
import { pick, t, type Lang } from '../i18n.ts';

export function unresolvedDetailText(
  entry: Unresolved,
  giftName: (id: number) => string,
  lang: Lang,
): string {
  if (entry.reason !== 'fusion-ingredient-unresolved' || !entry.missing || entry.missing.length === 0) {
    return pick(entry.detail, lang);
  }
  const names = entry.missing.map(giftName).join(', ');
  const missing = t('unresolvedMissing', lang, { names: withJosa(names, '을/를', lang) });
  return entry.droppedIngredients && entry.droppedIngredients.length > 0
    ? `${missing} ${t('unresolvedDropped', lang, { names: entry.droppedIngredients.map(giftName).join(', ') })}`
    : missing;
}
