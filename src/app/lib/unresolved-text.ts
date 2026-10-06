/**
 * The route panel's 「참고」 card in the reader's language: core writes each warning's sentence but
 * never carries display names, so the targets are named here.
 */
import type { PlanWarning } from '../../core/types.ts';
import { pick, type Lang } from '../i18n.ts';

/**
 * A warning's sentence with its targets named after it: 「… 제외했습니다 — 깨진 안경」. Core fills
 * `giftIds`/`packIds` on the warnings that have targets (`observation-trimmed`, `fusion-slots`,
 * `pack-option-dropped`, `shared-ingredient`) but writes the sentence without them, so a reader
 * of the 「참고」 card used to be told that "some pins" were dropped and not which.
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
