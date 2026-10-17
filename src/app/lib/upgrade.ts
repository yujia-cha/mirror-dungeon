/**
 * Gift enhancement (M130): the `+` / `++` step a player picked for a gift (`useApp().upgrades`),
 * and the game's own name and text for it (`gift.upgrades`). Only the goal tiles and the gift
 * sheet show the chosen step; every other place draws the plain gift.
 */
import type { Gift, GiftUpgrade, UpgradeLevel } from '../../core/schema.ts';
import { pick, type Lang } from '../i18n.ts';

/** The highest step each gift has text for — what `adoptSeason` keeps choices against. */
export function upgradeLevelsOf(gifts: readonly Gift[]): Map<number, UpgradeLevel> {
  const out = new Map<number, UpgradeLevel>();
  for (const gift of gifts) {
    const top = Math.max(0, ...(gift.upgrades ?? []).map((upgrade) => upgrade.level));
    if (top === 1 || top === 2) out.set(gift.id, top);
  }
  return out;
}

/** The step's data, when the gift has that step. Level 0 (or a missing step) is the plain gift. */
export function upgradeStep(gift: Gift, level: UpgradeLevel | 0 | undefined): GiftUpgrade | undefined {
  if (!level) return undefined;
  return gift.upgrades?.find((upgrade) => upgrade.level === level);
}

/** The gift's name at the chosen step: 「하모닉스+」, or the plain name. */
export function upgradedName(gift: Gift, level: UpgradeLevel | 0 | undefined, lang: Lang): string {
  return pick((upgradeStep(gift, level) ?? gift).name, lang);
}

/** How a step is written on its button. */
export function stepLabel(level: UpgradeLevel): string {
  return '+'.repeat(level);
}

/** The steps the gift has text for, lowest first. */
export function levelsOf(gift: Gift): UpgradeLevel[] {
  return (gift.upgrades ?? []).map((upgrade) => upgrade.level).sort((a, b) => a - b);
}

/** The step after `chosen` in the goal tile badge's cycle (M131): plain → each step in turn → plain. */
export function nextUpgrade(levels: readonly UpgradeLevel[], chosen: UpgradeLevel | 0): UpgradeLevel | 0 {
  if (chosen === 0) return levels[0] ?? 0;
  const index = levels.indexOf(chosen);
  return index < 0 ? (levels[0] ?? 0) : (levels[index + 1] ?? 0);
}
