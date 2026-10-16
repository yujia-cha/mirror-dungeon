/**
 * Telling game screens apart by their banner titles.
 *
 * Every screen the run tracker cares about carries a large title — 「E.G.O 기프트를 획득했습니다.」,
 * 「E.G.O 기프트 구매」 — so the screen is read the same way a name is: OCR the banner regions, then
 * find which known title the text is closest to.
 *
 * Two things make this harder than a name:
 * - The titles share their start. OCR mangles 「E.G.O」 into 「6.6.0」 or 「8.ㅇ.0」 on almost every
 *   read, while the part that tells screens apart is the Korean after it. So for Korean only the
 *   Hangul is compared.
 * - 「구매」, 「판매」 and 「강화」 differ by a syllable. A line therefore votes for its closest title
 *   only, not for every title above a threshold.
 *
 * Pure. Titles and their order live here until the layout moves to curated data.
 */
import type { Lang } from '../i18n.ts';
import { similarity } from './match-name.ts';

/**
 * Banner titles, in the order they win when several are on screen: a popup sits over the screen
 * it came from and that screen's title stays readable behind it, dimmed, so popups come first.
 * English titles are not known yet; an empty one is never matched.
 */
export const SCREEN_TITLES = {
  acquired: { ko: 'E.G.O 기프트를 획득했습니다.', en: '' },
  fusionConfirm: { ko: '선택한 E.G.O 기프트를 조합하시겠습니까?', en: '' },
  fusionKeyword: { ko: '합성 - 키워드 선택', en: '' },
  purchase: { ko: 'E.G.O 기프트 구매', en: '' },
  sell: { ko: 'E.G.O 기프트 판매', en: '' },
  enhance: { ko: 'E.G.O 기프트 강화', en: '' },
  fusion: { ko: 'E.G.O 기프트 합성', en: '' },
} as const satisfies Record<string, Record<Lang, string>>;

export type Screen = keyof typeof SCREEN_TITLES;

/** A line counts as a title at this similarity. */
export const TITLE_MIN = 0.8;

/** Hangul syllables only — what tells Korean titles apart once 「E.G.O」 is unreadable. */
function hangulOnly(text: string): string {
  return text.replace(/[^가-힣]/g, '');
}

/** The text of a title or an OCR line as it is compared for `lang`. */
function comparable(text: string, lang: Lang): string {
  return lang === 'ko' ? hangulOnly(text) : text;
}

/**
 * Which screen the OCR'd banner lines show, or null when no line is close to any title. Each line
 * votes for its single closest title; among the titles with a vote the earliest in SCREEN_TITLES
 * wins.
 */
export function classifyScreen(lines: readonly string[], lang: Lang): Screen | null {
  const titles = (Object.keys(SCREEN_TITLES) as Screen[]).filter((s) => SCREEN_TITLES[s][lang] !== '');
  const seen = new Set<Screen>();
  for (const line of lines) {
    const text = comparable(line, lang);
    let best: Screen | null = null;
    let bestScore = TITLE_MIN;
    for (const screen of titles) {
      const score = similarity(text, comparable(SCREEN_TITLES[screen][lang], lang));
      if (score > bestScore || (score === bestScore && best === null)) [best, bestScore] = [screen, score];
    }
    if (best) seen.add(best);
  }
  return titles.find((screen) => seen.has(screen)) ?? null;
}
