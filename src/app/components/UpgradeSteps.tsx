/**
 * The enhancement choice for one gift (M130): a `+` button, and `++` when the gift has a second
 * step — only the steps the game ships text for. Pressing a step picks it, pressing the picked one
 * goes back to the plain gift (a toggle, `aria-pressed`). The choice lives in the store
 * (`upgrades`), so the goal tile and the gift sheet always agree.
 *
 * Its own small control rather than `Button`: in a goal tile it has to split a 64px tile in two,
 * which `Button`'s padding cannot. The states are `SizeSteps`' — a control frame, filled with
 * primary while pressed — and the press heights are the library's (24px / 44px on touch).
 */
import type { Gift, UpgradeLevel } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { stepLabel } from '../lib/upgrade.ts';
import { useApp } from '../store.ts';

const STEP =
  'inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-border-control bg-surface font-num text-caption-strong text-fg transition-colors duration-150 hover:bg-surface-muted active:bg-surface-sunken aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg';

export function UpgradeSteps({
  gift,
  lang,
  compact = false,
}: {
  gift: Gift;
  lang: Lang;
  /** In a goal tile: the steps share the tile's width. In the sheet: two square-ish buttons. */
  compact?: boolean;
}) {
  const chosen = useApp((state) => state.upgrades[gift.id] ?? 0);
  const setUpgrade = useApp((state) => state.setUpgrade);
  const levels = (gift.upgrades ?? []).map((upgrade) => upgrade.level);
  if (levels.length === 0) return null;
  const name = pick(gift.name, lang);
  return (
    <div
      role="group"
      aria-label={t('giftUpgradeGroup', lang, { name })}
      className={compact ? 'grid w-full gap-0.5' : 'grid flex-none gap-1'}
      style={{ gridTemplateColumns: `repeat(${levels.length},minmax(0,1fr))` }}
      data-testid="gift-upgrade"
      data-level={chosen}
      data-uniform="both"
    >
      {levels.map((level: UpgradeLevel) => (
        <button
          key={level}
          type="button"
          aria-pressed={chosen === level}
          aria-label={t('giftUpgradeStep', lang, { name, step: stepLabel(level) })}
          onClick={() => setUpgrade(gift.id, chosen === level ? 0 : level)}
          className={`${STEP} ${compact ? 'h-6 min-w-0 touch:h-11' : 'h-7 min-w-9 px-2 touch:h-11 touch:min-w-11'}`}
          data-upgrade-step={level}
        >
          {stepLabel(level)}
        </button>
      ))}
    </div>
  );
}
