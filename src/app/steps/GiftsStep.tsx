/**
 * Pick the gifts to chase, as a grid of tiles; the detail sheet behind each name carries the
 * wording the tiles leave out (effect text, every condition, how it is obtained, the recipe). The
 * sheet itself is hosted by `PlanProvider`, so it survives this panel closing. Between the search
 * box and the grid sit the observation slots and the selected-gift tiles (`SelectedTiles`, the same
 * tiles as the grid): a tile's name opens the sheet, and the tile can be dragged onto a slot to pin
 * the gift for observation.
 *
 * The tab lists no gifts until asked (M121 took 「현재 활성」 out: the 「추천 기프트」 tab of the browser
 * answers the same question with filters). A gift is reached by the search box — **a search
 * answers from every gift**, in one list, right under the box — or by the >> at the end of the
 * search row, which opens the 「모두 보기」 browser (`onBrowse`) with the typed query, on its
 * 「추천 기프트」 tab. While the browser is open beside this tab (a desktop), the same button turns
 * to << and closes it. (M145 took out the 「추천 기프트 보기」 door below the tray: it was the same
 * button with an empty query.)
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronsLeft, ChevronsRight, Search, User } from 'lucide-react';
import type { GameData, Keyword } from '../../core/schema.ts';
import { observable, observationBudget } from '../../core/index.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { useApp } from '../store.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { prioritiseGifts } from '../lib/gift-priority.ts';
import { judgementOf } from '../lib/judgement.ts';
import { useChipDrag } from '../lib/useChipDrag.ts';
import { useGiftFilters } from '../lib/useGiftFilters.ts';
import { Button, Card, FilterSelect, IconButton, LinkButton, TextField } from '../components/ui.tsx';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { GiftNoMatch } from '../components/GiftFilterBar.tsx';
import { GiftTileGrid } from '../components/GiftGrid.tsx';
import { SelectedTiles } from '../components/SelectedTiles.tsx';
import { browsableParents, conditionReportsByGift, tilesFor } from '../lib/gift-tile.ts';
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
  // Floor 1 left: the starlight is spent, and no slot takes or moves a pin any more.
  const observeClosed = useApp((s) => observationClosed(s.run));
  const observeMax = data.rules.giftObservation.max;
  const observationSlots = useApp((s) => s.options.observationSlots);
  // The slots the plan may spend: 「관측하지 않기」 turns one off (M120).
  const observeBudget = observationBudget({ observationSlots }, data);
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
  const pin = (id: number): void => toggleObserved(id, { max: observeBudget, observable: canObserve });
  const unpin = (id: number): void => {
    if (observedGifts.includes(id)) toggleObserved(id, { max: observeBudget, observable: canObserve });
  };
  const skipSlot = (): void =>
    setOptions({ observationSlots: Math.max(observedGifts.length, observeBudget - 1) });
  const unskipSlot = (): void =>
    setOptions({ observationSlots: observeBudget + 1 >= observeMax ? undefined : observeBudget + 1 });
  const drag = useChipDrag((giftId, slot) => {
    // The replace and reorder paths below write the options directly, so the store's own refusal
    // of a pin after floor 1 does not reach them: the drop is ignored here instead.
    // A slot turned off takes no pin: 「관측 안 함」 is undone with its own button first.
    if (slot === null || slot >= observeBudget || observeClosed || !canObserve(giftId)) return;
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

  /*
    A query answers from every gift, in one list: the ones this deck activates first — the order
    `prioritiseGifts` left them in — and the tile's own ring says whether the deck activates it.
  */
  const results = searching
    ? [
        ...tilesFor(groups.active, childrenOf, wanted, conditionByGift, matcher.attrs),
        ...tilesFor(groups.other, childrenOf, wanted, conditionByGift, matcher.attrs),
      ]
    : [];
  let body: React.ReactNode;
  if (deck.length === 0) {
    body = (
      <Card className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <User size={28} className="text-fg-subtle" aria-hidden />
        <div className="text-subheading ">{t('giftsDeckEmpty', lang)}</div>
        {onGoDeck ? (
          <Button variant="primary" onClick={onGoDeck}>
            <ChevronLeft size={14} aria-hidden />
            {t('toDeck', lang)}
          </Button>
        ) : null}
      </Card>
    );
  } else if (searching && results.length === 0) {
    body = <GiftNoMatch query={query} onReset={filterState.resetFilters} lang={lang} />;
  } else if (searching) {
    body = (
      <Card className="overflow-hidden">
        <div className="flex h-9 items-center gap-2 border-b border-border bg-surface-muted px-3 text-subheading ">
          {t('giftsResults', lang)}{' '}
          <span className="font-num text-caption text-fg-subtle">{results.length}</span>
        </div>
        {/* No scroll of its own: the panel already scrolls, and a box inside it trapped the wheel. */}
        <div data-testid="gift-scroller">
          <GiftTileGrid
            tiles={results}
            wanted={wanted}
            entangled={entangledIds}
            blocked={blocked}
            giftName={giftName}
            enums={data.enums}
            lang={lang}
            onToggle={toggle}
            onOpen={openGift}
          />
        </div>
      </Card>
    );
  } else {
    body = null;
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <TextField
          value={query}
          onChange={filterState.setQuery}
          label={t('giftsSearch', lang)}
          placeholder={t('giftsSearch', lang)}
          icon={<Search size={14} aria-hidden />}
          onClear={() => filterState.setQuery('')}
          clearLabel={t('searchClear', lang)}
          className="flex-1"
        />
        {/*
          The door to every gift and the filters; it takes the query along. While the browser is
          open beside the tab it is the way back: >> turns to << and closes it.
        */}
        {onBrowse ? (
          <IconButton
            onClick={() => (browseOpen ? onCloseBrowse?.() : onBrowse(query))}
            label={t(browseOpen ? 'giftsBrowseHide' : 'giftsBrowseAll', lang)}
            expanded={browseOpen}
            testId="gift-browse-all"
          >
            {browseOpen ? <ChevronsLeft size={16} aria-hidden /> : <ChevronsRight size={16} aria-hidden />}
          </IconButton>
        ) : null}
      </div>
      {/*
        While a query is being typed, its results belong under the box that asked for them — the
        observation slots and the selection tray would otherwise push them a screen down. With no
        query the foot of the tab holds only the empty-deck card, when the deck is empty.
      */}
      {searching ? body : null}

      <ObserveSlots
        slots={observedGifts}
        max={observeMax}
        budget={observeBudget}
        onSkip={skipSlot}
        onUnskip={unskipSlot}
        candidates={observeCandidates}
        suggested={observeSuggested}
        indexes={indexes}
        judgementOf={judgementFor}
        lang={lang}
        onPin={pin}
        onUnpin={unpin}
        onOpenGift={openGift}
        closed={observeClosed}
        dragging={drag.state.dragging !== null}
        over={drag.state.over}
        onHover={drag.setOver}
      />

      {wanted.length > 0 ? (
        <div
          className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-muted px-3 py-2"
          role="group"
          aria-label={t('giftsSelected', lang, { n: wanted.length })}
        >
          {/*
            Sorting and filtering are a view over the tray, not over the store: 「선택 순서」 is the
            order things were chosen in, and a filter hides chips without unselecting anything.
          */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-caption-strong text-fg-muted">
              {t('giftsSelected', lang, { n: wanted.length })}
              {shownChips.length !== wanted.length ? (
                <span className="ml-1 font-num text-fg-subtle">{`· ${shownChips.length}`}</span>
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
            <LinkButton
              onClick={() => setConfirmClear(true)}
              muted
              className="-my-1 ml-auto px-1 py-1.5 text-caption"
              testId="gifts-clear"
            >
              {t('giftsClear', lang)}
            </LinkButton>
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
              className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface p-1 shadow-md"
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
