/**
 * Pick the gifts to chase, as a grid of tiles; the detail sheet behind each name carries the
 * wording the tiles leave out (effect text, every condition, how it is obtained, the recipe). The
 * sheet itself is hosted by `PlanProvider`, so it survives this panel closing. Between the search
 * box and the grid sit the observation slots and the selected-gift tiles (`SelectedTiles`, the same
 * tiles as the grid): a tile's name opens the sheet, and the tile can be dragged onto a slot to pin
 * the gift for observation.
 *
 * Browsing shows one section, 「지금 덱으로 활성」, and by default only what is left to decide in it
 * (「선택하지 않은 것만 보기」, `ui.activeUnpickedOnly`). Everything else is reached by the search box —
 * **a search answers from every gift**, in one list — or by the >> at the end of the search row,
 * which opens the 「모두 보기」 browser (`onBrowse`) with the typed query and the filters. While the
 * browser is open beside this tab (a desktop), the same button turns to << and closes it.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  User,
} from 'lucide-react';
import type { GameData, Keyword } from '../../core/schema.ts';
import { observable } from '../../core/index.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { useApp } from '../store.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { prioritiseGifts } from '../lib/gift-priority.ts';
import { judgementOf } from '../lib/judgement.ts';
import { useChipDrag } from '../lib/useChipDrag.ts';
import { useGiftFilters } from '../lib/useGiftFilters.ts';
import { Badge, Button, Card, FilterSelect } from '../components/ui.tsx';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { GiftNoMatch } from '../components/GiftFilterBar.tsx';
import { GiftTileGrid } from '../components/GiftGrid.tsx';
import { SelectedTiles } from '../components/SelectedTiles.tsx';
import {
  browsableParents,
  conditionReportsByGift,
  isMarked,
  tilesFor,
  type GiftTileData,
} from '../lib/gift-tile.ts';
import { ObserveSlots } from '../components/ObserveSlots.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { usePlan } from '../shell/plan-context.ts';

interface Props {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
  /** Where to send the player when the deck is empty (the deck tab). */
  onGoDeck?: () => void;
  /** Open the 「모두 보기」 browser on this query. Without it the search row has no >> button. */
  onBrowse?: (query: string) => void;
  /** The browser is open beside this tab: the >> becomes a << that closes it (`onCloseBrowse`). */
  browseOpen?: boolean;
  onCloseBrowse?: () => void;
}

