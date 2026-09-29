/**
 * Why the planner could not fetch a gift, in the reader's language.
 *
 * Core writes the sentence, but for a fusion whose ingredients are missing it can only name the
 * ingredients by id — the planner never carries display names. So that one reason is rebuilt here
 * from the ids, and both readers of an `Unresolved` use this: the route panel and the plain-text
 * copy, which used to print 「재료 9408, 9409을(를) 구할 수 없어…」 beside a panel showing names.
 */
import type { PlanWarning, Unresolved } from '../../core/types.ts';
import { withJosa } from '../format.ts';
import { pick, t, type Lang } from '../i18n.ts';

/**
 * A warning's sentence with its targets named after it: 「… 제외했습니다 — 깨진 안경」. Core fills
 * `giftIds`/`packIds` on the warnings that have targets (`observation-trimmed`, `fusion-slots`,
 * `pack-option-dropped`, `shared-ingredient`) but writes the sentence without them, so a reader
 * of the 「참고」 card used to be told that "some pins" were dropped and not which. Both readers
 * of a warning — the route panel and the copied plan — go through this.
 */
export function warningText(
  warning: PlanWarning,
  giftName: (id: number) => string,
  packName: (id: number) => string,
  lang: Lang,
): string {
  const names = [...(warning.giftIds ?? []).map(giftName), ...(warning.packIds ?? []).map(packName)].filter(
    (name) => name !== '',
  );
  const detail = pick(warning.detail, lang);
  return names.length > 0 ? `${detail} — ${names.join(', ')}` : detail;
}

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
