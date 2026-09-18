/**
 * The surface a detail opens in: a popover beside its anchor on desktop, a bottom sheet on a
 * phone. Escape and a press outside close it. A popover in the `menu` variant is a short list of
 * actions: no close row and no fixed width, so it hugs its items (the header's 「⋯」). Also the body
 * for an observed gift from the start row, which lets it be pinned or released.
 */
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Eye, X } from 'lucide-react';
import type { ObservedGift } from '../../core/types.ts';
import { pick, t } from '../i18n.ts';
import { useDismiss } from '../lib/useDismiss.ts';
import { useOverlayChrome } from '../lib/useOverlayChrome.ts';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Button } from './ui.tsx';

export type DetailMode = 'popover' | 'sheet';

export type Placement = { vertical: 'below' | 'above'; horizontal: 'start' | 'end' };

export function DetailSurface({
  id,
  mode,
  label,
  closeLabel,
  onClose,
  placement,
  variant = 'detail',
  children,
}: {
  /** The surface's DOM id, so a control with `aria-controls` can close what it opened. */
  id?: string;
  mode: DetailMode;
  label: string;
  closeLabel: string;
  onClose: () => void;
  /** Popover only: which side of the anchor it opens on. */
  placement?: Placement;
  /** Popover only: `menu` drops the close row and the fixed width — Escape, a press outside and the
   *  control that opened it (`aria-controls`) already close it. */
  variant?: 'detail' | 'menu';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose, true, { id });
  // A sheet is modal: it holds the background still and hands focus back to whatever opened it.
  useOverlayChrome(ref, mode === 'sheet');
  // The surface renders inside whatever opened it — a sheet portals to the body but its React
  // events still travel the tree that opened it — so its own presses must not reopen it. Escape is
  // handled right here rather than left to `useDismiss`: stopping the event also stops the native
  // one, so the document listener would never see it.
  const stop = {
    onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
    },
  };
  if (mode === 'sheet') {
    // Rendered into the body: a side panel is a `@container`, which makes it the containing block
    // for `position: fixed`, so a sheet opened inside one would be pinned to the panel instead of
    // the viewport. React events still bubble through the tree that opened it.
    //
    // z ladder: phone panel page 40 < this backdrop 50 < this sheet 60 < drag ghost 70. The sheet
    // has to cover the page it was opened from, or the page's back button stays pressable under it.
    return createPortal(
      <>
        <div className="fixed inset-0 z-50 bg-black/40" aria-hidden />
        <div
          ref={ref}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          data-testid="block-sheet"
          {...stop}
          className="fixed inset-x-0 bottom-0 z-[60] max-h-[80dvh] overflow-y-auto rounded-t-md border-t border-line-strong bg-surface px-4 pb-6 pt-2 shadow-pop lg:inset-x-auto lg:left-1/2 lg:w-[520px] lg:-translate-x-1/2 lg:rounded-md lg:border"
        >
          <div className="mb-2 flex items-center">
            <span className="mx-auto h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="absolute right-3 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-2 hover:bg-surface-2"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      </>,
      document.body,
    );
  }
  const vertical = placement?.vertical === 'above' ? { bottom: '100%' } : { top: '100%' };
  const horizontal = placement?.horizontal === 'end' ? { right: 0 } : { left: 0 };
  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      data-testid="block-popover"
      {...stop}
      className={`absolute z-30 rounded-md border border-line-strong bg-surface text-fg shadow-pop ${variant === 'menu' ? 'w-max p-1.5' : 'w-[320px] p-3'}`}
      style={{ ...vertical, ...horizontal }}
    >
      {variant === 'menu' ? null : (
        <div className="mb-1 flex justify-end">
          <button type="button" onClick={onClose} aria-label={closeLabel} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-fg-2 hover:bg-surface-2">
            <X size={13} aria-hidden />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

/** The body for an observed gift from the start row. */
export function ObservedDetailBody({ entry, ctx }: { entry: ObservedGift; ctx: PackContext }) {
  const gift = ctx.indexes.giftById.get(entry.giftId);
  if (!gift) return null;
  const why = entry.pinned
    ? t('routeObservedPinned', ctx.lang)
    : entry.freedPack !== null
      ? t('routeObservedFrees', ctx.lang, { pack: ctx.packName(entry.freedPack) })
      : t('routeObservedRescue', ctx.lang);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <GiftIcon gift={gift} size={44} judgement={ctx.judgements.get(entry.giftId) ?? null} must={ctx.isMust(entry.giftId)} lang={ctx.lang} />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{pick(gift.name, ctx.lang)}</span>
          <span className="text-xs text-fg-2">
            {t('routeObserved', ctx.lang)} · {why}
          </span>
        </div>
      </div>
      {ctx.giftTitle(entry.giftId) ? <span className="text-xs text-fg-2">{ctx.giftTitle(entry.giftId)}</span> : null}
      {ctx.onToggleObserved ? (
        <Button variant={entry.pinned ? 'primary' : 'secondary'} onClick={() => ctx.onToggleObserved?.(entry.giftId)} ariaLabel={t('routeObservedToggle', ctx.lang, { name: pick(gift.name, ctx.lang) })}>
          <Eye size={12} aria-hidden />
          {entry.pinned ? t('routeObservedPinned', ctx.lang) : t('routeObservedRecommended', ctx.lang)}
        </Button>
      ) : null}
    </div>
  );
}
