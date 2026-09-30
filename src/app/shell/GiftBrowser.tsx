/**
 * 「모두 보기」: every gift in one grid, with a search box and the filters (keyword, condition, tier,
 * sin), and no 활성 split — the tile's ring says which is which. The items tab opens it from the >>
 * at the end of its search row, handing over what was typed there (`initialQuery`). On a desktop it takes the stage's place between the
 * two panels; on a phone it is a full-screen page like the panels, closed by its ← or the back
 * gesture (`usePageHistory`). Escape closes it on either; a gift sheet opened from a tile takes the
 * key first (`DetailSurface` stops it before it reaches the document).
 *
 * Its filters are its own (`useGiftFilters`): what is typed here is not typed back into the tab.
 */
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Search, X } from 'lucide-react';
import { t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { classifyGift, compareEntries } from '../lib/gift-priority.ts';
import { browsableParents, conditionReportsByGift, tilesFor } from '../lib/gift-tile.ts';
import { useGiftFilters } from '../lib/useGiftFilters.ts';
import { useLatest } from '../lib/useLatest.ts';
import { usePageHistory } from '../lib/usePageHistory.ts';
import { Badge, IconButton } from '../components/ui.tsx';
import { GiftFilterBar, GiftNoMatch } from '../components/GiftFilterBar.tsx';
import { GiftTileGrid } from '../components/GiftGrid.tsx';
import { usePlan } from './plan-context.ts';

export function GiftBrowser({
  page,
  onClose,
  initialQuery = '',
}: {
  /** A phone: a full-screen page with a back bar, portalled over the shell. */
  page: boolean;
  onClose: () => void;
  /** The query the search box opens with — the tab's, when opened from its >>. */
  initialQuery?: string;
}) {
  const { data, indexes, stats, lang, childrenOf, entangled, blocked, toggleGoal, openGift, giftName } =
    usePlan();
  const wanted = useApp((s) => s.wanted);
  const filterState = useGiftFilters(initialQuery);
  const { filters, matcher } = filterState;

  const conditionByGift = useMemo(() => conditionReportsByGift(data, stats, indexes), [data, stats, indexes]);
  const entangledIds = useMemo(() => new Set(entangled.keys()), [entangled]);
  // One list in the tab's own order — pack-bound first, closer first, then id — without the fold.
  const tiles = useMemo(() => {
    const entries = browsableParents(data, indexes, wanted, childrenOf, matcher)
      .map((gift) => classifyGift(gift, conditionByGift.get(gift.id) ?? []))
      .sort(compareEntries);
    return tilesFor(entries, childrenOf, wanted, conditionByGift, matcher.attrs);
  }, [data, indexes, wanted, childrenOf, matcher, conditionByGift]);

  usePageHistory(true, onClose, page);
  const close = useLatest(onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  // A desktop reader came here to search, so the box takes focus; a phone would raise its keyboard
  // over the grid, so the page hands focus to its back button like the panels do.
  const first = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const title = t('giftsBrowseTitle', lang);
  const body = (
    <>
      <div className="flex h-11 flex-none items-center gap-2 border-b border-line bg-surface px-3">
        {page ? (
          <button
            ref={(el) => {
              first.current = el;
            }}
            type="button"
            onClick={onClose}
            aria-label={t('panelBack', lang)}
            className="-ml-1.5 inline-flex h-8 w-8 flex-none items-center justify-center rounded-full text-fg-2 hover:bg-surface-2"
          >
            <ChevronLeft size={17} aria-hidden />
          </button>
        ) : null}
        {page ? (
          <h1 className="truncate text-sm font-semibold">{title}</h1>
        ) : (
          <h2 className="truncate text-sm font-semibold">{title}</h2>
        )}
        <Badge tone="neutral">{t('giftsSelected', lang, { n: wanted.length })}</Badge>
        {page ? null : (
          <IconButton className="ml-auto" label={t('giftsBrowseClose', lang)} onClick={onClose}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      <div className="flex flex-none flex-col gap-2 border-b border-line px-3 py-2">
        <label className="flex h-9 items-center gap-2 rounded-sm border border-line-control bg-surface px-2.5 text-sm">
          <Search size={14} aria-hidden className="flex-none text-fg-3" />
          <input
            ref={(el) => {
              if (!page) first.current = el;
            }}
            value={filters.query}
            onChange={(event) => filterState.setQuery(event.target.value)}
            placeholder={t('giftsSearch', lang)}
            aria-label={t('giftsSearch', lang)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3"
          />
        </label>
        <GiftFilterBar state={filterState} enums={data.enums} lang={lang} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4" data-testid="gift-browser-scroller">
        {tiles.length === 0 ? (
          <div className="p-2">
            <GiftNoMatch state={filterState} lang={lang} />
          </div>
        ) : (
          <GiftTileGrid
            tiles={tiles}
            wanted={wanted}
            entangled={entangledIds}
            blocked={blocked}
            giftName={giftName}
            enums={data.enums}
            lang={lang}
            onToggle={toggleGoal}
            onOpen={openGift}
          />
        )}
      </div>
    </>
  );

  if (page) {
    // Portalled to the body so the page sits outside the shell the phone marks `inert`.
    return createPortal(
      <div
        data-testid="gift-browser"
        aria-label={title}
        className="fixed inset-0 z-40 flex flex-col bg-bg"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {body}
      </div>,
      document.body,
    );
  }
  // The same height and stickiness as the panels beside it, so it fills the stage's column below
  // the header and scrolls inside itself.
  return (
    <section
      data-testid="gift-browser"
      aria-label={title}
      className="sticky top-14 flex h-[calc(100dvh-56px)] min-w-0 flex-col overflow-hidden bg-bg"
    >
      {body}
    </section>
  );
}
