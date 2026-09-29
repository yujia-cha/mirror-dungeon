/**
 * The selection tray: the gifts chosen as goals, laid out as the same tiles the item grid uses
 * (`GiftTileGrid` — 32px icon, name on two lines) so a gift looks the same before and after it is
 * picked. Pressing the name opens the sheet; the ✕ in the corner takes the gift out of the
 * selection; the whole tile is the drag handle that carries it onto an observation slot. An
 * observation pin darkens the border, and a fusion goal that shares an ingredient with another
 * wears the link mark in its top-left corner, as the grid tile does.
 */
import { Link2, X } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { GameIndexes } from '../../core/types.ts';
import { t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import { GiftIcon } from './GiftIcon.tsx';

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
  return (
    <div
      className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(64px,1fr))]"
      data-testid="gift-chips"
    >
      {ids.map((id) => {
        const gift = indexes.giftById.get(id);
        const name = giftName(id);
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
            className={`relative flex select-none flex-col items-center gap-[3px] rounded-md border bg-surface px-1 pb-1.5 pt-2 ${
              isPinned ? 'border-ink' : 'border-line'
            } ${dragging === id ? 'opacity-40' : ''}`}
          >
            {entangled.has(id) ? (
              <span
                className="absolute left-0.5 top-0.5 z-10 text-fg-2"
                aria-hidden
                title={t('giftEntangled', lang)}
              >
                <Link2 size={11} />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label={t('removeFromSelection', lang, { name })}
              title={t('removeFromSelection', lang, { name })}
              className="absolute -right-1 -top-1 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-fg-3 hover:bg-surface-2 hover:text-fg"
            >
              <X size={11} aria-hidden />
            </button>
            {gift ? <GiftIcon gift={gift} size={32} judgement={judgementOf(id)} lang={lang} /> : null}
            <button
              type="button"
              onClick={() => onOpen(id)}
              aria-haspopup="dialog"
              aria-label={t('giftDetail', lang, { name })}
              className="line-clamp-2 h-[24px] w-full break-keep text-center text-[10px] font-medium leading-tight text-fg underline-offset-2 hover:underline"
            >
              {name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
