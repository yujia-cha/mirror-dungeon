/**
 * The selection tray: the gifts chosen as goals, laid out as the same tiles the item grid uses
 * (`GiftTileGrid` — 32px icon, name on two lines) so a gift looks the same before and after it is
 * picked. Pressing the name opens the sheet; the ✕ in the corner takes the gift out of the
 * selection; the whole tile is the drag handle that carries it onto an observation slot. An
 * observation pin darkens the border, and a fusion goal that shares an ingredient with another
 * wears the link mark in its top-left corner, as the grid tile does.
 *
 * A gift the game lets you enhance carries its `+` / `++` choice as a badge on the icon's
 * bottom-left corner (M131 — the one corner `GiftIcon` leaves free), and the tile then shows the
 * chosen step's name (「하모닉스+」). Buttons under the name (M130) made those tiles taller than the
 * rest of their row; the badge keeps every tile the same size, so the grid is `data-uniform="both"`.
 * The icon itself does nothing when pressed here, so the badge's press area may cover it; the name
 * sits above that area (`z-10`, later in the tree), so a press on the name always opens the sheet.
 */
import { Link2 } from 'lucide-react';
import { CloseButton, LinkButton } from './ui.tsx';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GameIndexes } from '../../core/types.ts';
import { t, type Lang } from '../i18n.ts';
import { tileColumns, useTileIconSize } from '../lib/icon-size.ts';
import type { Judgement } from '../lib/judgement.ts';
import { GiftIcon } from './GiftIcon.tsx';
import { UpgradeBadge } from './UpgradeSteps.tsx';
import { useApp } from '../store.ts';
import { upgradedName } from '../lib/upgrade.ts';

export function SelectedTiles({
  ids,
  indexes,
  pinned,
  entangled,
  dragging,
  handleFor,
  judgementOf,
  giftName,
  lang,
  onOpen,
  onRemove,
}: {
  /** The gifts to show, in the tray's own order (a view over `wanted`, never a reordering of it). */
  ids: readonly number[];
  indexes: GameIndexes;
  /** Gifts pinned for observation. */
  pinned: readonly number[];
  /** Fusion goals that share an ingredient with another goal. */
  entangled: ReadonlySet<number>;
  /** The gift currently being dragged, if any. */
  dragging: number | null;
  /** From `useChipDrag`: the pointer handler spread onto each tile. */
  handleFor: (giftId: number) => { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void };
  judgementOf: (giftId: number) => Judgement | null;
  giftName: (giftId: number) => string;
  lang: Lang;
  onOpen: (giftId: number) => void;
  onRemove: (giftId: number) => void;
}) {
  const size = useTileIconSize(32);
  const upgrades = useApp((state) => state.upgrades);
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: tileColumns(size) }}
      data-testid="gift-chips"
      data-uniform="both"
    >
      {ids.map((id) => {
        const gift = indexes.giftById.get(id);
        const name = gift ? upgradedName(gift, upgrades[id], lang) : giftName(id);
        const isPinned = pinned.includes(id);
        return (
          <div
            key={id}
            data-testid="gift-chip"
            data-gift={id}
            data-pinned={isPinned || undefined}
            data-entangled={entangled.has(id) || undefined}
            {...handleFor(id)}
            // `none` made every tile a dead zone: with a dozen goals the panel could not be
            // scrolled by touching one. `pan-y` keeps scrolling; on touch the drag starts on a
            // long press instead (`useChipDrag`), so the callout that a long press would open
            // on iOS is turned off here.
            style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
            onContextMenu={(event) => event.preventDefault()}
            className={`relative flex select-none flex-col items-center gap-1 rounded-md border bg-surface px-1 pb-1.5 pt-2 ${
              isPinned ? 'border-primary' : 'border-border'
            } ${dragging === id ? 'opacity-40' : ''}`}
          >
            {entangled.has(id) ? (
              <span
                className="absolute left-0.5 top-0.5 z-10 text-fg-muted"
                aria-hidden
                title={t('giftEntangled', lang)}
              >
                <Link2 size={11} />
              </span>
            ) : null}
            {/* 16px to see, so it does not cover the icon; 24px to press (44px on touch). */}
            <CloseButton
              variant="badge"
              label={t('removeFromSelection', lang, { name })}
              onClick={() => onRemove(id)}
              className="absolute -right-1 -top-1 z-10"
            />
            {gift ? (
              <span className="relative inline-flex flex-none">
                <GiftIcon gift={gift} size={size} judgement={judgementOf(id)} lang={lang} />
                {/* Clear of the tier chip (top-left) and the keyword badge (bottom-right) at every size. */}
                <UpgradeBadge gift={gift} lang={lang} className="absolute -bottom-0.5 -left-1 z-10" />
              </span>
            ) : null}
            <LinkButton
              onClick={() => onOpen(id)}
              ariaLabel={t('giftDetail', lang, { name })}
              className="relative z-10 line-clamp-2 h-[2.6em] w-full break-keep text-center text-caption-strong"
            >
              {name}
            </LinkButton>
          </div>
        );
      })}
    </div>
  );
}
