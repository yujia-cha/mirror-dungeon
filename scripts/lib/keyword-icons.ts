/**
 * Which keyword icon files to take from eldritchtools/limbus-assets (M99). The gift tile's keyword
 * badge draws them; the owner chose the game's own icons over the coloured dots. The deck draws the
 * same icons for an identity's keywords and attack types (M131), plus the two identity-only
 * resources 탄환 and 혈찬.
 *
 * The upstream files are named in English game terms, not by our keyword ids, so the map is written
 * out here — twelve paths, checked against the pinned commit when each was added. The ten gift
 * keywords live in `assets/icons/`; 탄환 (`Bullet`) and 혈찬 (`BloodDinner`) have no entry there and
 * come from the status icons `assets/statuses/`, under the file the upstream `data/statuses.json`
 * gives as their `srcPath` (`Bullet` → `Ammo`, `BloodDinner` → `Bloodfeast`).
 * `None` (키워드 없음) has no icon and no badge.
 */
import type { IconKeyword } from '../../src/core/schema.ts';

/** Where the icons live, one `{Keyword}.webp` per keyword, plus `manifest.json`. */
export const KEYWORD_ICON_DIR = 'public/icons/keywords';
/** A keyword icon is ~4–8 KB. */
export const MAX_KEYWORD_ICON_BYTES = 64 * 1024;

/** Our keyword id → the upstream file, relative to the repository root, without `.webp`. */
export const UPSTREAM_KEYWORD_FILES: Record<IconKeyword, string> = {
  Combustion: 'assets/icons/Burn',
  Laceration: 'assets/icons/Bleed',
  Vibration: 'assets/icons/Tremor',
  Burst: 'assets/icons/Rupture',
  Sinking: 'assets/icons/Sinking',
  Breath: 'assets/icons/Poise',
  Charge: 'assets/icons/Charge',
  Slash: 'assets/icons/Slash',
  Penetrate: 'assets/icons/Pierce',
  Hit: 'assets/icons/Blunt',
  Bullet: 'assets/statuses/Ammo',
  BloodDinner: 'assets/statuses/Bloodfeast',
};

/** One download per keyword, ascending by keyword id. */
export function planKeywordIcons(): { key: IconKeyword; remote: string }[] {
  return (Object.keys(UPSTREAM_KEYWORD_FILES) as IconKeyword[])
    .sort()
    .map((key) => ({ key, remote: `${UPSTREAM_KEYWORD_FILES[key]}.webp` }));
}