export function GiftsStep({
  data,
  indexes,
  stats,
  lang,
  onGoDeck,
  onBrowse,
  browseOpen = false,
  onCloseBrowse,
}: Props) {
  const deck = useApp((s) => s.deck);
  const wanted = useApp((s) => s.wanted);
  const removeWanted = useApp((s) => s.removeWanted);
  const clearWanted = useApp((s) => s.clearWanted);
  const observedGifts = useApp((s) => s.options.observedGifts);
  const toggleObserved = useApp((s) => s.toggleObserved);
  const setOptions = useApp((s) => s.setOptions);
  const unpickedOnly = useApp((s) => s.ui.activeUnpickedOnly);
  const setUi = useApp((s) => s.setUi);
  // Floor 1 left: the starlight is spent, and no slot takes or moves a pin any more.
  const observeClosed = useApp((s) => observationClosed(s.run));
  const observeMax = data.rules.giftObservation.max;
  // The selection rule and the derived views over `wanted` are the shell's (`PlanProvider`), so
  // they are computed once and every surface agrees.
  const { plan, openGift, childrenOf, entangled, blocked, needed, toggleGoal: toggle } = usePlan();

  // Only the query: the filters live in the 「모두 보기」 browser.
  const filterState = useGiftFilters();
  const { filters, matcher, searching } = filterState;
  const query = filters.query;
  // The selection tray's own view: how the chips are ordered, and which of them are shown. It is
  // a view over `wanted`, never a reordering of it — the store keeps the order things were chosen
  // in, which is what 「선택 순서」 means and what the share link carries.
  const [chipSort, setChipSort] = useState<'keyword' | 'name' | 'all'>('all');
  const [chipKeyword, setChipKeyword] = useState<Keyword | 'all'>('all');
  const [chipPack, setChipPack] = useState<string>('all');
  const [collapsed, setCollapsed] = useState(false);
  // Clearing drops every goal, their fusion settings and the observation pins in one press, and
  // nothing brings them back — so it asks first, like the header's reset.
  const [confirmClear, setConfirmClear] = useState(false);

  const conditionByGift = useMemo(() => conditionReportsByGift(data, stats, indexes), [data, stats, indexes]);

  // Two fusion goals can eat the same ingredient; a state that already holds both still says so.
  const entangledIds = useMemo(() => new Set(entangled.keys()), [entangled]);

  const groups = useMemo(
    () => prioritiseGifts(browsableParents(data, indexes, wanted, childrenOf, matcher), conditionByGift),
    [data, indexes, wanted, conditionByGift, childrenOf, matcher],
  );

  const giftName = (id: number): string => pick(indexes.giftById.get(id)?.name, lang);
  const judgementFor = (id: number) => judgementOf(conditionByGift.get(id));
  /** Packs a gift can only be had from: its 테마 팩 한정 packs and the boss that drops it on clear. */
  const boundPacks = (id: number): number[] => {
    const gift = indexes.giftById.get(id);
    if (!gift) return [];
    const reward = gift.acquisition.clearRewardOf;
    return [...gift.acquisition.exclusiveTo, ...(reward === null || reward === undefined ? [] : [reward])];
  };
  const keywordOrder = new Map(data.enums.keywords.map((k, i) => [k.id as Keyword, i]));
  const shownChips = useMemo(() => {
    const kept = wanted.filter((id) => {
      const gift = indexes.giftById.get(id);
      if (!gift) return false;
      if (chipKeyword !== 'all' && gift.keyword !== chipKeyword) return false;
      if (chipPack !== 'all' && !boundPacks(id).includes(Number(chipPack))) return false;
      return true;
    });
    if (chipSort === 'all') return kept;
    const name = (id: number): string => pick(indexes.giftById.get(id)?.name, lang);
    return [...kept].sort((a, b) =>
      chipSort === 'name'
        ? name(a).localeCompare(name(b), lang === 'ko' ? 'ko' : 'en')
        : (keywordOrder.get(indexes.giftById.get(a)!.keyword) ?? 99) -
            (keywordOrder.get(indexes.giftById.get(b)!.keyword) ?? 99) ||
          name(a).localeCompare(name(b), lang === 'ko' ? 'ko' : 'en'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, indexes, lang, chipSort, chipKeyword, chipPack]);
  const canObserve = (id: number): boolean => {
    const gift = indexes.giftById.get(id);
    return gift ? observable(gift, data.rules) : false;
  };

  // Observation: the slots take a selected gift from the 「+」 list or from a dragged chip. A drop
  // on a filled slot replaces its gift; a drop elsewhere, or of a gift that cannot be observed,
  // does nothing.
  /*
   * `needed`, not `wanted`: a fusion goal is a promise about its ingredients too, and those are
   * often the pin that matters — the shop has to hand a piece over before the fusion can happen,
   * and observation is the one way to make that certain. They have no chip to drag (the selection
   * holds the result, not its pieces), so the 「+」 list is their way in.
   */
  // What the planner would observe in the cells still empty. Gone once floor 1 is left: core stops
  // recommending then, and the cells are no longer drawn.
  const observeSuggested = observeClosed
    ? []
    : (plan?.start.observed ?? [])
        .filter((entry) => !entry.pinned && !observedGifts.includes(entry.giftId))
        .map((entry) => entry.giftId)
        // Only what a pin could hold: the store drops a pin outside the goals' tree.
        .filter((id) => needed.has(id) && canObserve(id));
  // The suggestions lead the list an empty cell opens, in the planner's order.
  const observeCandidates = [
    ...observeSuggested,
    ...[...needed].filter(
      (id) => canObserve(id) && !observedGifts.includes(id) && !observeSuggested.includes(id),
    ),
  ];
  const pin = (id: number): void => toggleObserved(id, { max: observeMax, observable: canObserve });
  const unpin = (id: number): void => {
    if (observedGifts.includes(id)) toggleObserved(id, { max: observeMax, observable: canObserve });
  };
  const drag = useChipDrag((giftId, slot) => {
    // The replace and reorder paths below write the options directly, so the store's own refusal
    // of a pin after floor 1 does not reach them: the drop is ignored here instead.
    if (slot === null || observeClosed || !canObserve(giftId)) return;
    // The slot order is what the run pays (`costTable`), so moving a pin between cells is a real
    // choice — dropping an already-pinned chip used to light the target up and then do nothing.
    if (observedGifts.includes(giftId)) {
      const rest = observedGifts.filter((id) => id !== giftId);
      const at = Math.min(slot, rest.length);
      setOptions({ observedGifts: [...rest.slice(0, at), giftId, ...rest.slice(at)] });
      return;
    }
    const occupant = observedGifts[slot];
    if (occupant !== undefined)
      setOptions({ observedGifts: observedGifts.map((id) => (id === occupant ? giftId : id)) });
    else pin(giftId);
  });
  const draggedGift = drag.state.dragging !== null ? indexes.giftById.get(drag.state.dragging) : undefined;

  const activeTiles = tilesFor(groups.active, childrenOf, wanted, conditionByGift, matcher.attrs);
  const grid = (list: GiftTileData[]) => (
    <GiftTileGrid
      tiles={list}
      wanted={wanted}
      entangled={entangledIds}
      blocked={blocked}
      giftName={giftName}
      enums={data.enums}
      lang={lang}
      onToggle={toggle}
      onOpen={openGift}
    />
  );
  const emptyLine = (text: string) => (
    <div className="px-3 py-3 text-sm text-fg-3" data-testid="gift-active-empty">
      {text}
    </div>
  );

  /*
    「활성」 is a worklist: with 「선택하지 않은 것만 보기」 on (the default) a tile leaves it once there is
    nothing left to decide about it. 「남은 일」 is the tile's own question (`isMarked`), not just
    membership in `wanted` — choosing 진혼 settles 요리 비법 전서 too, and the ✓ on that tile says so.
    The section itself stays when it runs dry, so the box that emptied it stays within reach.
  */
  const activeSection = () => {
    const shown = unpickedOnly ? activeTiles.filter((tile) => !isMarked(tile, wanted, blocked)) : activeTiles;
    // 조합 계승 children come into the grid under their parent, so the parent count read low.
    const chosen = activeTiles.filter((tile) => wanted.includes(tile.entry.gift.id)).length;
    let content: React.ReactNode;
    if (activeTiles.length === 0) content = emptyLine(t('giftsActiveNone', lang));
    else if (shown.length === 0) content = emptyLine(t('giftsActiveAllPicked', lang));
    else content = grid(shown);
    return (
      <Card className="overflow-hidden">
        {/*
          The fold toggle and the checkbox sit side by side rather than nested: a control inside a
          button is not HTML, and ticking the box must not fold the section.
        */}
        <div className="flex h-9 items-stretch border-b border-line bg-surface-2">
          <button
            type="button"
            onClick={() => setCollapsed((shut) => !shut)}
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center justify-between gap-1 px-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span className="truncate">{t('giftsActive', lang)}</span>
              <span className="font-num text-xs text-fg-3">{shown.length}</span>
              {collapsed && chosen > 0 ? (
                <Badge tone="neutral">{t('giftsSelected', lang, { n: chosen })}</Badge>
              ) : null}
            </span>
            <span className="flex-none text-fg-3">
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          <label className="flex flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap border-l border-line px-2.5 text-xs font-medium text-fg-2">
            <input
              type="checkbox"
              checked={unpickedOnly}
              onChange={(event) => setUi({ activeUnpickedOnly: event.target.checked })}
              className="h-[14px] w-[14px] accent-[var(--color-ink)]"
              data-testid="gift-unpicked-only"
            />
            {t('giftsUnpickedOnly', lang)}
          </label>
        </div>
        {collapsed ? null : content}
      </Card>
    );
  };

  /*
    A query answers from every gift, in one list: 활성 first — the order `prioritiseGifts` left them
    in — and the tile's own ring says whether the deck activates it. It ignores 「선택하지 않은 것만
    보기」: a search is explicit, and a picked gift has to stay reachable to be unpicked.
  */
  const results = searching
    ? [...activeTiles, ...tilesFor(groups.other, childrenOf, wanted, conditionByGift, matcher.attrs)]
    : [];
  let body: React.ReactNode;
  if (deck.length === 0) {
    body = (
      <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
        <User size={28} className="text-fg-3" aria-hidden />
        <div className="text-sm font-semibold">{t('giftsDeckEmpty', lang)}</div>
        {onGoDeck ? (
          <Button variant="primary" onClick={onGoDeck}>
            <ChevronLeft size={14} aria-hidden />
            {t('toDeck', lang)}
          </Button>
        ) : null}
      </Card>
    );
  } else if (searching && results.length === 0) {
    body = <GiftNoMatch state={filterState} lang={lang} />;
  } else if (searching) {
    body = (
      <Card className="overflow-hidden">
        <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-2 px-3 text-sm font-semibold">
          {t('giftsResults', lang)} <span className="font-num text-xs text-fg-3">{results.length}</span>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto" data-testid="gift-scroller">
          {grid(results)}
        </div>
      </Card>
    );
  } else {
    body = activeSection();
  }

  const keywordOptions = data.enums.keywords.map((k) => ({
    value: k.id as Keyword,
    label: pick(k.name, lang),
  }));
  // The tray's own filters only offer what the selection actually holds — a keyword or a pack with
  // no chip behind it would filter to nothing.
  const chipKeywordOptions = keywordOptions.filter((option) =>
    wanted.some((id) => indexes.giftById.get(id)?.keyword === option.value),
  );
  const chipPackOptions = [...new Set(wanted.flatMap(boundPacks))]
    .map((packId) => ({ value: String(packId), label: pick(indexes.packById.get(packId)?.name, lang) }))
    .filter((option) => option.label !== '')
    .sort((a, b) => a.label.localeCompare(b.label, lang === 'ko' ? 'ko' : 'en'));
  const sortOptions = [
    { value: 'keyword' as const, label: t('filterKeyword', lang) },
    { value: 'name' as const, label: t('giftsSortName', lang) },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-line-control bg-surface px-2.5 text-sm">
          <Search size={14} aria-hidden className="flex-none text-fg-3" />
          <input
            value={query}
            onChange={(event) => filterState.setQuery(event.target.value)}
            placeholder={t('giftsSearch', lang)}
            aria-label={t('giftsSearch', lang)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3"
          />
        </label>
        {/*
          The door to every gift and the filters; it takes the query along. While the browser is
          open beside the tab it is the way back: >> turns to << and closes it.
        */}
        {onBrowse ? (
          <button
            type="button"
            onClick={() => (browseOpen ? onCloseBrowse?.() : onBrowse(query))}
            aria-label={t(browseOpen ? 'giftsBrowseHide' : 'giftsBrowseAll', lang)}
            title={t(browseOpen ? 'giftsBrowseHide' : 'giftsBrowseAll', lang)}
            aria-expanded={browseOpen}
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-sm border border-line-control bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg"
            data-testid="gift-browse-all"
          >
            {browseOpen ? <ChevronsLeft size={16} aria-hidden /> : <ChevronsRight size={16} aria-hidden />}
          </button>
        ) : null}
      </div>
      {/*
        While a query is being typed, its results belong under the box that asked for them — the
        observation slots and the selection tray would otherwise push them a screen down. With no
        query the 활성 section goes back to the foot of the tab.
      */}
      {searching ? body : null}

      <ObserveSlots
        slots={observedGifts}
        max={observeMax}
        candidates={observeCandidates}
        suggested={observeSuggested}
        indexes={indexes}
        judgementOf={judgementFor}
        lang={lang}
        onPin={pin}
        onUnpin={unpin}
        closed={observeClosed}
        dragging={drag.state.dragging !== null}
        over={drag.state.over}
        onHover={drag.setOver}
      />

      {wanted.length > 0 ? (
        <div
          className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2"
          aria-label={t('giftsSelected', lang, { n: wanted.length })}
        >
          {/*
            Sorting and filtering are a view over the tray, not over the store: 「선택 순서」 is the
            order things were chosen in, and a filter hides chips without unselecting anything.
          */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-medium text-fg-2">
              {t('giftsSelected', lang, { n: wanted.length })}
              {shownChips.length !== wanted.length ? (
                <span className="ml-1 font-num text-fg-3">{`· ${shownChips.length}`}</span>
              ) : null}
            </span>
            <FilterSelect
              label={t('giftsSort', lang)}
              value={chipSort}
              options={sortOptions}
              onChange={setChipSort}
              allLabel={t('giftsSortPicked', lang)}
            />
            <FilterSelect
              label={t('filterKeyword', lang)}
              value={chipKeyword}
              options={chipKeywordOptions}
              onChange={setChipKeyword}
              allLabel={t('filterAll', lang)}
            />
            {chipPackOptions.length > 0 ? (
              <FilterSelect
                label={t('giftsPack', lang)}
                value={chipPack}
                options={chipPackOptions}
                onChange={setChipPack}
                allLabel={t('filterAll', lang)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              aria-haspopup="dialog"
              className="-my-1 ml-auto px-1 py-1.5 text-xs text-fg-3 underline hover:text-fg"
              data-testid="gifts-clear"
            >
              {t('giftsClear', lang)}
            </button>
          </div>
          <SelectedTiles
            ids={shownChips}
            indexes={indexes}
            pinned={observedGifts}
            entangled={entangledIds}
            dragging={drag.state.dragging}
            handleFor={drag.handleFor}
            judgementOf={judgementFor}
            giftName={giftName}
            lang={lang}
            onOpen={openGift}
            onRemove={removeWanted}
          />
        </div>
      ) : null}
      {confirmClear ? (
        <ConfirmDialog
          title={t('giftsClear', lang)}
          message={t('giftsClearConfirm', lang, { n: wanted.length })}
          confirmLabel={t('giftsClear', lang)}
          onConfirm={() => {
            setConfirmClear(false);
            clearWanted();
          }}
          onCancel={() => setConfirmClear(false)}
          lang={lang}
        />
      ) : null}

      {draggedGift
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface p-1 shadow-pop"
              style={{ left: drag.state.x, top: drag.state.y }}
              data-testid="chip-ghost"
              aria-hidden
            >
              <GiftIcon gift={draggedGift} size={32} lang={lang} />
            </div>,
            document.body,
          )
        : null}

      {searching ? null : body}
    </div>
  );
}
