/**
 * The observation slots of the items tab: one cell per 기프트 관측 slot the run allows. An empty
 * cell is a 「+」 that opens a list of the selected gifts that can be observed; a filled one shows
 * the gift with a ✕. A selected-gift chip dragged over a cell (see `useChipDrag`) highlights it
 * and lands there on release.
 *
 * An empty cell also shows what the planner would observe there (`suggested`, the unpinned part of
 * `plan.start.observed`), drawn dim with 「추천」: the route panel already counted those, and a row of
 * bare 「+」 beside a route that uses three observations read as if nothing were planned. Pressing
 * it opens the same list with the suggestion first — one way in, and a stray press pins nothing.
 *
 * The list opens as a sheet (M120): as a popover it hung inside the panel's scroll and was cut
 * off. Its first row is 「관측하지 않기」 — the player may leave a slot unused, and the plan then
 * spends one observation fewer (`options.observationSlots`). A slot turned off sits at the right
 * end as 「관측 안 함」 with a button that turns it back on.
 */
import { useState } from 'react';
import { EyeOff, Plus } from 'lucide-react';
import { CloseButton, LinkButton } from './ui.tsx';
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
  budget,
  onSkip,
  onUnskip,
  candidates,
  suggested,
  indexes,
  judgementOf,
  lang,
  onPin,
  onUnpin,
  onOpenGift,
  closed,
  dragging,
  over,
  onHover,
}: {
  /** Pinned gift ids, in slot order. */
  slots: number[];
  max: number;
  /** The slots the plan may spend (`max` less those turned off); the rest draw 「관측 안 함」. */
  budget: number;
  /** Turn one empty slot off: the plan observes one gift fewer. */
  onSkip: () => void;
  /** Turn one slot back on. */
  onUnskip: () => void;
  /** Selected gifts that can still be pinned. */
  candidates: number[];
  /** What the planner would observe in the empty cells, in order (none once `closed`). */
  suggested: number[];
  indexes: GameIndexes;
  judgementOf: (giftId: number) => Judgement | null;
  lang: Lang;
  onPin: (giftId: number) => void;
  onUnpin: (giftId: number) => void;
  /** Open a gift's details from its name (M120). */
  onOpenGift?: (giftId: number) => void;
  /**
   * The observation window has closed (floor 1 is left): no empty cell is drawn, a filled one
   * keeps only its ✕, and a caption says why. With nothing pinned there is nothing to draw.
   */
  closed: boolean;
  /** A chip is being dragged: cells become drop targets. */
  dragging: boolean;
  /** The cell the drag is over. */
  over: number | null;
  onHover: (slot: number | null) => void;
}) {
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const cells = closed
    ? slots.slice(0, max).map((id): number | null => id)
    : Array.from({ length: max }, (_, i) => slots[i] ?? null);
  // A cell filled underneath the open popover (a chip dropped there) leaves nothing to pick for.
  const open = openSlot !== null && cells[openSlot] === null ? openSlot : null;
  const popoverId = (i: number): string => `observe-slot-${i}`;
  if (cells.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="observe-slots"
      data-closed={closed || undefined}
      role="group"
      aria-label={t('observeSlots', lang)}
    >
      <p className="font-num text-caption text-fg-muted" data-testid="observe-slots-count">
        {t('observeSlotsCount', lang, { n: slots.length, max: budget })}
      </p>
      {/* A grid of equal cells (M128): wrapping `flex-1` cells left the third alone on its row,
          stretched to twice the width of the two above it. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-1.5" data-uniform="both">
        {cells.map((giftId, i) => {
          const gift = giftId !== null ? indexes.giftById.get(giftId) : undefined;
          const name = gift ? pick(gift.name, lang) : '';
          const tone =
            over === i
              ? 'border-primary bg-surface-muted ring-1 ring-primary'
              : dragging
                ? 'border-dashed border-border-control'
                : gift
                  ? 'border-border bg-surface'
                  : 'border-dashed border-border-control';
          // The empty cells take the suggestions in order, after the pins.
          if (!gift && !closed && i >= budget) {
            return (
              <div
                key={`off-${i}`}
                className="relative flex h-11 min-w-[104px] flex-1 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2"
                data-testid="observe-slot"
                data-index={i}
                data-off
              >
                <EyeOff size={14} aria-hidden className="flex-none text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-caption text-fg-muted">
                  {t('observeSlotOff', lang)}
                </span>
                <CloseButton label={t('observeSlotOn', lang)} onClick={onUnskip} size="sm" />
              </div>
            );
          }
          const hintId = gift ? undefined : suggested[i - slots.length];
          const hint = hintId !== undefined ? indexes.giftById.get(hintId) : undefined;
          const hintName = hint ? pick(hint.name, lang) : '';
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
                  {onOpenGift ? (
                    <LinkButton
                      onClick={() => onOpenGift(gift.id)}
                      className="min-w-0 flex-1 truncate text-left text-caption"
                    >
                      {name}
                    </LinkButton>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-caption" title={name}>
                      {name}
                    </span>
                  )}
                  <span className="font-num text-micro text-fg-subtle" aria-hidden>
                    {i + 1}
                  </span>
                  <CloseButton
                    label={t('observeSlotClear', lang, { name })}
                    onClick={() => onUnpin(gift.id)}
                    size="sm"
                  />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenSlot(open === i ? null : i)}
                  aria-haspopup="dialog"
                  aria-expanded={open === i}
                  aria-controls={popoverId(i)}
                  aria-label={
                    hint ? t('observeSlotAddSuggested', lang, { name: hintName }) : t('observeSlotAdd', lang)
                  }
                  data-suggested={hint?.id}
                  className={`flex h-full w-full items-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg ${hint ? 'gap-1.5 text-left' : 'justify-center'}`}
                >
                  {hint ? (
                    <>
                      <GiftIcon gift={hint} size={32} judgement={judgementOf(hint.id)} dim lang={lang} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-caption text-fg-muted">{hintName}</span>
                        <span className="text-micro text-fg-subtle">
                          {t('routeObservedRecommended', lang)}
                        </span>
                      </span>
                      <Plus size={14} aria-hidden className="flex-none" />
                    </>
                  ) : (
                    <Plus size={16} />
                  )}
                </button>
              )}
              {open === i ? (
                <DetailSurface
                  id={popoverId(i)}
                  mode="sheet"
                  label={t('observeSlotAdd', lang)}
                  closeLabel={t('routeClose', lang)}
                  onClose={() => setOpenSlot(null)}
                >
                  <h2 className="mb-2 text-subheading">{t('observeSlotAdd', lang)}</h2>
                  {/* First, so leaving the slot unused is as easy to find as any gift. */}
                  <button
                    type="button"
                    onClick={() => {
                      onSkip();
                      setOpenSlot(null);
                    }}
                    className="mb-1 flex w-full items-center gap-2 rounded-sm border border-dashed border-border-control px-1.5 py-1 text-left text-body hover:bg-surface-muted touch:min-h-11"
                    data-testid="observe-skip"
                  >
                    <span className="inline-flex size-8 flex-none items-center justify-center rounded-sm bg-surface-sunken text-fg-muted">
                      <EyeOff size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">{t('observeSlotSkip', lang)}</span>
                  </button>
                  {candidates.length === 0 ? (
                    <p className="text-caption text-fg-subtle">{t('observeSlotNone', lang)}</p>
                  ) : (
                    <ul className="flex flex-col gap-1" data-testid="observe-candidates">
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
                              className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-body hover:bg-surface-muted"
                            >
                              <GiftIcon gift={candidate} size={32} judgement={judgementOf(id)} lang={lang} />
                              <span className="min-w-0 flex-1 truncate">{candidateName}</span>
                              {suggested.includes(id) ? (
                                <span className="flex-none text-micro text-fg-subtle">
                                  {t('routeObservedRecommended', lang)}
                                </span>
                              ) : null}
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
      {closed ? <p className="text-caption text-fg-muted">{t('giftsObserveClosed', lang)}</p> : null}
    </div>
  );
}
