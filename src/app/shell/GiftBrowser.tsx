/**
 * 「모두 보기」: the gifts in two tabs (M121). 「추천 기프트」 opens first, every time — the gifts the
 * current deck sets off (`lib/recommend.ts`), with its own filters (획득 · 조합 · 키워드 · 정렬).
 * 「모든 기프트」 is every gift in one grid with the filters (keyword, condition, tier, sin) and no
 * 활성 split — the tile's ring says which is which. The search box above them serves both tabs.
 *
 * The items tab opens it from the >> at the end of its search row, handing over what was typed
 * there (`initialQuery`). On a desktop it takes the stage's place between the two panels; on a
 * phone it is a full-screen page like the panels, closed by its ← or the back gesture
 * (`usePageHistory`). Escape closes it on either; a gift sheet opened from a tile takes the key
 * first (`DetailSurface` stops it before it reaches the document).
 *
 * Its filters are its own (`useGiftFilters`): what is typed here is not typed back into the tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Search, X } from 'lucide-react';
import { skillGiftLookup } from '../../core/index.ts';
import { t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { classifyGift, compareEntries, type GiftEntry } from '../lib/gift-priority.ts';
import { browsableParents, conditionReportsByGift, tilesFor, type GiftTileData } from '../lib/gift-tile.ts';
import { matchesGiftName } from '../lib/gift-filters.ts';
import {
  DEFAULT_RECOMMEND_FILTERS,
  effectReportsByGift,
  matchesRecommendFilters,
  recommendFiltersActive,
  recommendedGifts,
  type RecommendFilters,
} from '../lib/recommend.ts';
import { orderRecommended } from '../lib/recommend-rank.ts';
import { useGiftFilters } from '../lib/useGiftFilters.ts';
import { useLatest } from '../lib/useLatest.ts';
import { usePageHistory } from '../lib/usePageHistory.ts';
import { Badge, IconButton, TextField } from '../components/ui.tsx';
import { GiftFilterBar, GiftNoMatch } from '../components/GiftFilterBar.tsx';
import { GiftTileGrid } from '../components/GiftGrid.tsx';
import { RecommendFilterBar, RecommendedSections } from '../components/RecommendedGifts.tsx';
import { TabBar, type PanelTab } from './SidePanel.tsx';
import { usePlan } from './plan-context.ts';

type BrowserTab = 'recommended' | 'all';

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
  const deckSize = useApp((s) => s.deck.length);
  const filterState = useGiftFilters(initialQuery);
  const { filters, matcher } = filterState;
  // Not remembered: the browser mounts afresh on every open (`key`), and opens on 추천 each time.
  const [tab, setTab] = useState<BrowserTab>('recommended');
  const [recFilters, setRecFilters] = useState<RecommendFilters>(DEFAULT_RECOMMEND_FILTERS);

  const conditionByGift = useMemo(() => conditionReportsByGift(data, stats, indexes), [data, stats, indexes]);
  const entangledIds = useMemo(() => new Set(entangled.keys()), [entangled]);
  // 「모든 기프트」: one list in the tab's own order — pack-bound first, closer first, then id — without the fold.
  const tiles = useMemo(() => {
    const entries = browsableParents(data, indexes, wanted, childrenOf, matcher)
      .map((gift) => classifyGift(gift, conditionByGift.get(gift.id) ?? []))
      .sort(compareEntries);
    return tilesFor(entries, childrenOf, wanted, conditionByGift, matcher.attrs);
  }, [data, indexes, wanted, childrenOf, matcher, conditionByGift]);

  // 「추천 기프트」: every gift on offer judged on its own (an upgrade child too, as its own tile —
  // its parent's lock still reaches it through `blocked`), then the tab's filters and the query.
  // Who meets what is read from the built index (M129) when the season has one.
  const skillLookup = useMemo(() => (data.skillGifts ? skillGiftLookup(data.skillGifts) : undefined), [data]);
  const effectsByGift = useMemo(
    () => effectReportsByGift(data.gifts, stats, indexes, skillLookup),
    [data, stats, indexes, skillLookup],
  );
  const recommendation = useMemo(
    () =>
      recommendedGifts(
        data.gifts.filter((gift) => gift.obtainable || wanted.includes(gift.id)),
        conditionByGift,
        effectsByGift,
        { deployed: stats.deployed },
      ),
    [data, wanted, conditionByGift, effectsByGift, stats],
  );
  const recommended = useMemo(() => {
    const keep = (entry: GiftEntry): boolean =>
      matchesGiftName(entry.gift, filters) && matchesRecommendFilters(entry.gift, recFilters);
    // The order is `lib/recommend-rank.ts`'s, whichever 정렬 is chosen.
    const scoreOf = (id: number): number => recommendation.scores.get(id) ?? 0;
    const shown = (list: readonly GiftEntry[]): GiftEntry[] =>
      orderRecommended(list.filter(keep), recFilters.sort, scoreOf);
    return {
      deck: shown(recommendation.deck),
      free: shown(recommendation.free),
      ego: shown(recommendation.ego),
      reasons: recommendation.reasons,
      scores: recommendation.scores,
    };
  }, [recommendation, filters, recFilters]);
  const recNarrowed = recommendFiltersActive(recFilters) || filters.query.trim() !== '';
  const resetRecommended = useCallback((): void => {
    setRecFilters(DEFAULT_RECOMMEND_FILTERS);
    filterState.setQuery('');
  }, [filterState]);
  let deckEmpty: string;
  if (recommendation.deck.length > 0) deckEmpty = t('giftsNoMatch', lang);
  else if (deckSize === 0) deckEmpty = t('giftsDeckEmpty', lang);
  else deckEmpty = t('recDeckNone', lang);
  // A deck starts with nobody deployed, and most conditions count the deployed: say so, or the
  // nearly empty list reads as a verdict on the deck.
  const recNotice = deckSize > 0 && stats.deployed.length === 0 ? t('recNoDeployed', lang) : undefined;

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

  const grid = (
    list: GiftTileData[],
    reasons?: ReadonlyMap<number, string>,
    scores?: ReadonlyMap<number, number>,
  ) => (
    <GiftTileGrid
      tiles={list}
      wanted={wanted}
      entangled={entangledIds}
      blocked={blocked}
      giftName={giftName}
      enums={data.enums}
      lang={lang}
      onToggle={toggleGoal}
      onOpen={openGift}
      reasons={reasons}
      scores={scores}
    />
  );

  const title = t('giftsBrowseAll', lang);
  const tabs: PanelTab<BrowserTab>[] = [
    { id: 'recommended', label: t('giftsBrowseRecommended', lang) },
    { id: 'all', label: t('giftsBrowseTitle', lang) },
  ];
  const tabLabel = tabs.find((entry) => entry.id === tab)!.label;

  let list: React.ReactNode;
  if (tab === 'recommended') {
    list =
      recNarrowed &&
      recommended.deck.length === 0 &&
      recommended.free.length === 0 &&
      recommended.ego.length === 0 ? (
        <div className="p-2">
          <GiftNoMatch query={filters.query} onReset={resetRecommended} lang={lang} />
        </div>
      ) : (
        <RecommendedSections
          deck={recommended.deck}
          free={recommended.free}
          ego={recommended.ego}
          sort={recFilters.sort}
          deckEmpty={deckEmpty}
          notice={recNotice}
          grid={(entries) =>
            grid(
              entries.map((entry) => ({ entry })),
              recommended.reasons,
              recommended.scores,
            )
          }
          enums={data.enums}
          lang={lang}
        />
      );
  } else if (tiles.length === 0) {
    list = (
      <div className="p-2">
        <GiftNoMatch query={filters.query} onReset={filterState.resetFilters} lang={lang} />
      </div>
    );
  } else {
    list = grid(tiles);
  }

  const body = (
    <>
      <div className="flex h-11 flex-none items-center gap-2 border-b border-border bg-surface px-3">
        {page ? (
          <button
            ref={(el) => {
              first.current = el;
            }}
            type="button"
            onClick={onClose}
            aria-label={t('panelBack', lang)}
            className="-ml-1.5 inline-flex size-8 flex-none items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted active:bg-surface-sunken touch:size-11"
          >
            <ChevronLeft size={17} aria-hidden />
          </button>
        ) : null}
        {page ? (
          <h1 className="truncate text-subheading ">{title}</h1>
        ) : (
          <h2 className="truncate text-subheading ">{title}</h2>
        )}
        <Badge tone="neutral">{t('giftsSelected', lang, { n: wanted.length })}</Badge>
        {page ? null : (
          <IconButton className="ml-auto" label={t('giftsBrowseClose', lang)} onClick={onClose}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      <TabBar tabs={tabs} tab={tab} onTab={setTab} label={title} />
      <div role="tabpanel" aria-label={tabLabel} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none flex-col gap-2 border-b border-border px-3 py-2">
          <TextField
            inputRef={(el) => {
              if (!page) first.current = el;
            }}
            value={filters.query}
            onChange={filterState.setQuery}
            label={t('giftsSearch', lang)}
            placeholder={t('giftsSearch', lang)}
            icon={<Search size={14} aria-hidden />}
            onClear={() => filterState.setQuery('')}
            clearLabel={t('searchClear', lang)}
          />
          {tab === 'recommended' ? (
            <RecommendFilterBar
              filters={recFilters}
              onChange={setRecFilters}
              onReset={() => setRecFilters(DEFAULT_RECOMMEND_FILTERS)}
              enums={data.enums}
              lang={lang}
            />
          ) : (
            <GiftFilterBar state={filterState} enums={data.enums} lang={lang} />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4" data-testid="gift-browser-scroller">
          {list}
        </div>
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
