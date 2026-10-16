/**
 * Which keyword icon files to take from eldritchtools/limbus-assets (M99). The gift tile's keyword
 * badge draws them; the owner chose the game's own icons over the coloured dots.
 *
 * The upstream folder `assets/icons/` names them in English game terms, not by our keyword ids, so
 * the map is written out here — ten names, checked against the pinned commit when the set was added.
 * `None` (키워드 없음) has no icon and no badge.
 */
import type { Keyword } from '../../src/core/schema.ts';

/** Where the icons live, one `{Keyword}.webp` per keyword, plus `manifest.json`. */
export const KEYWORD_ICON_DIR = 'public/icons/keywords';
/** A keyword icon is ~4–8 KB. */
export const MAX_KEYWORD_ICON_BYTES = 64 * 1024;

export type BadgeKeyword = Exclude<Keyword, 'None'>;

/** Our keyword id → the upstream file stem. */
export const UPSTREAM_KEYWORD_FILES: Record<BadgeKeyword, string> = {
  Combustion: 'Burn',
  Laceration: 'Bleed',
  Vibration: 'Tremor',
  Burst: 'Rupture',
  Sinking: 'Sinking',
  Breath: 'Poise',
  Charge: 'Charge',
  Slash: 'Slash',
  Penetrate: 'Pierce',
  Hit: 'Blunt',
};

/** One download per keyword, ascending by keyword id. */
export function planKeywordIcons(): { key: BadgeKeyword; remote: string }[] {
  return (Object.keys(UPSTREAM_KEYWORD_FILES) as BadgeKeyword[])
    .sort()
    .map((key) => ({ key, remote: `assets/icons/${UPSTREAM_KEYWORD_FILES[key]}.webp` }));
}
