/**
 * The enhancement choice for one gift (M130), in two shapes over one store value (`upgrades`), so
 * the goal tile and the gift sheet always agree. Only the steps the game ships text for are offered.
 *
 * - `UpgradeSteps` — the gift sheet: a `+` button, and `++` when the gift has a second step.
 *   Pressing a step picks it, pressing the picked one goes back to the plain gift (a toggle,
 *   `aria-pressed`). Its own small control rather than `Button`: the states are `SizeSteps`' — a
 *   control frame, filled with primary while pressed — at the library's press heights (28px / 44px
 *   on touch).
 * - `UpgradeBadge` — a goal tile (M131): one badge on the icon's bottom-left corner that cycles
 *   plain → first step → next step → plain. Buttons under the name made the enhanceable tiles taller
 *   than their neighbours; a corner badge leaves every tile the same size.
 */
import type { Gift } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { levelsOf, nextUpgrade, stepLabel } from '../lib/upgrade.ts';
import { useApp } from '../store.ts';

const STEP =
  'inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-border-control bg-surface font-num text-caption-strong text-fg transition-colors duration-150 hover:bg-surface-muted active:bg-surface-sunken aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg';

export function UpgradeSteps({ gift, lang }: { gift: Gift; lang: Lang }) {
  const chosen = useApp((state) => state.upgrades[gift.id] ?? 0);
  const setUpgrade = useApp((state) => state.setUpgrade);
  const levels = levelsOf(gift);
  if (levels.length === 0) return null;
  const name = pick(gift.name, lang);
  return (
    <div
      role="group"
      aria-label={t('giftUpgradeGroup', lang, { name })}
      className="grid flex-none gap-1"
      style={{ gridTemplateColumns: `repeat(${levels.length},minmax(0,1fr))` }}
      data-testid="gift-upgrade"
      data-level={chosen}
      data-uniform="both"
    >
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={chosen === level}
          aria-label={t('giftUpgradeStep', lang, { name, step: stepLabel(level) })}
          onClick={() => setUpgrade(gift.id, chosen === level ? 0 : level)}
          className={`${STEP} h-7 min-w-9 px-2 touch:h-11 touch:min-w-11`}
          data-upgrade-step={level}
        >
          {stepLabel(level)}
        </button>
      ))}
    </div>
  );
}

/**
 * The goal tile's corner badge. Plain: a dashed control frame around 「+」 — full contrast, so it
 * does not read as disabled. A step chosen: filled with primary, 「+」 or 「++」. The text and the
 * frame's line say the state, never the colour alone. 16px to see like the tile's ✕ (`CloseButton`
 * `badge`), 24px to press (44px on touch) through a pseudo-element. The caller places it
 * (`absolute …`); nothing is drawn for a gift without steps.
 */
export function UpgradeBadge({ gift, lang, className = '' }: { gift: Gift; lang: Lang; className?: string }) {
  const chosen = useApp((state) => state.upgrades[gift.id] ?? 0);
  const setUpgrade = useApp((state) => state.setUpgrade);
  const levels = levelsOf(gift);
  if (levels.length === 0) return null;
  const name = pick(gift.name, lang);
  const next = nextUpgrade(levels, chosen);
  const nextText = next === 0 ? t('giftUpgradeNone', lang) : stepLabel(next);
  const label =
    chosen === 0
      ? t('giftUpgradeBadgeOff', lang, { name, next: nextText })
      : t('giftUpgradeBadgeOn', lang, { name, step: stepLabel(chosen), next: nextText });
  return (
    <button
      type="button"
      onClick={() => setUpgrade(gift.id, next)}
      aria-label={label}
      title={label}
      data-testid="gift-upgrade-badge"
      data-level={chosen}
      // `type-scale-none`: the badge is part of the picture (like the tier chip), which 「글자 크기」
      // does not grow. The 1px border takes a pixel a side off the pseudo-element's box, hence
      // -inset-[5px] for 24px and -inset-[15px] for 44px.
      className={`type-scale-none inline-flex h-4 min-w-4 flex-none items-center justify-center whitespace-nowrap rounded-full border px-0.5 font-num text-caption-strong transition-colors duration-150 after:absolute after:-inset-[5px] after:content-[''] touch:after:-inset-[15px] ${
        chosen === 0
          ? 'border-dashed border-border-control bg-surface text-fg hover:bg-surface-muted'
          : 'border-primary bg-primary text-primary-fg'
      } ${className}`}
    >
      {/* In its own box: the press area (`::after`) reaches past the button, and the button's
          scroll width counts it, so text set straight in the button reads as clipped. */}
      <span className="block">{chosen === 0 ? '+' : stepLabel(chosen)}</span>
    </button>
  );
}
