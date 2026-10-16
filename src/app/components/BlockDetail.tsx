/**
 * The surface a detail opens in: a popover beside its anchor on desktop, a bottom sheet on a
 * phone. Escape and a press outside close it. A popover in the `menu` variant is a short list of
 * actions: no close row and no fixed width, so it hugs its items (the header's 「⋯」). Also the body
 * for an observed gift from the start row, which lets it be pinned or released.
 */
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Eye } from 'lucide-react';
import type { ObservedGift } from '../../core/types.ts';
import { pick, t } from '../i18n.ts';
import { useDismiss } from '../lib/useDismiss.ts';
import { useOverlayChrome } from '../lib/useOverlayChrome.ts';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Button, CloseButton } from './ui.tsx';

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
  alert = false,
  describedBy,
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
  /** Sheet only: a confirmation that interrupts (`alertdialog`), described by `describedBy`. */
  alert?: boolean;
  describedBy?: string;
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
        <div className="fixed inset-0 z-50 bg-scrim" aria-hidden />
        <div
          ref={ref}
          id={id}
          role={alert ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-label={label}
          aria-describedby={describedBy}
          data-testid="block-sheet"
          {...stop}
          // A sheet: the large radius and the deepest shadow (design system §4–5). Its bottom clears
          // the home indicator. No drag handle — nothing drags it, so a handle would promise a swipe.
          style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
          className="fixed inset-x-0 bottom-0 z-[60] max-h-[80dvh] overflow-y-auto rounded-t-lg border-t border-border-strong bg-surface px-4 pt-2 shadow-lg lg:inset-x-auto lg:left-1/2 lg:w-[520px] lg:-translate-x-1/2 lg:rounded-lg lg:border"
        >
          <div className="mb-2 flex justify-end">
            <CloseButton label={closeLabel} onClick={onClose} className="-mr-2" />
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
      className={`absolute z-30 rounded-md border border-border-strong bg-surface text-fg shadow-md ${variant === 'menu' ? 'w-max p-1.5' : 'w-[min(320px,calc(100vw-2rem))] p-3'}`}
      style={{ ...vertical, ...horizontal }}
    >
      {variant === 'menu' ? null : (
        <div className="mb-1 flex justify-end">
          <CloseButton label={closeLabel} onClick={onClose} size="sm" />
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
      <div className="flex items-center gap-3">
        <GiftIcon
          gift={gift}
          size={44}
          judgement={ctx.judgements.get(entry.giftId) ?? null}
          lang={ctx.lang}
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-subheading ">{pick(gift.name, ctx.lang)}</span>
          <span className="text-caption text-fg-muted">
            {t('routeObserved', ctx.lang)} · {why}
          </span>
        </div>
      </div>
      {ctx.giftTitle(entry.giftId) ? (
        <span className="text-caption text-fg-muted">{ctx.giftTitle(entry.giftId)}</span>
      ) : null}
      {ctx.onToggleObserved ? (
        <Button
          variant={entry.pinned ? 'primary' : 'secondary'}
          onClick={() => ctx.onToggleObserved?.(entry.giftId)}
          ariaLabel={t(entry.pinned ? 'observeSlotClear' : 'giftsObserve', ctx.lang, {
            name: pick(gift.name, ctx.lang),
          })}
        >
          <Eye size={12} aria-hidden />
          {t(entry.pinned ? 'observePinned' : 'settingsObserved', ctx.lang)}
        </Button>
      ) : null}
    </div>
  );
}
