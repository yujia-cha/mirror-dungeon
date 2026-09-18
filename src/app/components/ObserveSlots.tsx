/**
 * The observation slots of the items tab: one cell per 기프트 관측 slot the run allows. An empty
 * cell is a 「+」 that opens a list of the selected gifts that can be observed; a filled one shows
 * the gift with a ✕. A selected-gift chip dragged over a cell (see `useChipDrag`) highlights it
 * and lands there on release.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import { DetailSurface } from './BlockDetail.tsx';
import { GiftIcon } from './GiftIcon.tsx';

/**
 * Pins fill the cells from the left: `observedGifts` is a dense list and its order is the cost the
 * run pays (`rules.giftObservation.costTable`), so there is no such thing as an empty slot with a
 * filled one after it. The 「+」 used to promise a numbered cell it could not deliver — it now says
 * only that it adds one, and the cost order stays visible on the filled cells.
 */
export function ObserveSlots({
  slots,
  max,
  candidates,
  indexes,
  judgementOf,
  lang,
  onPin,
  onUnpin,
  dragging,
  over,
  onHover,
}: {
  /** Pinned gift ids, in slot order. */
  slots: number[];
  max: number;
  /** Selected gifts that can still be pinned. */
  candidates: number[];
  indexes: GameIndexes;
  judgementOf: (giftId: number) => Judgement | null;
  lang: Lang;
  onPin: (giftId: number) => void;
  onUnpin: (giftId: number) => void;
  /** A chip is being dragged: cells become drop targets. */
  dragging: boolean;
  /** The cell the drag is over. */
  over: number | null;
  onHover: (slot: number | null) => void;
}) {
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const cells = Array.from({ length: max }, (_, i) => slots[i] ?? null);
  // A cell filled underneath the open popover (a chip dropped there) leaves nothing to pick for.
  const open = openSlot !== null && cells[openSlot] === null ? openSlot : null;
  const popoverId = (i: number): string => `observe-slot-${i}`;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="observe-slots" aria-label={t('observeSlots', lang)}>
      {cells.map((giftId, i) => {
        const gift = giftId !== null ? indexes.giftById.get(giftId) : undefined;
        const name = gift ? pick(gift.name, lang) : '';
        const tone =
          over === i ? 'border-ink bg-surface-2 ring-1 ring-ink' : dragging ? 'border-dashed border-line-strong' : gift ? 'border-line bg-surface' : 'border-dashed border-line';
        return (
          <div
            key={giftId ?? `empty-${i}`}
            className={`relative flex h-11 min-w-[104px] flex-1 items-center gap-1.5 rounded-md border px-1.5 ${tone}`}
            data-testid="observe-slot"
            data-index={i}
            data-observe-slot={i}
            data-gift={giftId ?? undefined}
            onPointerEnter={() => {
              if (dragging) onHover(i);
            }}
            onPointerLeave={() => {
              if (dragging) onHover(null);
            }}
          >
            {gift ? (
              <>
                <GiftIcon gift={gift} size={32} judgement={judgementOf(gift.id)} lang={lang} />
                <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
                <span className="font-num text-[10px] text-fg-3" aria-hidden>
                  {i + 1}
                </span>
                <button type="button" onClick={() => onUnpin(gift.id)} aria-label={t('observeSlotClear', lang, { name })} className="text-fg-3 hover:text-fg">
                  <X size={11} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setOpenSlot(open === i ? null : i)}
                aria-haspopup="dialog"
                aria-expanded={open === i}
                aria-controls={popoverId(i)}
                aria-label={t('observeSlotAdd', lang)}
                className="flex h-full w-full items-center justify-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-fg"
              >
                <Plus size={16} />
              </button>
            )}
            {open === i ? (
              <DetailSurface id={popoverId(i)} mode="popover" label={t('observeSlotAdd', lang)} closeLabel={t('routeClose', lang)} onClose={() => setOpenSlot(null)}>
                {candidates.length === 0 ? (
                  <p className="text-xs text-fg-3">{t('observeSlotNone', lang)}</p>
                ) : (
                  <ul className="flex max-h-[50dvh] flex-col gap-1 overflow-y-auto" data-testid="observe-candidates">
                    {candidates.map((id) => {
                      const candidate = indexes.giftById.get(id);
                      if (!candidate) return null;
                      const candidateName = pick(candidate.name, lang);
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => {
                              onPin(id);
                              setOpenSlot(null);
                            }}
                            aria-label={t('giftsObserve', lang, { name: candidateName })}
                            className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-surface-2"
                          >
                            <GiftIcon gift={candidate} size={32} judgement={judgementOf(id)} lang={lang} />
                            <span className="min-w-0 flex-1 truncate">{candidateName}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DetailSurface>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
